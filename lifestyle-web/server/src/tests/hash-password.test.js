const crypto = require('crypto');

const { hashPassword, verifyPassword } = require('../utils/hash-password');

describe('hashPassword utilities', () => {
  it('hashes and verifies passwords with the active encryption key', () => {
    const hashed = hashPassword('Sup3rSecret!');
    expect(typeof hashed).toBe('string');
    expect(hashed.split(':')).toHaveLength(3);
    expect(verifyPassword('Sup3rSecret!', hashed)).toBe(true);
    expect(verifyPassword('wrong-password', hashed)).toBe(false);
  });

  it('accepts hashes encrypted with the fallback default secret', () => {
    const digest = crypto.createHash('sha256').update('LegacyPass!').digest();
    const key = crypto
      .createHash('sha256')
      .update('msml-lifestyle-monitor-passwords')
      .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(digest), cipher.final()]);
    const tag = cipher.getAuthTag();
    const legacyHash = [iv.toString('hex'), tag.toString('hex'), encrypted.toString('hex')].join(':');

    expect(verifyPassword('LegacyPass!', legacyHash)).toBe(true);
  });
});
