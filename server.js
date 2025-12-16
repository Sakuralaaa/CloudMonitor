require('dotenv').config();
const express = require('express');
const cors = require('cors');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { encryptData, decryptData } = require('./crypto-utils');

const app = express();
const PORT = process.env.PORT || 3000;

// 加密密钥（用于加密存储的 API Token）
const ACCOUNTS_SECRET = process.env.ACCOUNTS_SECRET;
const ENCRYPTION_ENABLED = ACCOUNTS_SECRET && ACCOUNTS_SECRET.length === 64;
const FIXED_VERSION = '1.0';

app.use(cors());
app.use(express.json());

// Session管理 - 存储在内存中,重启服务器后清空
const activeSessions = new Map(); // { token: { createdAt: timestamp } }
const SESSION_DURATION = 10 * 24 * 60 * 60 * 1000; // 10天

// 生成随机token
function generateToken() {
  return 'session_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 清理过期session
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [token, session] of activeSessions.entries()) {
    if (now - session.createdAt > SESSION_DURATION) {
      activeSessions.delete(token);
    }
  }
}

// 每小时清理一次过期session
setInterval(cleanExpiredSessions, 60 * 60 * 1000);

// 通用 fetch 封装（支持超时）
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = options.timeout || 10000;
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/**
 * Normalize API tokens by trimming whitespace and stripping common prefixes (e.g. "Bearer ").
 * @param {string} token Raw token, possibly including a Bearer prefix with varying cases.
 * @returns {string} Normalized token without prefix and surrounding whitespace.
 */
function normalizeToken(token) {
  if (!token) return '';
  const trimmed = token.toString().trim();
  return trimmed.replace(/^\s*bearer\s+/i, '').trim();
}

