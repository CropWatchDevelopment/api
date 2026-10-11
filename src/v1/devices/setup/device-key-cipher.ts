import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for AppKeys in cw_device_inventory.
 * Stored form: `v1:<iv base64>:<ciphertext||tag base64>`. The DevEUI is bound
 * as associated data, so a ciphertext copied onto another row fails to
 * decrypt. The key is PRIVATE_DEVICE_KEY_ENCRYPTION_KEY: 32 bytes, base64.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEX32 = /^[0-9A-F]{32}$/;

export function readCipherKey(encoded: string | undefined): Buffer {
  const key = Buffer.from(encoded?.trim() ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error(
      'PRIVATE_DEVICE_KEY_ENCRYPTION_KEY must be 32 bytes (base64)',
    );
  }
  return key;
}

export function encryptAppKey(
  appKey: string,
  devEui: string,
  key: Buffer,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(devEui.toUpperCase(), 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(appKey.toUpperCase(), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `${VERSION}:${iv.toString('base64')}:${ciphertext.toString('base64')}`;
}

/** Decrypts and checks the result is a 32-hex AppKey; throws otherwise. */
export function decryptAppKey(
  stored: string,
  devEui: string,
  key: Buffer,
): string {
  const [version, ivPart, dataPart] = stored.split(':');
  if (version !== VERSION || !ivPart || !dataPart) {
    throw new Error('Unsupported AppKey ciphertext');
  }
  const data = Buffer.from(dataPart, 'base64');
  if (data.length <= TAG_BYTES) {
    throw new Error('Truncated AppKey ciphertext');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivPart, 'base64'),
  );
  decipher.setAAD(Buffer.from(devEui.toUpperCase(), 'utf8'));
  decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
  const appKey = Buffer.concat([
    decipher.update(data.subarray(0, data.length - TAG_BYTES)),
    decipher.final(),
  ]).toString('utf8');
  if (!HEX32.test(appKey)) {
    throw new Error('Decrypted AppKey is malformed');
  }
  return appKey;
}
