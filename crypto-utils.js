/**
 * 加密工具模块
 * 使用 AES-256-GCM 算法加密/解密敏感数据
 */

const crypto = require('crypto');

/**
 * 加密数据
 * @param {string} plaintext - 明文数据
 * @param {string} secret - 64位十六进制密钥
 * @returns {object} { encrypted, iv, authTag }
 */
function encryptData(plaintext, secret) {
  // 验证密钥格式
  if (!secret || secret.length !== 64) {
    throw new Error('密钥必须是64位十六进制字符串');
  }
  
  // 将十六进制密钥转换为 Buffer
  const key = Buffer.from(secret, 'hex');
  
  // 生成随机 IV（初始化向量）
  const iv = crypto.randomBytes(16);
  
  // 创建加密器
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  
  // 加密数据
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // 获取认证标签
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * 解密数据
 * @param {object} encryptedData - { encrypted, iv, authTag }
 * @param {string} secret - 64位十六进制密钥
 * @returns {string} 明文数据
 */
function decryptData(encryptedData, secret) {
  try {
    // 验证密钥格式
    if (!secret || secret.length !== 64) {
      throw new Error('密钥必须是64位十六进制字符串');
    }
    
    // 将十六进制密钥转换为 Buffer
    const key = Buffer.from(secret, 'hex');
    
    // 将 IV 和 authTag 转换为 Buffer
    const iv = Buffer.from(encryptedData.iv, 'hex');
    const authTag = Buffer.from(encryptedData.authTag, 'hex');
    
    // 创建解密器
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    
    // 设置认证标签（验证数据完整性）
    decipher.setAuthTag(authTag);
    
    // 解密数据
    let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error(`解密失败: ${error.message}`);
  }
}

module.exports = {
  encryptData,
  decryptData
};