function parseJsonOrThrow(text, context) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${context}: ${e.message}`);
  }
}

/**
 * Normalize a value into an array. Accepts arrays directly, or finds array values inside objects.
 * Flattens one level when multiple array values exist. Returns an empty array when nothing usable is found.
 * When multiple array properties exist in an object, they are concatenated into a single flattened list.
 * @param {*} value Possible array, object containing arrays, or other types.
 * @returns {Array} Normalized array (possibly empty).
 */
function normalizeToArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    const arrays = Object.values(value).filter(Array.isArray);
    if (arrays.length > 0) return arrays.flat();
  }
  return [];
}

/**
 * Safely extract a property from an object and normalize it into an array.
 * Falls back to the whole object when the property is missing, to support APIs
 * that sometimes wrap arrays or return them at the top level.
 * @param {*} obj Source object or value.
 * @param {string} [key] Optional property name to extract before normalization.
 * @returns {Array} Normalized array (possibly empty).
 */
function extractAndNormalize(obj, key) {
  if (!obj) return [];
  if (!key) return normalizeToArray(obj);
  const value = obj[key];
  return value == null ? normalizeToArray(obj) : normalizeToArray(value);
}

// 密码验证中间件
function requireAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  const sessionToken = req.headers['x-session-token'];
  const savedPassword = loadAdminPassword();
  
  if (!savedPassword) {
    // 如果没有设置密码，允许访问（首次设置）
    next();
  } else if (sessionToken && activeSessions.has(sessionToken)) {
    // 检查session是否有效
    const session = activeSessions.get(sessionToken);
    if (Date.now() - session.createdAt < SESSION_DURATION) {
      next();
    } else {
      activeSessions.delete(sessionToken);
      res.status(401).json({ error: 'Session已过期，请重新登录' });
    }
  } else if (password === savedPassword) {
    next();
  } else {
    res.status(401).json({ error: '密码错误或Session无效' });
  }
}

app.use(express.static('public'));

// 数据文件路径
const ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');
const PASSWORD_FILE = path.join(__dirname, 'password.json');

// 读取服务器存储的账号
function loadServerAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) {
      const data = fs.readFileSync(ACCOUNTS_FILE, 'utf8');
      const accounts = JSON.parse(data).map(acc => ({
        provider: acc.provider || 'zeabur',
        ...acc
      }));
      
      // 如果启用了加密,解密 Token
      if (ENCRYPTION_ENABLED) {
        return accounts.map(account => {
          // 如果账号有加密的 Token,解密它
          if (account.encryptedToken) {
            try {
              const token = decryptData(account.encryptedToken, ACCOUNTS_SECRET);
              return { ...account, token, encryptedToken: undefined };
            } catch (e) {
              console.error(`❌ 解密账号 [${account.name}] 的 Token 失败:`, e.message);
              return account;
            }
          }
          return account;
        });
      }
      
      return accounts;
    }
  } catch (e) {
    console.error('❌ 读取账号文件失败:', e.message);
  }
  return [];
}

// 保存账号到服务器
function saveServerAccounts(accounts) {
  try {
    let accountsToSave = accounts.map(acc => ({
      provider: acc.provider || 'zeabur',
      ...acc,
      token: normalizeToken(acc.token)
    }));
    
    // 如果启用了加密,加密 Token
    if (ENCRYPTION_ENABLED) {
      accountsToSave = accountsToSave.map(account => {
        const normalizedToken = account.token;
        if (normalizedToken) {
          try {
            const encryptedToken = encryptData(normalizedToken, ACCOUNTS_SECRET);
            // 保存时移除明文 token,只保存加密后的
            const { token, ...rest } = account;
            return { ...rest, encryptedToken };
          } catch (e) {
            console.error(`❌ 加密账号 [${account.name}] 的 Token 失败:`, e.message);
            return account;
          }
        }
        return account;
      });
      console.log('🔐 账号 Token 已加密存储');
    }
    
    fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accountsToSave, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ 保存账号文件失败:', e.message);
    return false;
  }
}

// 读取管理员密码
function loadAdminPassword() {
  try {
    if (fs.existsSync(PASSWORD_FILE)) {
      const data = fs.readFileSync(PASSWORD_FILE, 'utf8');
      return JSON.parse(data).password;
    }
  } catch (e) {
    console.error('❌ 读取密码文件失败:', e.message);
  }
  return null;
}

// 保存管理员密码
function saveAdminPassword(password) {
  try {
    fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ password }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('❌ 保存密码文件失败:', e.message);
    return false;
  }
}

// Zeabur GraphQL 查询
async function queryZeabur(token, query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const options = {
      hostname: 'api.zeabur.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

// 获取用户信息和项目
async function fetchAccountData(token) {
  // 查询用户信息
  const userQuery = `
    query {
      me {
        _id
        username
        email
        credit
      }
    }
  `;
  
  // 查询项目信息
  const projectsQuery = `
    query {
      projects {
        edges {
          node {
            _id
            name
            region {
              name
            }
            environments {
              _id
            }
            services {
              _id
              name
              status
              template
              resourceLimit {
                cpu
                memory
              }
              domains {
                domain
                isGenerated
              }
            }
          }
        }
      }
    }
  `;
  
  // 查询 AI Hub 余额
  const aihubQuery = `
    query GetAIHubTenant {
      aihubTenant {
        balance
        keys {
          keyID
          alias
          cost
        }
      }
    }
  `;
  
  const [userData, projectsData, aihubData] = await Promise.all([
    queryZeabur(token, userQuery),
    queryZeabur(token, projectsQuery),
    queryZeabur(token, aihubQuery).catch(() => ({ data: { aihubTenant: null } }))
  ]);
  
  return {
    user: userData.data?.me || {},
    projects: (projectsData.data?.projects?.edges || []).map(edge => edge.node),
    aihub: aihubData.data?.aihubTenant || null
  };
}

// 获取项目用量数据
async function fetchUsageData(token, userID, projects = []) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // 使用明天的日期确保包含今天的所有数据
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const toDate = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  
  const usageQuery = {
    operationName: 'GetHeaderMonthlyUsage',
    variables: {
      from: fromDate,
      to: toDate,
      groupByEntity: 'PROJECT',
      groupByTime: 'DAY',
      groupByType: 'ALL',
      userID: userID
    },
    query: `query GetHeaderMonthlyUsage($from: String!, $to: String!, $groupByEntity: GroupByEntity, $groupByTime: GroupByTime, $groupByType: GroupByType, $userID: ObjectID!) {
      usages(
        from: $from
        to: $to
        groupByEntity: $groupByEntity
        groupByTime: $groupByTime
        groupByType: $groupByType
        userID: $userID
      ) {
        categories
        data {
          id
          name
          groupByEntity
          usageOfEntity
          __typename
        }
        __typename
      }
    }`
  };
  
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(usageQuery);
    const options = {
      hostname: 'api.zeabur.com',
      path: '/graphql',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 10000
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          const usages = result.data?.usages?.data || [];
          
          // 计算每个项目的总费用
          const projectCosts = {};
          let totalUsage = 0;
          
          usages.forEach(project => {
            const projectTotal = project.usageOfEntity.reduce((a, b) => a + b, 0);
            // 单个项目显示：向上取整到 $0.01（与 Zeabur 官方一致）
            const displayCost = projectTotal > 0 ? Math.ceil(projectTotal * 100) / 100 : 0;
            projectCosts[project.id] = displayCost;
            // 总用量计算：使用原始费用（不取整，保证总余额准确）
            totalUsage += projectTotal;
          });
          
          resolve({
            projectCosts,
            totalUsage,
            freeQuotaRemaining: 5 - totalUsage, // 免费额度 $5
            freeQuotaLimit: 5
          });
        } catch (e) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    req.write(data);
    req.end();
  });
}

// ===== 多云平台适配 =====
async function fetchVercelData(token) {
  const headers = { Authorization: `Bearer ${token}` };
  
  const userResp = await fetchWithTimeout('https://api.vercel.com/v2/user', { headers });
  const userText = await userResp.text();
  if (!userResp.ok) {
    throw new Error(`Vercel 用户信息获取失败: ${userText || userResp.statusText}`);
  }
  
  const userJson = JSON.parse(userText || '{}');
  const user = userJson.user || userJson.account || {};
  
  // Vercel 的 Token 可能绑定到团队，依次尝试个人 / 默认团队 / 其它团队
  const teamContexts = new Set([undefined]);
  if (user.defaultTeamId) teamContexts.add(user.defaultTeamId);
  if (Array.isArray(userJson.teams)) {
    userJson.teams.forEach(team => team?.id && teamContexts.add(team.id));
  }
  
  const projectMap = new Map();
  let lastProjectError = '';
  
  for (const teamId of teamContexts) {
    const projectUrl = `https://api.vercel.com/v9/projects?limit=100${teamId ? `&teamId=${teamId}` : ''}`;
    const projectsResp = await fetchWithTimeout(projectUrl, { headers });
    
    if (!projectsResp.ok) {
      lastProjectError = await projectsResp.text().catch(() => projectsResp.statusText);
      continue;
    }
    
    const projectsJson = await projectsResp.json();
    const projectList = normalizeToArray(projectsJson.projects);
    const projects = projectList.map((p) => ({
      _id: p.id || p.projectId || p.name,
      name: p.name,
      region: teamId ? `Team ${teamId}` : (p.teamId || 'Personal'),
      environments: [],
      services: [],
      domains: (Array.isArray(p.targets) ? p.targets : []).map((d) => ({ domain: d.alias || d.domain || d, isGenerated: true })),
      cost: 0,
      hasCostData: false
    }));
    
    projects.forEach(proj => {
      projectMap.set(proj._id, proj);
    });
  }
  
  if (projectMap.size === 0) {
    throw new Error(lastProjectError ? `Vercel 项目信息获取失败: ${lastProjectError}` : 'Vercel 项目信息获取失败');
  }
  
  return { 
    user: { _id: user.id || user.uid, username: user.username || user.name || user.email, email: user.email }, 
    projects: Array.from(projectMap.values()) 
  };
}

