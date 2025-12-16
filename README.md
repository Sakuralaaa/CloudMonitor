# ☁️ Cloud Monitor（多云账号监控面板）

一个美观、强大的多云账号监控工具，支持 Zeabur、Vercel、Hugging Face、Railway、Render、ClawCloud 等平台，实时显示额度、项目与服务状态。

![](https://img.shields.io/badge/Node.js-18+-green.svg)
![](https://img.shields.io/badge/License-MIT-blue.svg)
![](https://img.shields.io/badge/Multi--Cloud-Ready-blueviolet.svg)

## ✨ 功能特性

- 🎨 **现代化 UI** - 蓝白主色 + 玻璃拟态，支持明亮/黑夜模式快速切换
- ☁️ **多云监控** - Zeabur / Vercel / Hugging Face / Railway / Render / ClawCloud 一站式查看
- 💰 **实时额度** - Zeabur 显示每月免费额度剩余（$X.XX / $5.00）
- ***项目费用追踪** - Zeabur 项目费用统计
- ✏️ **项目快速改名** -（Zeabur）点击铅笔图标即可重命名项目
- 🌐 **域名显示** - 显示项目的域名，点击直接访问
- 🐳 **服务状态监控** - Zeabur 服务运行状态和资源配置
-  ***多账号支持** - 同时管理多个云平台账号
-  ***自动刷新** - 每 90 秒自动更新数据
- 📱 **响应式设计** - 完美适配各种屏幕尺寸
- 🤗 **Hugging Face 扩展** - 同时展示 Spaces / Models / Datasets，管理空间更直观
- ***密码保护** - 管理员密码验证，保护账号安全
- 💾 **服务器存储** - 账号数据存储在服务器，多设备自动同步
- ⏸️ **服务控制** -（Zeabur）暂停、启动、重启服务
- 📋 **查看日志** -（Zeabur）实时查看服务运行日志
- ℹ️ **版本提示简化** - 当前与最新版本固定为 1.0，已取消更新状态提示

## 📦 快速开始

### 前置要求

- Node.js 18+
- 至少一个支持的云平台账号和 API Token（Zeabur / Vercel / Hugging Face / Railway / Render / ClawCloud）

### 获取 API Token

#### Zeabur
1. 登录 [Zeabur 控制台](https://zeabur.com)
2. 点击右上角头像 → **Settings**
3. 找到 **Developer** 或 **API Keys** 选项
4. 点击 **Create Token**
5. 复制生成的 Token（格式：`sk-xxxxxxxxxxxxxxxx`）

#### Vercel
1. 登录 [Vercel 控制台](https://vercel.com/dashboard)
2. 右上角头像 → **Settings** → **Tokens**
3. 点击 **Create**，选择 **Personal** 或指定团队（团队 Token 会自动识别默认团队）
4. 至少勾选 **Read** 权限，复制生成的 Token（以 `vercel_` 开头）

#### Hugging Face
1. 访问 [Account → Settings → Access Tokens](https://huggingface.co/settings/tokens)
2. 点击 **New token**，选择 **Read** 或需要的最小权限
3. 复制生成的 Token

#### Railway
1. 登录 Railway → 右上角头像 → **Account** → **API Keys**
2. 点击 **Generate API Key**，复制生成的 Key

#### Render
1. 登录 Render → 右上角头像 → **Account Settings**
2. 进入 **API Keys**，点击 **Create API Key**
3. 复制生成的 Key

#### ClawCloud
1. 登录 ClawCloud 控制台
2. 在 **Profile / Settings** 中找到 **API Tokens**
3. 创建并复制 Token

> 环境变量 `ACCOUNTS` 中可通过 `名称|provider:token` 指定平台，例如 `my-vercel|vercel:vercel_***`。

#### Token 输入提示
- 推荐直接粘贴裸 Token（例如 `hf_xxx` / `vercel_xxx`），程序会自动去除多余的空格与 `Bearer ` 前缀，避免 Hugging Face、Vercel 等因前缀重复导致校验失败。
- 批量导入或环境变量导入 Hugging Face 时，请将 `provider` 设为 `huggingface`。
- Hugging Face 仓库列表接口格式偶尔变化，面板已兼容不同格式，并会同时展示 Spaces / Models / Datasets，不会再因仓库数据结构异常导致校验失败。
- Hugging Face Spaces / Models / Datasets 拉取时会携带 Bearer Token 并按账号及其组织命名空间查询，确保使用具备读取权限的 Token 才能完整展示所有私有资源。

### 本地部署

```bash
# 1. 克隆项目
git clone https://github.com/Sakuralaaa/cloud-monitor.git
cd cloud-monitor

# 2. 配置环境变量（强烈推荐）
cp .env.example .env
# 运行生成脚本获取 64 位密钥，写入 .env 的 ACCOUNTS_SECRET
node generate-secret.js

# 3. 安装依赖
npm install

# 4. 启动服务
npm start

# 5. 访问应用
# 打开浏览器访问：http://localhost:3000
```

### 云端部署（Zeabur 示例）

详细部署步骤请查看 [DEPLOY.md](./DEPLOY.md)

## 📖 使用说明

### 首次使用

1. 访问应用后，首次使用需要设置管理员密码（至少 6 位）
2. 设置完成后，使用密码登录
3. 点击 **"⚙️ 管理账号"** 添加云平台账号

### 添加账号

#### 单个添加
1. 点击 **"⚙️ 管理账号"**
2. 输入账号名称和 API Token
3. 点击 **"➕ 添加到列表"**

#### 批量添加
支持以下格式（每行一个账号）：
- `账号名称:API_Token`
- `账号名称：API_Token`
- `账号名称(API_Token)`
- `账号名称（API_Token）`

### 界面主题
- 右上角「🌙 / ☀️」按钮可切换黑夜 / 明亮模式，默认使用蓝白配色，夜间模式会自动提高对比度。

### 项目改名

1. 找到项目卡片
2. 点击项目名称右侧的 **✏️** 铅笔图标
3. 输入新名称，按 `Enter` 保存或 `Esc` 取消

### 服务控制

- **暂停服务**：点击 **⏸️ 暂停** 按钮
- **启动服务**：点击 **▶️ 启动** 按钮
- **重启服务**：点击 **🔄 重启** 按钮
- **查看日志**：点击 **📋 日志** 按钮

## 🔧 技术栈

- **后端**：Node.js + Express
- **前端**：Vue.js 3 (CDN)
- **API**：Zeabur GraphQL API
- **样式**：原生 CSS（玻璃拟态效果）

## 📁 项目结构

```
cloud-monitor/
├── public/
│   ├── index.html      # 前端页面
│   ├── bg.png          # 背景图片
│   └── favicon.png     # 网站图标
├── server.js           # 后端服务
├── package.json        # 项目配置
├── .env.example        # 环境变量示例
├── .gitignore          # Git 忽略规则
├── zbpack.json         # Zeabur 配置
├── README.md           # 项目说明
└── DEPLOY.md           # 部署指南
```

## 🔒 安全说明

### 密码保护
- 首次使用需要设置管理员密码（至少 6 位）
- 密码存储在服务器的 `password.json` 文件中
- 登录后 10 天内自动保持登录状态

### API Token 安全
- Token 存储在服务器的 `accounts.json` 文件中
- 输入时自动打码显示（`●●●●●●`）
- 不会暴露在前端代码或浏览器中

### 重要提示
⚠️ **请勿将以下文件提交到 Git：**
- `.env` - 环境变量
- `accounts.json` - 账号数据
- `password.json` - 管理员密码

这些文件已在 `.gitignore` 中配置。

## 🎨 自定义

### 更换背景图片
替换 `public/bg.png` 为你喜欢的图片

### 修改主题色
`public/index.html` 顶部定义了 `--accent-color` / `--accent-soft` / `--bg-gradient` 等主题变量，调整后即可全局生效，同时配合前端的明亮/夜间模式开关使用。

## 🔄 多设备同步

账号信息存储在服务器上，所有设备自动同步！

- 在电脑上添加账号 → 手机、平板立即可见
- 在手机上删除账号 → 所有设备同步删除
- 无需任何配置，开箱即用

## 🛠️ 开发

### 环境变量（可选）

创建 `.env` 文件：
```env
PORT=3000
ACCOUNTS=账号1|zeabur:token1,账号2|vercel:token2
```

### API 端点

- `GET /` - 前端页面
- `POST /api/check-password` - 检查是否已设置密码
- `POST /api/set-password` - 设置管理员密码
- `POST /api/verify-password` - 验证密码
- `POST /api/temp-accounts` - 获取账号信息
- `POST /api/temp-projects` - 获取项目信息
- `POST /api/validate-account` - 验证账号
- `GET /api/server-accounts` - 获取服务器存储的账号
- `POST /api/server-accounts` - 保存账号到服务器
- `DELETE /api/server-accounts/:index` - 删除账号
- `POST /api/project/rename` - 重命名项目
- `POST /api/service/pause` - 暂停服务
- `POST /api/service/restart` - 重启服务
- `POST /api/service/logs` - 获取服务日志

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 自由使用和修改

## ⭐ Star History

如果这个项目对你有帮助，请给个 Star ⭐

## 🙏 致谢

- [Zeabur](https://zeabur.com) - 提供优秀的云服务平台
- [Vue.js](https://vuejs.org) - 渐进式 JavaScript 框架
- [Express](https://expressjs.com) - 快速、开放、极简的 Web 框架

---

Made with ❤️ by [jiujiu532](https://github.com/jiujiu532)
