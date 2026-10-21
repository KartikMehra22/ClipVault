/**
 * ClipOrbit — Cryptographic Service Test Suite
 * Phase 4.5: Encryption and Decryption Service
 *
 * Verifies:
 * 1. AES-256-GCM payload encryption and decryption contracts.
 * 2. Nonce generation uniqueness, binary preservation, and edge cases.
 * 3. Authentication tag verification and fail-closed behavior on corruption.
 * 4. Master key creation, OS-protected persistence, fail-closed loading, and memory disposal.
 * 5. SafeStorage protector adapter and Linux backend security validation.
 * 6. High-level EncryptionService lifecycle and singleton functions.
 * 7. Database schema compatibility with Clip and Snippet repository models.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import {
  // Cipher
  encryptPayloadWithKey,
  decryptPayloadWithKey,
  generateMasterKey,
  validateKey,
  toClipEncryptionFields,
  toSnippetEncryptionFields,
  fromClipRecord,
  fromSnippetRecord,

  // Key manager & protector
  resolveCryptoPaths,
  MasterKeyManager,
  atomicWriteProtectedFile,
  ElectronSafeStorageProtector,
  FakeKeyProtector,

  // Service
  EncryptionService,
  initializeEncryptionService,
  encryptPayload,
  decryptPayload,
  disposeEncryptionService,
  isEncryptionServiceInitialized,

  // Types & Errors
  CURRENT_ENCRYPTION_VERSION,
  CryptoError,
  CryptoValidationError,
  PayloadAuthenticationError,
  KeyManagementError,
  InsecureStorageError,
  UnsupportedEncryptionVersionError,
} from '../dist/services/crypto/index.js';

import { initializeDatabase, closeDatabase } from '../dist/services/database.js';

import { createClipRepository, createSnippetRepository } from '@cliporbit/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-crypto-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

before(() => {
  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    devDbInitialMtime = stat.mtimeMs;
    devDbInitialSize = stat.size;
  }
});

after(async () => {
  disposeEncryptionService();
  await closeDatabase();

  for (const dir of tempDirsToCleanup) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup error in test tear-down
    }
  }

  // Development database must never be touched
  if (fs.existsSync(devDbPath) && devDbInitialMtime !== null) {
    const currentStat = fs.statSync(devDbPath);
    assert.equal(
      currentStat.mtimeMs,
      devDbInitialMtime,
      'DEVELOPMENT DATABASE INTEGRITY VIOLATION: dev.db modification time changed!',
    );
    assert.equal(
      currentStat.size,
      devDbInitialSize,
      'DEVELOPMENT DATABASE INTEGRITY VIOLATION: dev.db file size changed!',
    );
  }
});

// ============================================================================
// 1. Pure AES-256-GCM Payload Cryptography
// ============================================================================

test('Cipher - encrypts and decrypts an ordinary byte buffer', () => {
  const key = generateMasterKey();
  const rawPlaintext = Buffer.from('Clipboard confidential secret message 🚀', 'utf8');

  const encrypted = encryptPayloadWithKey(rawPlaintext, key);

  assert.ok(Buffer.isBuffer(encrypted.ciphertext));
  assert.ok(Buffer.isBuffer(encrypted.nonce));
  assert.ok(Buffer.isBuffer(encrypted.authTag));
  assert.equal(encrypted.version, CURRENT_ENCRYPTION_VERSION);
  assert.equal(encrypted.nonce.length, 12);
  assert.equal(encrypted.authTag.length, 16);
  assert.notDeepEqual(encrypted.ciphertext, rawPlaintext);

  const decrypted = decryptPayloadWithKey(encrypted, key);
  assert.deepEqual(decrypted, rawPlaintext);
  assert.equal(decrypted.toString('utf8'), 'Clipboard confidential secret message 🚀');
});

test('Cipher - supports empty buffer payloads', () => {
  const key = generateMasterKey();
  const emptyPlaintext = Buffer.alloc(0);

  const encrypted = encryptPayloadWithKey(emptyPlaintext, key);

  assert.equal(encrypted.ciphertext.length, 0);
  assert.equal(encrypted.nonce.length, 12);
  assert.equal(encrypted.authTag.length, 16);

  const decrypted = decryptPayloadWithKey(encrypted, key);
  assert.equal(decrypted.length, 0);
  assert.deepEqual(decrypted, emptyPlaintext);
});

test('Cipher - preserves arbitrary binary bytes exactly without lossy conversion', () => {
  const key = generateMasterKey();
  // 4KB of synthetic random binary data including 0x00 and high bytes
  const arbitraryBytes = crypto.randomBytes(4096);

  const encrypted = encryptPayloadWithKey(arbitraryBytes, key);
  const decrypted = decryptPayloadWithKey(encrypted, key);

  assert.equal(decrypted.length, arbitraryBytes.length);
  assert.deepEqual(decrypted, arbitraryBytes);
});

test('Cipher - accepts Uint8Array inputs and returns Buffer', () => {
  const key = new Uint8Array(generateMasterKey());
  const plaintext = new Uint8Array([0x01, 0x02, 0x03, 0xff, 0xfe, 0x00]);

  const encrypted = encryptPayloadWithKey(plaintext, key);
  const decrypted = decryptPayloadWithKey(
    {
      ciphertext: new Uint8Array(encrypted.ciphertext),
      nonce: new Uint8Array(encrypted.nonce),
      authTag: new Uint8Array(encrypted.authTag),
      version: 1,
    },
    key,
  );

  assert.deepEqual(decrypted, Buffer.from(plaintext));
});

test('Cipher - generates unique nonce and distinct ciphertext for identical plaintext', () => {
  const key = generateMasterKey();
  const plaintext = Buffer.from('repeated identical input string', 'utf8');

  const nonces = new Set();
  const ciphertexts = new Set();
  const iterations = 50;

  for (let i = 0; i < iterations; i++) {
    const encrypted = encryptPayloadWithKey(plaintext, key);
    nonces.add(encrypted.nonce.toString('hex'));
    ciphertexts.add(encrypted.ciphertext.toString('hex'));
  }

  assert.equal(nonces.size, iterations, 'Every encryption operation must produce a unique nonce');
  assert.equal(
    ciphertexts.size,
    iterations,
    'Identical plaintext must produce distinct ciphertexts',
  );
});

test('Cipher - rejects invalid key sizes', () => {
  const plaintext = Buffer.from('data', 'utf8');
  const invalidSizes = [0, 8, 16, 24, 31, 33, 64];

  for (const size of invalidSizes) {
    const badKey = crypto.randomBytes(size);
    assert.throws(
      () => encryptPayloadWithKey(plaintext, badKey),
      CryptoValidationError,
      `Should reject key of size ${size}`,
    );
  }
});

test('Cipher - validateKey accepts 32-byte buffers and rejects invalid lengths', () => {
  const goodKey = crypto.randomBytes(32);
  assert.equal(validateKey(goodKey).length, 32);
  assert.throws(() => validateKey(crypto.randomBytes(16)), CryptoValidationError);
  assert.throws(() => validateKey(null), CryptoValidationError);
});

test('Cipher - rejects invalid nonce lengths', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(Buffer.from('data', 'utf8'), key);

  const invalidNonceLengths = [0, 4, 8, 11, 13, 16, 32];
  for (const length of invalidNonceLengths) {
    assert.throws(
      () =>
        decryptPayloadWithKey(
          {
            ...encrypted,
            nonce: crypto.randomBytes(length),
          },
          key,
        ),
      CryptoValidationError,
      `Should reject nonce of length ${length}`,
    );
  }
});

test('Cipher - rejects invalid authentication tag lengths', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(Buffer.from('data', 'utf8'), key);

  const invalidTagLengths = [0, 8, 12, 15, 17, 32];
  for (const length of invalidTagLengths) {
    assert.throws(
      () =>
        decryptPayloadWithKey(
          {
            ...encrypted,
            authTag: crypto.randomBytes(length),
          },
          key,
        ),
      CryptoValidationError,
      `Should reject auth tag of length ${length}`,
    );
  }
});

test('Cipher - rejects unsupported encryption versions', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(Buffer.from('data', 'utf8'), key);

  const unsupportedVersions = [0, 2, 3, 99];
  for (const version of unsupportedVersions) {
    assert.throws(
      () => decryptPayloadWithKey({ ...encrypted, version }, key),
      (err) =>
        err instanceof UnsupportedEncryptionVersionError && err.unsupportedVersion === version,
    );
  }
});

test('Cipher - rejects modified ciphertext (fails closed)', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(Buffer.from('Sensitive payload to protect', 'utf8'), key);

  // Tamper with the first byte of ciphertext
  const tamperedCiphertext = Buffer.from(encrypted.ciphertext);
  tamperedCiphertext[0] ^= 0x01;

  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, ciphertext: tamperedCiphertext }, key),
    PayloadAuthenticationError,
  );
});

test('Cipher - rejects modified authentication tag (fails closed)', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(Buffer.from('Sensitive payload to protect', 'utf8'), key);

  // Tamper with authentication tag
  const tamperedAuthTag = Buffer.from(encrypted.authTag);
  tamperedAuthTag[tamperedAuthTag.length - 1] ^= 0x01;

  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, authTag: tamperedAuthTag }, key),
    PayloadAuthenticationError,
  );
});

test('Cipher - rejects decryption with different key', () => {
  const keyA = generateMasterKey();
  const keyB = generateMasterKey();
  const plaintext = Buffer.from('Confidential data encrypted under key A', 'utf8');

  const encrypted = encryptPayloadWithKey(plaintext, keyA);

  assert.throws(() => decryptPayloadWithKey(encrypted, keyB), PayloadAuthenticationError);
});

test('Cipher - authentication errors do not leak sensitive details', () => {
  const keyA = generateMasterKey();
  const keyB = generateMasterKey();
  const secretString = 'VERY_SECRET_CREDENTIAL_XYZ_123';
  const encrypted = encryptPayloadWithKey(Buffer.from(secretString, 'utf8'), keyA);

  try {
    decryptPayloadWithKey(encrypted, keyB);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err instanceof PayloadAuthenticationError);
    assert.equal(err.message, 'Failed to authenticate or decrypt payload.');
    assert.ok(!err.message.includes(secretString));
    assert.ok(!err.message.includes(keyA.toString('hex')));
    assert.ok(!err.message.includes(keyB.toString('hex')));
  }
});

test('Cipher - rejects truncated or malformed encrypted records', () => {
  const key = generateMasterKey();
  const encrypted = encryptPayloadWithKey(
    Buffer.from('Complete record payload for truncation test', 'utf8'),
    key,
  );

  // 1. Truncate ciphertext
  const truncatedCiphertext = encrypted.ciphertext.subarray(0, 5);
  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, ciphertext: truncatedCiphertext }, key),
    PayloadAuthenticationError,
  );

  // 2. Null or undefined fields
  assert.throws(() => decryptPayloadWithKey(null, key), CryptoValidationError);
  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, nonce: null }, key),
    CryptoValidationError,
  );
  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, authTag: null }, key),
    CryptoValidationError,
  );
  assert.throws(
    () => decryptPayloadWithKey({ ...encrypted, ciphertext: null }, key),
    CryptoValidationError,
  );
});

// ============================================================================
// 2. Master Key Lifecycle and Path Resolution
// ============================================================================

test('KeyManager - resolves paths to <userData>/crypto/master-key.enc', () => {
  const tmpDir = createTempDir('cliporbit-crypto-paths-');
  const paths = resolveCryptoPaths(tmpDir);

  assert.equal(paths.userDataDir, path.resolve(tmpDir));
  assert.equal(paths.cryptoDir, path.join(tmpDir, 'crypto'));
  assert.equal(paths.masterKeyPath, path.join(tmpDir, 'crypto', 'master-key.enc'));
});

test('KeyManager - creates new master key file when absent', async () => {
  const tmpDir = createTempDir('cliporbit-key-create-');
  const fakeProtector = new FakeKeyProtector();

  const manager = new MasterKeyManager({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  const keyPath = manager.getMasterKeyPath();
  assert.equal(fs.existsSync(keyPath), false);

  const key = await manager.loadOrCreateKey();
  assert.equal(Buffer.isBuffer(key), true);
  assert.equal(key.length, 32);
  assert.equal(fs.existsSync(keyPath), true);
  assert.equal(fakeProtector.protectCallCount, 1);

  // File should not contain the raw key hex in plaintext
  const fileContent = fs.readFileSync(keyPath, 'utf8');
  assert.ok(!fileContent.includes(key.toString('hex')));
});

test('KeyManager - reloads existing master key and decrypts earlier data', async () => {
  const tmpDir = createTempDir('cliporbit-key-reload-');
  const fakeProtector = new FakeKeyProtector();

  // 1. Initial manager creates the key
  const manager1 = new MasterKeyManager({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });
  const key1 = await manager1.loadOrCreateKey();
  const savedKey1Copy = Buffer.from(key1);
  const plaintext = Buffer.from('Data written during session 1', 'utf8');
  const encrypted = encryptPayloadWithKey(plaintext, key1);
  manager1.dispose();

  // 2. Second manager loads existing key from disk
  const manager2 = new MasterKeyManager({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });
  const key2 = await manager2.loadOrCreateKey();
  assert.deepEqual(key2, savedKey1Copy);

  // Decrypt session 1 data using loaded key
  const decrypted = decryptPayloadWithKey(encrypted, key2);
  assert.deepEqual(decrypted, plaintext);
  manager2.dispose();
});

test('KeyManager - refuses to overwrite existing file in atomic write without flag', () => {
  const tmpDir = createTempDir('cliporbit-atomic-');
  const targetPath = path.join(tmpDir, 'test-file.enc');
  fs.writeFileSync(targetPath, Buffer.from('existing', 'utf8'));

  assert.throws(
    () => atomicWriteProtectedFile(targetPath, Buffer.from('new data', 'utf8'), false),
    KeyManagementError,
  );
});

test('KeyManager - fails closed and does not overwrite corrupt existing key file', async () => {
  const tmpDir = createTempDir('cliporbit-corrupt-key-');
  const paths = resolveCryptoPaths(tmpDir);
  fs.mkdirSync(paths.cryptoDir, { recursive: true });

  // Corrupt existing key file with arbitrary data
  const corruptData = Buffer.from('CORRUPTED_NON_ENCRYPTED_DATA_BYTES', 'utf8');
  fs.writeFileSync(paths.masterKeyPath, corruptData);

  const fakeProtector = new FakeKeyProtector();
  const manager = new MasterKeyManager({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  await assert.rejects(
    async () => await manager.loadOrCreateKey(),
    (err) => err instanceof KeyManagementError,
  );

  // CRITICAL: File must NOT have been replaced with a newly generated key!
  const currentContent = fs.readFileSync(paths.masterKeyPath);
  assert.deepEqual(currentContent, corruptData);
});

test('KeyManager - fails closed on empty existing key file', async () => {
  const tmpDir = createTempDir('cliporbit-empty-key-');
  const paths = resolveCryptoPaths(tmpDir);
  fs.mkdirSync(paths.cryptoDir, { recursive: true });
  fs.writeFileSync(paths.masterKeyPath, Buffer.alloc(0));

  const fakeProtector = new FakeKeyProtector();
  const manager = new MasterKeyManager({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  await assert.rejects(
    async () => await manager.loadOrCreateKey(),
    (err) => err instanceof KeyManagementError && err.message.includes('empty or corrupted'),
  );

  // Ensure not overwritten
  assert.equal(fs.readFileSync(paths.masterKeyPath).length, 0);
});

test('KeyManager - handles key rotation flag (shouldReEncrypt)', async () => {
  const tmpDir = createTempDir('cliporbit-rotation-');
  const fakeProtector = new FakeKeyProtector({ shouldReEncryptOnDecrypt: true });

  // 1. Create initial key
  const manager1 = new MasterKeyManager({ userDataPath: tmpDir, keyProtector: fakeProtector });
  await manager1.loadOrCreateKey();
  assert.equal(fakeProtector.protectCallCount, 1);
  manager1.dispose();

  // 2. Load existing key with rotation flag enabled
  const manager2 = new MasterKeyManager({ userDataPath: tmpDir, keyProtector: fakeProtector });
  await manager2.loadOrCreateKey();
  // Expect protectCallCount to increment due to re-encryption on load
  assert.equal(fakeProtector.protectCallCount, 2);
  manager2.dispose();
});

test('KeyManager - dispose clears in-memory key buffer with zeroes', async () => {
  const tmpDir = createTempDir('cliporbit-dispose-');
  const fakeProtector = new FakeKeyProtector();
  const manager = new MasterKeyManager({ userDataPath: tmpDir, keyProtector: fakeProtector });

  const keyBuffer = await manager.loadOrCreateKey();
  assert.equal(manager.isKeyLoaded(), true);

  // Retain a reference to verify memory zeroing
  manager.dispose();

  assert.equal(manager.isKeyLoaded(), false);
  assert.throws(() => manager.getActiveKey(), KeyManagementError);

  // Check that the buffer was zero-filled
  const isZeroed = keyBuffer.every((byte) => byte === 0);
  assert.equal(isZeroed, true, 'Active master key buffer must be filled with zeroes on disposal');
});

test('KeyManager - cleans up temp file when atomic write fails', () => {
  const tmpDir = createTempDir('cliporbit-atomic-fail-');
  // Attempt to write into an impossible path where a regular file blocks directory creation
  const blockerFile = path.join(tmpDir, 'existing-blocker');
  fs.writeFileSync(blockerFile, 'file-not-dir');
  const impossiblePath = path.join(blockerFile, 'crypto', 'master-key.enc');

  assert.throws(
    () => atomicWriteProtectedFile(impossiblePath, Buffer.from('data', 'utf8'), true),
    KeyManagementError,
  );

  // Ensure no leftover .tmp files created in tmpDir
  const files = fs.readdirSync(tmpDir);
  assert.equal(
    files.some((f) => f.includes('.tmp.')),
    false,
  );
});

// ============================================================================
// 3. safeStorage Adapter & Security Checks
// ============================================================================

test('SafeStorageAdapter - rejects when safeStorage is unavailable', () => {
  const mockStorage = {
    isEncryptionAvailable: () => false,
    encryptStringAsync: async () => Buffer.alloc(0),
    decryptStringAsync: async () => ({ shouldReEncrypt: false, result: '' }),
  };

  const protector = new ElectronSafeStorageProtector(mockStorage);
  assert.equal(protector.isAvailable(), false);
  assert.throws(() => protector.checkBackendSecurity(), InsecureStorageError);
});

test('SafeStorageAdapter - rejects Linux basic_text backend as insecure', () => {
  const originalPlatform = process.platform;
  try {
    // Simulate linux platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const mockStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'basic_text',
      encryptStringAsync: async () => Buffer.alloc(0),
      decryptStringAsync: async () => ({ shouldReEncrypt: false, result: '' }),
    };

    const protector = new ElectronSafeStorageProtector(mockStorage);
    assert.throws(
      () => protector.checkBackendSecurity(),
      (err) => err instanceof InsecureStorageError && err.message.includes('basic_text'),
    );
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

test('SafeStorageAdapter - accepts Linux secure backend (gnome_libsecret)', () => {
  const originalPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    const mockStorage = {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptStringAsync: async () => Buffer.alloc(0),
      decryptStringAsync: async () => ({ shouldReEncrypt: false, result: '' }),
    };

    const protector = new ElectronSafeStorageProtector(mockStorage);
    assert.doesNotThrow(() => protector.checkBackendSecurity());
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
});

// ============================================================================
// 4. Combined EncryptionService & Singleton Functions
// ============================================================================

test('EncryptionService - cannot encrypt or decrypt before initialization', () => {
  const service = new EncryptionService();
  assert.equal(service.isReady(), false);

  assert.throws(() => service.encrypt(Buffer.from('data', 'utf8')), CryptoError);
  assert.throws(
    () =>
      service.decrypt({
        ciphertext: Buffer.alloc(10),
        nonce: Buffer.alloc(12),
        authTag: Buffer.alloc(16),
      }),
    CryptoError,
  );
});

test('EncryptionService - lifecycle: initialize, encrypt, decrypt, and dispose', async () => {
  const tmpDir = createTempDir('cliporbit-service-life-');
  const fakeProtector = new FakeKeyProtector();
  const service = new EncryptionService();

  const status = await service.initialize({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  assert.equal(status.isInitialized, true);
  assert.equal(service.isReady(), true);

  const rawBytes = Buffer.from('Sensitive payload test 12345', 'utf8');
  const encrypted = service.encrypt(rawBytes);

  assert.notDeepEqual(encrypted.ciphertext, rawBytes);
  const decrypted = service.decrypt(encrypted);
  assert.deepEqual(decrypted, rawBytes);

  service.dispose();
  assert.equal(service.isReady(), false);
  assert.throws(() => service.encrypt(rawBytes), CryptoError);
});

test('Singleton EncryptionService - initializeEncryptionService and module functions', async () => {
  disposeEncryptionService();
  assert.equal(isEncryptionServiceInitialized(), false);

  assert.throws(
    () => encryptPayload(Buffer.from('data', 'utf8')),
    (err) => err instanceof CryptoError && err.message.includes('not initialized'),
  );

  const tmpDir = createTempDir('cliporbit-singleton-');
  const fakeProtector = new FakeKeyProtector();

  const status = await initializeEncryptionService({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  assert.equal(status.isInitialized, true);
  assert.equal(isEncryptionServiceInitialized(), true);

  const payload = Buffer.from('Singleton payload test', 'utf8');
  const encrypted = encryptPayload(payload);
  const decrypted = decryptPayload(encrypted);

  assert.deepEqual(decrypted, payload);

  disposeEncryptionService();
  assert.equal(isEncryptionServiceInitialized(), false);
});

test('Public API - never exposes master key bytes or internal key material', async () => {
  const tmpDir = createTempDir('cliporbit-no-leak-');
  const fakeProtector = new FakeKeyProtector();
  const service = new EncryptionService();

  const status = await service.initialize({
    userDataPath: tmpDir,
    keyProtector: fakeProtector,
  });

  // Verify initialization status contains no key
  assert.equal(typeof status.masterKeyPath, 'string');
  assert.equal(status.isInitialized, true);
  assert.equal('key' in status, false);
  assert.equal('masterKey' in status, false);

  const encrypted = service.encrypt(Buffer.from('secret payload', 'utf8'));
  assert.equal('key' in encrypted, false);
  assert.equal('masterKey' in encrypted, false);

  const clipFields = toClipEncryptionFields(encrypted, 14);
  assert.equal('key' in clipFields, false);
  assert.equal('masterKey' in clipFields, false);

  const snippetFields = toSnippetEncryptionFields(encrypted);
  assert.equal('key' in snippetFields, false);
  assert.equal('masterKey' in snippetFields, false);

  service.dispose();
});

// ============================================================================
// 5. Database Schema Compatibility and Repositories Integration
// ============================================================================

test('Schema Compatibility - mapping helpers produce matching repository input types', () => {
  const key = generateMasterKey();
  const rawBytes = Buffer.from('Payload for clip and snippet database models', 'utf8');
  const encrypted = encryptPayloadWithKey(rawBytes, key);

  // Clip mapping
  const clipFields = toClipEncryptionFields(encrypted, rawBytes.byteLength);
  assert.equal(clipFields.payloadByteLength, rawBytes.byteLength);
  assert.equal(clipFields.encryptionVersion, 1);
  assert.deepEqual(clipFields.encryptedPayload, encrypted.ciphertext);
  assert.deepEqual(clipFields.encryptionNonce, encrypted.nonce);
  assert.deepEqual(clipFields.encryptionAuthTag, encrypted.authTag);

  const fromClipInput = fromClipRecord(clipFields);
  assert.deepEqual(decryptPayloadWithKey(fromClipInput, key), rawBytes);

  // Snippet mapping
  const snippetFields = toSnippetEncryptionFields(encrypted);
  assert.equal(snippetFields.encryptionVersion, 1);
  assert.deepEqual(snippetFields.encryptedContent, encrypted.ciphertext);
  assert.deepEqual(snippetFields.encryptionNonce, encrypted.nonce);
  assert.deepEqual(snippetFields.encryptionAuthTag, encrypted.authTag);

  const fromSnippetInput = fromSnippetRecord(snippetFields);
  assert.deepEqual(decryptPayloadWithKey(fromSnippetInput, key), rawBytes);
});

test('Schema Compatibility - end-to-end repository persistence and decryption in isolated SQLite DB', async () => {
  const tmpDir = createTempDir('cliporbit-repo-e2e-');
  const fakeProtector = new FakeKeyProtector();

  // 1. Initialize EncryptionService
  const encService = new EncryptionService();
  await encService.initialize({ userDataPath: tmpDir, keyProtector: fakeProtector });

  // 2. Initialize isolated SQLite database with migrations applied
  const dbResult = await initializeDatabase({ userDataPath: tmpDir });
  const client = dbResult.client;

  try {
    const clipRepo = createClipRepository(client);
    const snippetRepo = createSnippetRepository(client);

    // Test Clip: binary JPEG-like header payload
    const rawClipBytes = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
      crypto.randomBytes(512),
    ]);

    const encryptedClip = encService.encrypt(rawClipBytes);
    const clipRecord = await clipRepo.create({
      contentType: 'image/jpeg',
      ...toClipEncryptionFields(encryptedClip, rawClipBytes.byteLength),
      sourceApp: 'com.apple.Safari',
    });

    assert.ok(clipRecord.id);
    assert.equal(clipRecord.payloadByteLength, rawClipBytes.byteLength);
    assert.deepEqual(Buffer.from(clipRecord.encryptedPayload), encryptedClip.ciphertext);

    // Fetch and decrypt
    const fetchedClip = await clipRepo.findById(clipRecord.id);
    assert.ok(fetchedClip);
    const decryptedClipPayload = encService.decrypt(fromClipRecord(fetchedClip));
    assert.deepEqual(decryptedClipPayload, rawClipBytes);

    // Test Snippet: binary code snippet payload
    const rawSnippetBytes = Buffer.from('function clipOrbit() { return "encrypted"; }', 'utf8');
    const encryptedSnippet = encService.encrypt(rawSnippetBytes);

    const snippetRecord = await snippetRepo.create({
      title: 'ClipOrbit Encrypted Snippet',
      language: 'typescript',
      ...toSnippetEncryptionFields(encryptedSnippet),
    });

    assert.ok(snippetRecord.id);
    assert.deepEqual(Buffer.from(snippetRecord.encryptedContent), encryptedSnippet.ciphertext);

    // Fetch and decrypt snippet
    const fetchedSnippet = await snippetRepo.findById(snippetRecord.id);
    assert.ok(fetchedSnippet);
    const decryptedSnippetContent = encService.decrypt(fromSnippetRecord(fetchedSnippet));
    assert.deepEqual(decryptedSnippetContent, rawSnippetBytes);
    assert.equal(
      decryptedSnippetContent.toString('utf8'),
      'function clipOrbit() { return "encrypted"; }',
    );
  } finally {
    encService.dispose();
    await closeDatabase();
  }
});