async function fetchHuggingFaceData(token) {
  const headers = { 
    // Hugging Face expects the Bearer prefix even if the raw token is already normalized
    Authorization: `Bearer ${token}`,
    'User-Agent': 'cloud-manage/1.0',
    Accept: 'application/json'
  };
  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;
  const REASON_LIMIT = 200;
  const COMBINED_REASON_LIMIT = 300;
  let repoIdCounter = 0;
  const namespaces = new Set();
  const resolveRepoType = (repo = {}, endpointType) => {
    const type = (repo.repo_type || repo.type || endpointType || 'model').toString();
    return type.toLowerCase();
  };
  // Hugging Face APIs return slightly different shapes across models/spaces/datasets,
  // so we defensively collect possible identifier fields to stay compatible.
  const repoBaseName = (repo = {}) => repo?.id || repo?.name || repo?.repo_id || repo?.repoId || repo?.slug || repo?.full_name || repo?.fullName;
  const buildRepoId = (repo = {}, repoType, suffix) => {
    const base = repoBaseName(repo) || `repo-${suffix || repoType}-${repoIdCounter++}`;
    return `${base}-${suffix || repoType}`;
  };
  
  const userResp = await fetchWithTimeout('https://huggingface.co/api/whoami-v2', { headers });
  const userText = await userResp.text();
  if (!userResp.ok) {
    const reason = userText || userResp.statusText || 'unknown error';
    throw new Error(`Failed to fetch Hugging Face user info: ${reason}`);
  }
  const user = parseJsonOrThrow(userText || '{}', 'Failed to parse Hugging Face user info');
  const extractOrgIdentifier = (org = {}) => {
    const candidate = typeof org === 'object' && org !== null ? (org.name || org.orgName || org.id) : org;
    return typeof candidate === 'string' ? candidate : null;
  };
  const extractRejectionMessage = (rejection) => {
    if (!rejection) return 'unknown error';
    if (rejection.reason) return rejection.reason.message || rejection.reason;
    return rejection.message || rejection.toString() || 'unknown error';
  };
  const sanitizeReason = (reason) => {
    if (typeof reason !== 'string') return 'unknown error';
    const trimmed = reason.trim();
    return trimmed.length > REASON_LIMIT ? `${trimmed.slice(0, REASON_LIMIT)}...` : trimmed;
  };
  const combineReasons = (reasons = []) => {
    const combined = reasons.join('; ');
    return combined.length > COMBINED_REASON_LIMIT ? `${combined.slice(0, COMBINED_REASON_LIMIT)}...` : (combined || 'unknown error');
  };
  const addNamespace = (value) => {
    if (value && typeof value === 'string') {
      namespaces.add(value);
    }
  };
  addNamespace(user.name);
  addNamespace(user.user);
  if (Array.isArray(user.orgs)) {
    user.orgs.forEach(org => addNamespace(extractOrgIdentifier(org)));
  }
  
  const repoEndpoints = [
    { key: 'models', type: 'model', path: 'models' },
    { key: 'spaces', type: 'space', path: 'spaces' },
    { key: 'datasets', type: 'dataset', path: 'datasets' }
  ];
  
  const repos = [];
  const seen = new Set();
  // When no namespace info (user/org) is available, fall back to an unscoped request to avoid empty results.
  // Note: unscoped requests may exclude private repositories that require namespace-scoped authorization.
  const namespaceList = namespaces.size > 0 ? Array.from(namespaces) : [null];
  
  for (const endpoint of repoEndpoints) {
    const results = [];
    for (const namespace of namespaceList) {
      try {
        let offset = 0;
        const collected = [];
        for (let page = 0; page < MAX_PAGES; page++) {
          const url = new URL(`https://huggingface.co/api/${endpoint.path}`);
          url.searchParams.set('limit', PAGE_SIZE.toString());
          url.searchParams.set('full', '1');
          if (namespace) url.searchParams.set('author', namespace);
          url.searchParams.set('offset', offset.toString());
          const resp = await fetchWithTimeout(url.toString(), { headers });
          const reposText = await resp.text();
          if (!resp.ok) {
            const reason = sanitizeReason(reposText || resp.statusText || 'unknown error');
            throw new Error(`Failed to fetch Hugging Face ${endpoint.type} list: ${reason}`);
          }
          const parsed = reposText ? parseJsonOrThrow(reposText, `Failed to parse Hugging Face ${endpoint.type} list`) : {};
          const list = extractAndNormalize(parsed, endpoint.key);
          collected.push(...list);
          if (!Array.isArray(list) || list.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }
        results.push({ status: 'fulfilled', value: collected });
      } catch (err) {
        results.push({ status: 'rejected', reason: err });
      }
    }
    const fulfilled = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const rejected = results.filter(r => r.status === 'rejected');
    if (fulfilled.length === 0) {
      const reason = combineReasons(rejected.map(extractRejectionMessage));
      throw new Error(`Failed to fetch Hugging Face ${endpoint.type} list: ${reason}`);
    }
    if (rejected.length > 0) {
      console.warn(`Hugging Face ${endpoint.type} partially failed for some namespaces:`, combineReasons(rejected.map(extractRejectionMessage)));
    }
    
    fulfilled.flat().forEach((r) => {
      const repoType = resolveRepoType(r, endpoint.type);
      const suffix = endpoint.type || repoType;
      const id = buildRepoId(r, repoType, suffix);
      if (seen.has(id)) return;
      seen.add(id);
      repos.push({ ...r, repo_type: repoType, __sourceType: suffix });
    });
  }
  
  const projects = repos.map((r) => {
    const repoType = resolveRepoType(r, r.__sourceType);
    const visibility = r.private ? 'Private' : 'Public';
    const typeLabel = repoType.charAt(0).toUpperCase() + repoType.slice(1);
    const suffix = r.__sourceType || repoType;
    
    return {
      _id: buildRepoId(r, repoType, suffix),
      name: repoBaseName(r) || 'Unknown',
      region: `${typeLabel} · ${visibility}`,
      environments: [],
      services: [],
      domains: [],
      cost: 0,
      hasCostData: false
    };
  });
  
  return { user: { _id: user.id || user.name, username: user.name, email: user.email }, projects };
}

async function fetchRenderData(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const [ownerResp, servicesResp] = await Promise.all([
    fetchWithTimeout('https://api.render.com/v1/owners', { headers }),
    fetchWithTimeout('https://api.render.com/v1/services', { headers })
  ]);
  const owners = ownerResp.ok ? await ownerResp.json() : [];
  const owner = Array.isArray(owners) ? owners[0] : owners;
  
  const servicesRaw = servicesResp.ok ? await servicesResp.json() : [];
  const services = normalizeToArray(servicesRaw);
  
  const projects = services.map((s) => ({
    _id: s.id,
    name: s.name,
    region: s.serviceDetails?.region || 'Global',
    environments: [],
    services: [],
    domains: (s.serviceDetails?.customDomains || []).map((d) => ({ domain: d.name || d, isGenerated: false })),
    cost: 0,
    hasCostData: false
  }));
  
  return { user: { _id: owner?.id || 'render', username: owner?.name || owner?.email || 'Render User', email: owner?.email }, projects };
}

async function fetchRailwayData(token) {
  const query = {
    query: `
      query Viewer {
        viewer {
          id
          email
          username
          projects {
            edges {
              node { id name }
            }
          }
        }
      }
    `
  };
  
  const resp = await fetchWithTimeout('https://backboard.railway.app/graphql/v2', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(query)
  });
  
  if (!resp.ok) throw new Error('Railway API 返回错误');
  const data = await resp.json();
  const viewer = data.data?.viewer || data.data?.me || {};
  const projects = (viewer.projects?.edges || []).map((edge) => ({
    _id: edge.node.id,
    name: edge.node.name,
    region: 'Railway',
    environments: [],
    services: [],
    domains: [],
    cost: 0,
    hasCostData: false
  }));
  
  return { user: { _id: viewer.id, username: viewer.username || viewer.email, email: viewer.email }, projects };
}

