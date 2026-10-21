/**
 * ClipOrbit — AES-256-GCM Payload Cryptography Module
 * Phase 4.5: Encryption and Decryption Service
 *
 * Implements authenticated binary payload encryption and decryption
 * using Node.js built-in `node:crypto` APIs.
 */

import crypto from 'node:crypto';
import {
  AES_GCM_ALGORITHM,
  AES_256_KEY_LENGTH_BYTES,
  AES_GCM_NONCE_LENGTH_BYTES,
  AES_GCM_AUTH_TAG_LENGTH_BYTES,
  CURRENT_ENCRYPTION_VERSION,
  type EncryptedPayload,
  type DecryptPayloadInput,
  type EncryptedClipFields,
  type EncryptedSnippetFields,
  CryptoValidationError,
  PayloadAuthenticationError,
  UnsupportedEncryptionVersionError,
} from './types';

/**
 * Normalizes an incoming buffer or Uint8Array into a Node.js Buffer
 * without copying if already a Buffer.
 */
function toBuffer(data: Buffer | Uint8Array, paramName: string): Buffer {
  if (data === null || data === undefined) {
    throw new CryptoValidationError(
      `Parameter "${paramName}" must be provided as a Buffer or Uint8Array.`,
    );
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (data instanceof Uint8Array) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new CryptoValidationError(
    `Parameter "${paramName}" must be a Buffer or Uint8Array (received ${typeof data}).`,
  );
}

/**
 * Validates that an encryption key is a 32-byte (256-bit) buffer.
 */
export function validateKey(key: Buffer | Uint8Array): Buffer {
  const keyBuf = toBuffer(key, 'key');
  if (keyBuf.length !== AES_256_KEY_LENGTH_BYTES) {
    throw new CryptoValidationError(
      `Invalid key length: expected ${AES_256_KEY_LENGTH_BYTES} bytes (256 bits), received ${keyBuf.length} bytes.`,
    );
  }
  return keyBuf;
}

/**
 * Generates a cryptographically strong 32-byte (256-bit) master encryption key.
 */
export function generateMasterKey(): Buffer {
  return crypto.randomBytes(AES_256_KEY_LENGTH_BYTES);
}

/**
 * Encrypts an arbitrary binary payload using AES-256-GCM.
 *
 * Requirements:
 * - Generates a fresh, unique 12-byte random nonce for every call.
 * - Extracts a 16-byte GCM authentication tag.
 * - Supports empty payloads (0-byte buffers).
 * - Never converts binary buffers to lossy strings.
 *
 * @param plaintext Arbitrary binary data as Buffer or Uint8Array.
 * @param key 32-byte AES-256 master key.
 * @returns EncryptedPayload record containing ciphertext, nonce, authTag, and version.
 */
export function encryptPayloadWithKey(
  plaintext: Buffer | Uint8Array,
  key: Buffer | Uint8Array,
): EncryptedPayload {
  const keyBuf = validateKey(key);
  const plainBuf = toBuffer(plaintext, 'plaintext');

  // Fresh 12-byte random nonce for every operation
  const nonce = crypto.randomBytes(AES_GCM_NONCE_LENGTH_BYTES);

  const cipher = crypto.createCipheriv(AES_GCM_ALGORITHM, keyBuf, nonce, {
    authTagLength: AES_GCM_AUTH_TAG_LENGTH_BYTES,
  });

  const ciphertext = Buffer.concat([cipher.update(plainBuf), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext,
    nonce,
    authTag,
    version: CURRENT_ENCRYPTION_VERSION,
  };
}

/**
 * Authenticates and decrypts an encrypted payload using AES-256-GCM.
 *
 * Validation:
 * - Encryption version must match CURRENT_ENCRYPTION_VERSION (1).
 * - Nonce must be exactly 12 bytes.
 * - Authentication tag must be exactly 16 bytes.
 * - Decryption fails closed if authentication tag does not match ciphertext or key.
 *
 * Generic errors:
 * - On authentication failure or corruption, throws PayloadAuthenticationError without
 *   leaking sensitive data, keys, or ciphertext details.
 *
 * @param input Encrypted payload record with ciphertext, nonce, authTag, and optional version.
 * @param key 32-byte AES-256 master key.
 * @returns Decrypted plaintext Buffer.
 */
export function decryptPayloadWithKey(
  input: DecryptPayloadInput,
  key: Buffer | Uint8Array,
): Buffer {
  if (!input || typeof input !== 'object') {
    throw new CryptoValidationError('Decryption input must be a valid object.');
  }

  const keyBuf = validateKey(key);

  const version = input.version !== undefined ? input.version : CURRENT_ENCRYPTION_VERSION;
  if (version !== CURRENT_ENCRYPTION_VERSION) {
    throw new UnsupportedEncryptionVersionError(version);
  }

  const nonce = toBuffer(input.nonce, 'nonce');
  if (nonce.length !== AES_GCM_NONCE_LENGTH_BYTES) {
    throw new CryptoValidationError(
      `Invalid nonce length: expected ${AES_GCM_NONCE_LENGTH_BYTES} bytes, received ${nonce.length} bytes.`,
    );
  }

  const authTag = toBuffer(input.authTag, 'authTag');
  if (authTag.length !== AES_GCM_AUTH_TAG_LENGTH_BYTES) {
    throw new CryptoValidationError(
      `Invalid authentication tag length: expected ${AES_GCM_AUTH_TAG_LENGTH_BYTES} bytes, received ${authTag.length} bytes.`,
    );
  }

  const ciphertext = toBuffer(input.ciphertext, 'ciphertext');

  try {
    const decipher = crypto.createDecipheriv(AES_GCM_ALGORITHM, keyBuf, nonce, {
      authTagLength: AES_GCM_AUTH_TAG_LENGTH_BYTES,
    });
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
  } catch (err) {
    // Fail closed! If the error is already a typed validation error, let it propagate,
    // otherwise wrap OpenSSL decipher errors in generic PayloadAuthenticationError.
    if (err instanceof CryptoValidationError || err instanceof UnsupportedEncryptionVersionError) {
      throw err;
    }
    throw new PayloadAuthenticationError('Failed to authenticate or decrypt payload.');
  }
}

// ---------------------------------------------------------------------------
// Database Schema Compatibility Helpers
// ---------------------------------------------------------------------------

/**
 * Maps an EncryptedPayload into database fields matching the Clip model schema.
 */
export function toClipEncryptionFields(
  encrypted: EncryptedPayload,
  originalByteLength: number,
): EncryptedClipFields {
  if (
    typeof originalByteLength !== 'number' ||
    originalByteLength < 0 ||
    !Number.isInteger(originalByteLength)
  ) {
    throw new CryptoValidationError('originalByteLength must be a non-negative integer.');
  }
  return {
    encryptedPayload: encrypted.ciphertext,
    encryptionNonce: encrypted.nonce,
    encryptionAuthTag: encrypted.authTag,
    encryptionVersion: encrypted.version,
    payloadByteLength: originalByteLength,
  };
}

/**
 * Maps an EncryptedPayload into database fields matching the Snippet model schema.
 */
export function toSnippetEncryptionFields(encrypted: EncryptedPayload): EncryptedSnippetFields {
  return {
    encryptedContent: encrypted.ciphertext,
    encryptionNonce: encrypted.nonce,
    encryptionAuthTag: encrypted.authTag,
    encryptionVersion: encrypted.version,
  };
}

/**
 * Constructs a DecryptPayloadInput from database Clip record fields.
 */
export function fromClipRecord(clip: {
  encryptedPayload: Buffer | Uint8Array;
  encryptionNonce: Buffer | Uint8Array;
  encryptionAuthTag?: Buffer | Uint8Array | null;
  encryptionVersion: number;
}): DecryptPayloadInput {
  if (!clip.encryptionAuthTag) {
    throw new CryptoValidationError('Clip record is missing required encryptionAuthTag.');
  }
  return {
    ciphertext: clip.encryptedPayload,
    nonce: clip.encryptionNonce,
    authTag: clip.encryptionAuthTag,
    version: clip.encryptionVersion,
  };
}

/**
 * Constructs a DecryptPayloadInput from database Snippet record fields.
 */
export function fromSnippetRecord(snippet: {
  encryptedContent: Buffer | Uint8Array;
  encryptionNonce: Buffer | Uint8Array;
  encryptionAuthTag?: Buffer | Uint8Array | null;
  encryptionVersion: number;
}): DecryptPayloadInput {
  if (!snippet.encryptionAuthTag) {
    throw new CryptoValidationError('Snippet record is missing required encryptionAuthTag.');
  }
  return {
    ciphertext: snippet.encryptedContent,
    nonce: snippet.encryptionNonce,
    authTag: snippet.encryptionAuthTag,
    version: snippet.encryptionVersion,
  };
}
