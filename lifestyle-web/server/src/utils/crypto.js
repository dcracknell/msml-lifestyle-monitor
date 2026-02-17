const crypto = require('crypto');

const DEFAULT_SECRET = 'msml-lifestyle-monitor';
const SECRET = process.env.SESSION_SECRET || DEFAULT_SECRET;
const KEY = crypto.createHash('sha256').update(SECRET).digest();

function encryptPayload(payload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const serialized = Buffer.from(JSON.stringify(payload), 'utf8');
  const encrypted = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptPayload(token) {
  try {
    const buffer = Buffer.from(token, 'base64');
    const iv = buffer.subarray(0, 12);
    const tag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);

    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    return JSON.parse(decrypted.toString('utf8'));
  } catch (error) {
    return null;
  }
}

module.exports = {
  encryptPayload,
  decryptPayload,
};