async function fetchClawCloudData(token) {
  const headers = { Authorization: `Bearer ${token}` };
  const projectsResp = await fetchWithTimeout('https://api.claw.cloud/v1/projects', { headers });
  if (!projectsResp.ok) throw new Error('ClawCloud API 返回错误');
  const projectsJson = await projectsResp.json();
  const projectsList = extractAndNormalize(projectsJson, 'projects');
  const projects = projectsList.map((p) => ({
    _id: p.id || p.name,
    name: p.name,
    region: p.region || 'Global',
    environments: [],
    services: [],
    domains: p.domains ? p.domains.map((d) => ({ domain: d, isGenerated: false })) : [],
    cost: 0,
    hasCostData: false
  }));
  
  const ownerInfo = projectsJson.owner || projectsJson.user || projectsJson.account || {};
  const normalizedOwner = typeof ownerInfo === 'string' ? { username: ownerInfo } : ownerInfo;
  const user = {
    _id: normalizedOwner.id || normalizedOwner._id || 'clawcloud',
    username: normalizedOwner.username || normalizedOwner.name || 'ClawCloud User',
    email: normalizedOwner.email || ''
  };
  
  return { user, projects };
}

async function fetchProviderAccount(account) {
  const provider = (account.provider || 'zeabur').toLowerCase();
  const token = normalizeToken(account.token);
  if (!token) throw new Error('缺少账户 Token');
  
  switch (provider) {
    case 'zeabur': {
      const { user, projects, aihub } = await fetchAccountData(token);
      let usageData = { totalUsage: 0, freeQuotaRemaining: 5, freeQuotaLimit: 5, projectCosts: {} };
      if (user._id) {
        try {
          usageData = await fetchUsageData(token, user._id, projects);
        } catch (e) {
          console.log(`⚠️ [${account.name}] 获取 Zeabur 用量失败:`, e.message);
        }
      }
      
      const projectsWithCost = projects.map(project => ({
        _id: project._id,
        name: project.name,
        region: project.region?.name || 'Unknown',
        environments: project.environments || [],
        services: project.services || [],
        cost: usageData.projectCosts?.[project._id] || 0,
        hasCostData: !!usageData.projectCosts?.[project._id],
        domains: project.services?.flatMap((s) => s.domains || []) || []
      }));
      
      return {
        name: account.name,
        provider,
        success: true,
        projects: projectsWithCost,
        usage: usageData,
        user,
        aihub
      };
    }
    case 'vercel':
      return { name: account.name, provider, success: true, ...await fetchVercelData(token) };
    case 'huggingface':
    case 'hugging_face':
      return { name: account.name, provider: 'huggingface', success: true, ...await fetchHuggingFaceData(token) };
    case 'railway':
      return { name: account.name, provider, success: true, ...await fetchRailwayData(token) };
    case 'render':
      return { name: account.name, provider, success: true, ...await fetchRenderData(token) };
    case 'clawcloud':
    case 'claw':
      return { name: account.name, provider: 'clawcloud', success: true, ...await fetchClawCloudData(token) };
    default:
      throw new Error(`暂不支持的云平台: ${provider}`);
  }
}

