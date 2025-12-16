/**
 * 生成加密密钥脚本
 * 运行: node generate-secret.js
 */

const crypto = require('crypto');

console.log('[KEY] 正在生成加密密钥...\n');

// 生成 32 字节（256 位）随机密钥
const secret = crypto.randomBytes(32).toString('hex');

console.log('[OK] 生成成功! 请妥善保管此密钥:\n');
console.log('================================================================');
console.log(secret);
console.log('================================================================\n');

console.log('[INFO] 请将此密钥添加到 .env 文件中:\n');
console.log(`ACCOUNTS_SECRET=${secret}\n`);

console.log('[WARN] 重要提示:');
console.log('  1. 不要将密钥提交到 Git');
console.log('  2. 不要在代码中硬编码密钥');
console.log('  3. 妥善保管密钥, 丢失后无法解密数据');
console.log('  4. 定期轮换密钥以提高安全性\n');
