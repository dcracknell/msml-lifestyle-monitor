const crypto = require('crypto');

const AES_ALGORITHM = 'aes-256-gcm';
const DEFAULT_SECRET = 'msml-lifestyle-monitor-passwords';

function deriveEncryptionKeys() {
  const secrets = [process.env.PASSWORD_ENCRYPTION_KEY, process.env.SESSION_SECRET, DEFAULT_SECRET]
    .filter((secret) => typeof secret === 'string' && secret.length > 0);

  const uniqueSecrets = [...new Set(secrets)];
  if (!uniqueSecrets.length) {
    uniqueSecrets.push(DEFAULT_SECRET);
  }

  return uniqueSecrets.map((secret) =>
    crypto.createHash('sha256').update(secret).digest()
  );
}

const ENCRYPTION_KEYS = deriveEncryptionKeys();
const PRIMARY_KEY = ENCRYPTION_KEYS[0];

function createDigest(password) {
  const normalized = typeof password === 'string' ? password : '';
  return crypto.createHash('sha256').update(normalized).digest();
}

function decryptWithKey(key, ivHex, tagHex, encryptedHex) {
  try {
    const decipher = crypto.createDecipheriv(
      AES_ALGORITHM,
      key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, 'hex')),
      decipher.final(),
    ]);
  } catch (error) {
    return null;
  }
}

function hashPassword(password) {
  if (!PRIMARY_KEY) {
    throw new Error('Encryption key unavailable for password hashing.');
  }
  const digest = createDigest(password);
  const iv = crypto.randomBytes(12); // GCM recommended IV size
  const cipher = crypto.createCipheriv(AES_ALGORITHM, PRIMARY_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(digest), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || stored.length === 0) {
    return false;
  }

  const digest = createDigest(password);

  // Support legacy SHA-256 hex hashes so existing accounts can still sign in.
  if (/^[a-f0-9]{64}$/i.test(stored)) {
    const legacyBuffer = Buffer.from(stored, 'hex');
    if (legacyBuffer.length !== digest.length) {
      return false;
    }
    return crypto.timingSafeEqual(legacyBuffer, digest);
  }

  const [ivHex, tagHex, encryptedHex] = stored.split(':');
  if (!ivHex || !tagHex || !encryptedHex) {
    return false;
  }

  for (const key of ENCRYPTION_KEYS) {
    const decrypted = decryptWithKey(key, ivHex, tagHex, encryptedHex);
    if (!decrypted || decrypted.length !== digest.length) {
      continue;
    }
    if (crypto.timingSafeEqual(decrypted, digest)) {
      return true;
    }
  }
  return false;
}

module.exports = {
  hashPassword,
  verifyPassword,
};