// 临时账号API - 获取账号信息
app.post('/api/temp-accounts', requireAuth, express.json(), async (req, res) => {
  const { accounts } = req.body;
  
  console.log('📥 收到账号请求:', accounts?.length, '个账号');
  
  if (!accounts || !Array.isArray(accounts)) {
    return res.status(400).json({ error: '无效的账号列表' });
  }
  
  const results = await Promise.all(accounts.map(async (account) => {
    const provider = (account.provider || 'zeabur').toLowerCase();
    try {
      const result = await fetchProviderAccount({ ...account, provider });
      const creditInCents = provider === 'zeabur'
        ? Math.round((result.usage?.freeQuotaRemaining ?? 0) * 100)
        : 0;
      
      return {
        name: account.name,
        provider,
        success: true,
        data: {
          ...(result.user || {}),
          credit: creditInCents,
          totalUsage: result.usage?.totalUsage,
          freeQuotaLimit: result.usage?.freeQuotaLimit
        },
        aihub: result.aihub
      };
    } catch (error) {
      console.error(`❌ [${account.name}] (${provider}) 错误:`, error.message);
      return {
        name: account.name,
        provider,
        success: false,
        error: error.message
      };
    }
  }));
  
  console.log('📤 返回结果:', results.length, '个账号');
  res.json(results);
});

// 临时账号API - 获取项目信息
app.post('/api/temp-projects', requireAuth, express.json(), async (req, res) => {
  const { accounts } = req.body;
  
  console.log('📥 收到项目请求:', accounts?.length, '个账号');
  
  if (!accounts || !Array.isArray(accounts)) {
    return res.status(400).json({ error: '无效的账号列表' });
  }
  
  const results = await Promise.all(accounts.map(async (account) => {
    const provider = (account.provider || 'zeabur').toLowerCase();
    try {
      console.log(`🔍 正在获取账号 [${account.name}] (${provider}) 的项目...`);
      const result = await fetchProviderAccount({ ...account, provider });
      
      console.log(`📦 [${account.name}] (${provider}) 找到 ${result.projects?.length || 0} 个项目`);
      return {
        name: account.name,
        provider,
        success: true,
        projects: result.projects || []
      };
    } catch (error) {
      console.error(`❌ [${account.name}] (${provider}) 错误:`, error.message);
      return {
        name: account.name,
        provider,
        success: false,
        error: error.message
      };
    }
  }));
  
  console.log('📤 返回项目结果');
  res.json(results);
});

// 验证账号
app.post('/api/validate-account', requireAuth, express.json(), async (req, res) => {
  const { accountName, apiToken, provider = 'zeabur' } = req.body;
  
  if (!accountName || !apiToken) {
    return res.status(400).json({ error: '账号名称和 API Token 不能为空' });
  }
  
  try {
    const result = await fetchProviderAccount({ name: accountName, token: apiToken, provider });
    const user = result.user || {};
    
    res.json({
      success: true,
      message: '账号验证成功！',
      userData: user,
      accountName,
      apiToken,
      provider: (provider || 'zeabur').toLowerCase()
    });
  } catch (error) {
    res.status(400).json({ error: 'API Token 验证失败: ' + error.message });
  }
});

// 从环境变量读取预配置的账号
function getEnvAccounts() {
  const accountsEnv = process.env.ACCOUNTS;
  if (!accountsEnv) return [];
  
  try {
    // 格式: "账号1名称:token1,账号2名称:token2"
    return accountsEnv.split(',').map(item => {
      const [rawName, token] = item.split(':');
      if (!rawName || !token) return null;
      const [name, provider] = rawName.split('|');
      return { name: name.trim(), token: normalizeToken(token), provider: (provider || 'zeabur').trim() };
    }).filter(acc => acc && acc.name && acc.token);
  } catch (e) {
    console.error('❌ 解析环境变量 ACCOUNTS 失败:', e.message);
    return [];
  }
}

// 检查是否已设置密码
// 检查加密密钥是否已设置
app.get('/api/check-encryption', (req, res) => {
  const crypto = require('crypto');
  // 生成一个随机密钥供用户使用
  const suggestedSecret = crypto.randomBytes(32).toString('hex');
  
  res.json({
    isConfigured: ENCRYPTION_ENABLED,
    suggestedSecret: suggestedSecret
  });
});

app.get('/api/check-password', (req, res) => {
  const savedPassword = loadAdminPassword();
  res.json({ hasPassword: !!savedPassword });
});

// 设置管理员密码（首次）
app.post('/api/set-password', (req, res) => {
  const { password } = req.body;
  const savedPassword = loadAdminPassword();
  
  if (savedPassword) {
    return res.status(400).json({ error: '密码已设置，无法重复设置' });
  }
  
  if (!password || password.length < 6) {
    return res.status(400).json({ error: '密码长度至少6位' });
  }
  
  if (saveAdminPassword(password)) {
    console.log('✅ 管理员密码已设置');
    res.json({ success: true });
  } else {
    res.status(500).json({ error: '保存密码失败' });
  }
});

// 验证密码
app.post('/api/verify-password', (req, res) => {
  const { password } = req.body;
  const savedPassword = loadAdminPassword();
  
  if (!savedPassword) {
    return res.status(400).json({ success: false, error: '请先设置密码' });
  }
  
  if (password === savedPassword) {
    // 生成新的session token
    const sessionToken = generateToken();
    activeSessions.set(sessionToken, { createdAt: Date.now() });
    console.log(`✅ 用户登录成功，生成Session: ${sessionToken.substring(0, 20)}...`);
    res.json({ success: true, sessionToken });
  } else {
    res.status(401).json({ success: false, error: '密码错误' });
  }
});

// 获取所有账号（服务器存储 + 环境变量）
app.get('/api/server-accounts', requireAuth, async (req, res) => {
  const serverAccounts = loadServerAccounts();
  const envAccounts = getEnvAccounts();
  
  // 合并账号，环境变量账号优先
  const allAccounts = [...envAccounts, ...serverAccounts];
  console.log(`📋 返回 ${allAccounts.length} 个账号 (环境变量: ${envAccounts.length}, 服务器: ${serverAccounts.length})`);
  res.json(allAccounts);
});

// 保存账号到服务器
app.post('/api/server-accounts', requireAuth, async (req, res) => {
  const { accounts } = req.body;
  
  if (!accounts || !Array.isArray(accounts)) {
    return res.status(400).json({ error: '无效的账号列表' });
  }
  
  if (saveServerAccounts(accounts)) {
    console.log(`✅ 保存 ${accounts.length} 个账号到服务器`);
    res.json({ success: true, message: '账号已保存到服务器' });
  } else {
    res.status(500).json({ error: '保存失败' });
  }
});

// 删除服务器账号
app.delete('/api/server-accounts/:index', requireAuth, async (req, res) => {
  const index = parseInt(req.params.index);
  const accounts = loadServerAccounts();
  
  if (index >= 0 && index < accounts.length) {
    const removed = accounts.splice(index, 1);
    if (saveServerAccounts(accounts)) {
      console.log(`🗑️ 删除账号: ${removed[0].name}`);
      res.json({ success: true, message: '账号已删除' });
    } else {
      res.status(500).json({ error: '删除失败' });
    }
  } else {
    res.status(404).json({ error: '账号不存在' });
  }
});

// 服务器配置的账号API（兼容旧版本）
app.get('/api/accounts', async (req, res) => {
  res.json([]);
});

app.get('/api/projects', async (req, res) => {
  res.json([]);
});

// 暂停服务
app.post('/api/service/pause', requireAuth, async (req, res) => {
  const { token, serviceId, environmentId, provider = 'zeabur' } = req.body;
  
  if ((provider || 'zeabur').toLowerCase() !== 'zeabur') {
    return res.status(400).json({ error: '暂停操作仅支持 Zeabur 服务' });
  }
  
  if (!token || !serviceId || !environmentId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  try {
    const mutation = `mutation { suspendService(serviceID: "${serviceId}", environmentID: "${environmentId}") }`;
    const result = await queryZeabur(token, mutation);
    
    if (result.data?.suspendService) {
      res.json({ success: true, message: '服务已暂停' });
    } else {
      res.status(400).json({ error: '暂停失败', details: result });
    }
  } catch (error) {
    res.status(500).json({ error: '暂停服务失败: ' + error.message });
  }
});

// 重启服务
app.post('/api/service/restart', requireAuth, async (req, res) => {
  const { token, serviceId, environmentId, provider = 'zeabur' } = req.body;
  
  if ((provider || 'zeabur').toLowerCase() !== 'zeabur') {
    return res.status(400).json({ error: '重启操作仅支持 Zeabur 服务' });
  }
  
  if (!token || !serviceId || !environmentId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  try {
    const mutation = `mutation { restartService(serviceID: "${serviceId}", environmentID: "${environmentId}") }`;
    const result = await queryZeabur(token, mutation);
    
    if (result.data?.restartService) {
      res.json({ success: true, message: '服务已重启' });
    } else {
      res.status(400).json({ error: '重启失败', details: result });
    }
  } catch (error) {
    res.status(500).json({ error: '重启服务失败: ' + error.message });
  }
});

// 获取服务日志
app.post('/api/service/logs', requireAuth, express.json(), async (req, res) => {
  const { token, serviceId, environmentId, projectId, limit = 200, provider = 'zeabur' } = req.body;
  
  if ((provider || 'zeabur').toLowerCase() !== 'zeabur') {
    return res.status(400).json({ error: '日志查询仅支持 Zeabur 服务' });
  }
  
  if (!token || !serviceId || !environmentId || !projectId) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  try {
    const query = `
      query {
        runtimeLogs(
          projectID: "${projectId}"
          serviceID: "${serviceId}"
          environmentID: "${environmentId}"
        ) {
          message
          timestamp
        }
      }
    `;
    
    const result = await queryZeabur(token, query);
    
    if (result.data?.runtimeLogs) {
      // 按时间戳排序，最新的在最后
      const sortedLogs = result.data.runtimeLogs.sort((a, b) => {
        return new Date(a.timestamp) - new Date(b.timestamp);
      });
      
      // 获取最后 N 条日志
      const logs = sortedLogs.slice(-limit);
      
      res.json({ 
        success: true, 
        logs,
        count: logs.length,
        totalCount: result.data.runtimeLogs.length
      });
    } else {
      res.status(400).json({ error: '获取日志失败', details: result });
    }
  } catch (error) {
    res.status(500).json({ error: '获取日志失败: ' + error.message });
  }
});

// 重命名项目
app.post('/api/project/rename', requireAuth, async (req, res) => {
  const { accountId, projectId, newName } = req.body;
  
  console.log(`📝 收到重命名请求: accountId=${accountId}, projectId=${projectId}, newName=${newName}`);
  
  if (!accountId || !projectId || !newName) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  
  try {
    // 从服务器存储中获取账号token
    const serverAccounts = loadServerAccounts();
    const account = serverAccounts.find(acc => (acc.id || acc.name) === accountId);
    
    if (!account || !account.token) {
      return res.status(404).json({ error: '未找到账号或token' });
    }
    
    if ((account.provider || 'zeabur').toLowerCase() !== 'zeabur') {
      return res.status(400).json({ error: '项目重命名仅支持 Zeabur 账号' });
    }
    
    const mutation = `mutation { renameProject(_id: "${projectId}", name: "${newName}") }`;
    console.log(`🔍 发送 GraphQL mutation:`, mutation);
    
    const result = await queryZeabur(account.token, mutation);
    console.log(`📥 API 响应:`, JSON.stringify(result, null, 2));
    
    if (result.data?.renameProject) {
      console.log(`✅ 项目已重命名: ${newName}`);
      res.json({ success: true, message: '项目已重命名' });
    } else {
      console.log(`❌ 重命名失败:`, result);
      res.status(400).json({ error: '重命名失败', details: result });
    }
  } catch (error) {
    console.log(`❌ 异常:`, error);
    res.status(500).json({ error: '重命名项目失败: ' + error.message });
  }
});

// 获取当前版本
app.get('/api/version', (req, res) => {
  res.json({ version: FIXED_VERSION });
});

// 获取GitHub最新版本
app.get('/api/latest-version', async (req, res) => {
  res.json({ version: FIXED_VERSION });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Cloud Monitor 运行在 http://0.0.0.0:${PORT}`);
  
  // 显示加密状态
  if (ENCRYPTION_ENABLED) {
    console.log(`🔐 Token 加密存储: 已启用 (AES-256-GCM)`);
  } else {
    console.log(`⚠️  Token 加密存储: 未启用 (建议设置 ACCOUNTS_SECRET 环境变量)`);
  }
  
  const envAccounts = getEnvAccounts();
  const serverAccounts = loadServerAccounts();
  const totalAccounts = envAccounts.length + serverAccounts.length;
  
  if (totalAccounts > 0) {
    console.log(`📋 已加载 ${totalAccounts} 个账号`);
    if (envAccounts.length > 0) {
      console.log(`   环境变量: ${envAccounts.length} 个`);
      envAccounts.forEach(acc => console.log(`     - ${acc.name}`));
    }
    if (serverAccounts.length > 0) {
      console.log(`   服务器存储: ${serverAccounts.length} 个`);
      serverAccounts.forEach(acc => console.log(`     - ${acc.name}`));
    }
  } else {
    console.log(`📊 准备就绪，等待添加账号...`);
  }
});
