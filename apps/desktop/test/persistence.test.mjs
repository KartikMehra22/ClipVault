import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import {
  EncryptedClipboardPersistenceService,
  createEncryptedClipboardPersistenceService,
  PersistenceDisabledError,
  PersistenceValidationError,
  PersistenceSensitiveContentError,
  PersistenceEncryptionError,
  PersistenceDatabaseError,
  PersistenceRecordCorruptedError,
} from '../dist/services/clipboard/persistence.js';
import {
  EncryptionService,
  CryptoError,
  toClipEncryptionFields,
  CURRENT_ENCRYPTION_VERSION,
} from '../dist/services/crypto/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';
import { createClipRepository } from '@cliporbit/database';
import { MAX_SAFE_ITEM_BYTE_LENGTH } from '../dist/services/clipboard/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-persistence-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

class FakeKeyProtector {
  constructor(available = true) {
    this.available = available;
    this.storage = new Map();
  }

  isAvailable() {
    return this.available;
  }

  checkBackendSecurity() {}

  async protectKey(plainTextKeyHex) {
    const protectedBuf = Buffer.from(`ENC:${plainTextKeyHex}`, 'utf8');
    this.storage.set('key', protectedBuf);
    return protectedBuf;
  }

  async unprotectKey(protectedData) {
    const str = protectedData.toString('utf8');
    if (!str.startsWith('ENC:')) {
      throw new Error('Invalid protected data format.');
    }
    return {
      keyHex: str.slice(4),
      shouldReEncrypt: false,
    };
  }
}

async function setupTestEnvironment() {
  const tmpDir = createTempDir('cliporbit-pers-env-');

  // Initialize real EncryptionService with AES-256-GCM in isolated temp directory
  const encService = new EncryptionService();
  await encService.initialize({
    userDataPath: tmpDir,
    keyProtector: new FakeKeyProtector(),
  });

  // Initialize isolated SQLite database with migrations applied
  const dbResult = await initializeDatabase({ userDataPath: tmpDir });
  const client = dbResult.client;
  const clipRepo = createClipRepository(client);

  return {
    tmpDir,
    encService,
    client,
    clipRepo,
    async teardown() {
      encService.dispose();
      await closeDatabase();
    },
  };
}

before(() => {
  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    devDbInitialMtime = stat.mtimeMs;
    devDbInitialSize = stat.size;
  }
});

after(async () => {
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

  // Task 7.18: Verification that development database was not modified or destroyed
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
// Task 7 Tests: Encrypted Clipboard Persistence Service
// ============================================================================

test('Persistence 1 — Persistence disabled prevents encryption and database writes', async () => {
  let encryptCalled = false;
  let repoCreateCalled = false;

  const mockRepo = {
    create: async () => {
      repoCreateCalled = true;
      throw new Error('Should not be called');
    },
    findById: async () => null,
    findRecent: async () => [],
    pin: async () => null,
    unpin: async () => null,
    delete: async () => false,
    deleteExpired: async () => 0,
  };

  const mockEncService = {
    encrypt: () => {
      encryptCalled = true;
      throw new Error('Should not be called');
    },
    decrypt: () => Buffer.alloc(0),
  };

  const service = new EncryptedClipboardPersistenceService({
    repository: mockRepo,
    encryptionService: mockEncService,
    policy: () => false, // Explicitly disabled policy
  });

  assert.equal(service.isPersistenceEnabled(), false);

  await assert.rejects(
    async () => service.saveTextClip({ text: 'Safe clipboard snippet' }),
    PersistenceDisabledError,
  );

  assert.equal(encryptCalled, false, 'Encryption must not be invoked when persistence is disabled');
  assert.equal(
    repoCreateCalled,
    false,
    'Database create must not be invoked when persistence is disabled',
  );
});

test('Persistence 2 & 3 — Safe text is encrypted, saved, and retrieved to original value', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const sampleText = 'https://github.com/google-deepmind/antigravity';
    const result = await service.saveTextClip({
      text: sampleText,
      sourceApp: 'com.apple.Safari',
    });

    assert.ok(result.id);
    assert.equal(result.contentType, 'text/plain');
    assert.equal(result.byteLength, Buffer.byteLength(sampleText, 'utf8'));
    assert.equal(result.isPinned, false);

    // Retrieve recent clips
    const retrieval = await service.getRecentClips();
    assert.equal(retrieval.totalRetrieved, 1);
    assert.equal(retrieval.clips.length, 1);
    assert.equal(retrieval.skippedCorruptCount, 0);
    assert.equal(retrieval.skippedSensitiveCount, 0);

    const retrievedClip = retrieval.clips[0];
    assert.equal(retrievedClip.id, result.id);
    assert.equal(retrievedClip.text, sampleText);
    assert.equal(retrievedClip.sourceApp, 'com.apple.Safari');
    assert.equal(retrievedClip.byteLength, Buffer.byteLength(sampleText, 'utf8'));

    // Retrieve individually by ID
    const single = await service.getClipById(result.id);
    assert.ok(single);
    assert.equal(single.text, sampleText);
  } finally {
    await env.teardown();
  }
});

test('Persistence 4 & 5 — Raw plaintext is not stored; payload fields remain binary in database', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const secretProse = 'Confidential design notes for project Apollo 2026';
    const result = await service.saveTextClip({ text: secretProse });

    // Directly inspect raw SQLite record using Prisma client
    const rawRecord = await env.client.clip.findUnique({ where: { id: result.id } });
    assert.ok(rawRecord);

    const payloadBuffer = Buffer.from(rawRecord.encryptedPayload);
    const nonceBuffer = Buffer.from(rawRecord.encryptionNonce);
    const authTagBuffer = Buffer.from(rawRecord.encryptionAuthTag);

    // 4. Raw plaintext MUST NOT be stored in the encrypted payload column or any column
    assert.equal(
      payloadBuffer.includes(Buffer.from(secretProse, 'utf8')),
      false,
      'Raw plaintext MUST NEVER appear in encryptedPayload column',
    );
    assert.equal(
      JSON.stringify(rawRecord).includes(secretProse),
      false,
      'Raw plaintext MUST NOT appear in any stored database column',
    );

    // 5. Binary field contracts
    assert.equal(nonceBuffer.length, 12, 'GCM nonce must be 12 bytes');
    assert.equal(authTagBuffer.length, 16, 'GCM auth tag must be 16 bytes');
    assert.equal(rawRecord.encryptionVersion, CURRENT_ENCRYPTION_VERSION);
    assert.equal(rawRecord.isSensitive, false);
  } finally {
    await env.teardown();
  }
});

test('Persistence 6 — Repeated saves create separate records with unique nonces and ciphertexts', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const text = 'Repeated clipboard item';
    const first = await service.saveTextClip({ text });
    const second = await service.saveTextClip({ text });

    // Distinct record IDs
    assert.notEqual(first.id, second.id);

    const raw1 = await env.client.clip.findUnique({ where: { id: first.id } });
    const raw2 = await env.client.clip.findUnique({ where: { id: second.id } });

    // Distinct random nonces ensure distinct ciphertexts even for identical input text
    assert.notDeepEqual(raw1.encryptionNonce, raw2.encryptionNonce);
    assert.notDeepEqual(raw1.encryptedPayload, raw2.encryptedPayload);

    // Both decrypt accurately
    const history = await service.getRecentClips();
    assert.equal(history.clips.length, 2);
    assert.equal(history.clips[0].text, text);
    assert.equal(history.clips[1].text, text);
  } finally {
    await env.teardown();
  }
});

test('Persistence 7 — Sensitive text is rejected before encryption and persistence', async () => {
  const env = await setupTestEnvironment();
  try {
    let encryptionCalled = false;
    const trackingEncService = {
      encrypt: (bytes) => {
        encryptionCalled = true;
        return env.encService.encrypt(bytes);
      },
      decrypt: (input) => env.encService.decrypt(input),
    };

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: trackingEncService,
      policy: () => true,
    });

    const sensitiveCandidates = [
      'AKIAIOSFODNN7EXAMPLE',
      'ghp_123456789012345678901234567890123456',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----',
      'DATABASE_URL="postgres://admin:super_secret_pw@localhost:5432/db"',
    ];

    for (const secret of sensitiveCandidates) {
      encryptionCalled = false;
      await assert.rejects(
        async () => service.saveTextClip({ text: secret }),
        PersistenceSensitiveContentError,
      );
      assert.equal(encryptionCalled, false, 'Encryption must not be called for sensitive items');
    }

    // Verify database remains empty
    const count = await env.client.clip.count();
    assert.equal(count, 0, 'No records must be written for sensitive content');
  } finally {
    await env.teardown();
  }
});

test('Persistence 8 — An over-limit item is rejected before encryption and persistence', async () => {
  const env = await setupTestEnvironment();
  try {
    let encryptionCalled = false;
    const trackingEncService = {
      encrypt: (bytes) => {
        encryptionCalled = true;
        return env.encService.encrypt(bytes);
      },
      decrypt: (input) => env.encService.decrypt(input),
    };

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: trackingEncService,
      policy: () => true,
    });

    // 1 byte over safe limit
    const oversizedText = 'A'.repeat(MAX_SAFE_ITEM_BYTE_LENGTH + 1);

    await assert.rejects(
      async () => service.saveTextClip({ text: oversizedText }),
      PersistenceValidationError,
    );

    assert.equal(encryptionCalled, false, 'Encryption must not be invoked for oversized items');

    const count = await env.client.clip.count();
    assert.equal(count, 0, 'No records must be created for oversized items');
  } finally {
    await env.teardown();
  }
});

test('Persistence 9 — Encryption failure does not create a database record', async () => {
  const env = await setupTestEnvironment();
  try {
    const failingEncService = {
      encrypt: () => {
        throw new CryptoError('Master key unavailable.');
      },
      decrypt: () => Buffer.alloc(0),
    };

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: failingEncService,
      policy: () => true,
    });

    await assert.rejects(
      async () => service.saveTextClip({ text: 'Normal safe clipboard content' }),
      PersistenceEncryptionError,
    );

    const count = await env.client.clip.count();
    assert.equal(count, 0, 'No database record must be created if encryption fails');
  } finally {
    await env.teardown();
  }
});

test('Persistence 10 — Database failure does not trigger plaintext fallback', async () => {
  const env = await setupTestEnvironment();
  try {
    const failingRepo = {
      create: async () => {
        throw new Error('Disk I/O error');
      },
      findById: async () => null,
      findRecent: async () => [],
      pin: async () => null,
      unpin: async () => null,
      delete: async () => false,
      deleteExpired: async () => 0,
    };

    const service = createEncryptedClipboardPersistenceService({
      repository: failingRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    await assert.rejects(
      async () => service.saveTextClip({ text: 'Candidate text' }),
      PersistenceDatabaseError,
    );
  } finally {
    await env.teardown();
  }
});

test('Persistence 11 & 12 — Corrupted ciphertext and auth failure do not leak content or return plaintext', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const text = 'Valid text prior to corruption';
    const saved = await service.saveTextClip({ text });

    // Manually corrupt the ciphertext in SQLite
    const corruptBytes = crypto.randomBytes(32);
    await env.client.clip.update({
      where: { id: saved.id },
      data: { encryptedPayload: corruptBytes },
    });

    // 11. Corrupted ciphertext must be skipped without returning plaintext
    const result = await service.getRecentClips();
    assert.equal(
      result.clips.length,
      0,
      'Corrupted record must be excluded from decrypted results',
    );
    assert.equal(result.skippedCorruptCount, 1, 'Corrupted record must be counted in telemetry');

    // 12. getClipById fails closed on corrupted record without exposing plaintext
    await assert.rejects(
      async () => service.getClipById(saved.id),
      PersistenceRecordCorruptedError,
    );
  } finally {
    await env.teardown();
  }
});

test('Persistence 13 — Sensitive record already present in database is not exposed by history retrieval', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    // 1. Save an ordinary safe clip
    await service.saveTextClip({ text: 'Normal benign clip' });

    // 2. Directly inject an encrypted clip containing a synthetic AWS key into SQLite
    const fakeKey = 'AKIAIOSFODNN7EXAMPLE';
    const fakeKeyBytes = Buffer.from(fakeKey, 'utf8');
    const encPayload = env.encService.encrypt(fakeKeyBytes);
    const encFields = toClipEncryptionFields(encPayload, fakeKeyBytes.byteLength);

    await env.clipRepo.create({
      contentType: 'text/plain',
      ...encFields,
      isSensitive: false, // Injected as false to verify second-pass scanning
    });

    // 3. Directly inject another clip explicitly marked isSensitive: true
    const safeBytes = Buffer.from('Safe text but flagged sensitive', 'utf8');
    const encSafe = env.encService.encrypt(safeBytes);
    const encSafeFields = toClipEncryptionFields(encSafe, safeBytes.byteLength);

    await env.clipRepo.create({
      contentType: 'text/plain',
      ...encSafeFields,
      isSensitive: true,
    });

    // Retrieve history: only the benign clip should be returned
    const retrieval = await service.getRecentClips();
    assert.equal(retrieval.totalRetrieved, 3);
    assert.equal(retrieval.clips.length, 1);
    assert.equal(retrieval.clips[0].text, 'Normal benign clip');
    assert.equal(retrieval.skippedSensitiveCount, 2);
  } finally {
    await env.teardown();
  }
});

test('Persistence 14 — Bounded retrieval respects pagination and stable ordering', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const now = Date.now();
    for (let i = 1; i <= 5; i++) {
      await service.saveTextClip({
        text: `Item ${i}`,
        createdAt: new Date(now + i * 1000),
      });
    }

    // Page 1: limit 2, offset 0 -> Item 5, Item 4
    const page1 = await service.getRecentClips({ limit: 2, offset: 0 });
    assert.equal(page1.clips.length, 2);
    assert.equal(page1.clips[0].text, 'Item 5');
    assert.equal(page1.clips[1].text, 'Item 4');

    // Page 2: limit 2, offset 2 -> Item 3, Item 2
    const page2 = await service.getRecentClips({ limit: 2, offset: 2 });
    assert.equal(page2.clips.length, 2);
    assert.equal(page2.clips[0].text, 'Item 3');
    assert.equal(page2.clips[1].text, 'Item 2');

    // Page 3: limit 2, offset 4 -> Item 1
    const page3 = await service.getRecentClips({ limit: 2, offset: 4 });
    assert.equal(page3.clips.length, 1);
    assert.equal(page3.clips[0].text, 'Item 1');
  } finally {
    await env.teardown();
  }
});

test('Persistence 15 — Pin, unpin, and delete operations behave correctly', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const saved = await service.saveTextClip({ text: 'Pinnable note' });
    assert.equal(saved.isPinned, false);

    // Pin
    const pinSuccess = await service.pinClip(saved.id);
    assert.equal(pinSuccess, true);
    const pinnedClip = await service.getClipById(saved.id);
    assert.ok(pinnedClip);
    assert.equal(pinnedClip.isPinned, true);
    assert.ok(pinnedClip.pinnedAt instanceof Date);

    // Unpin
    const unpinSuccess = await service.unpinClip(saved.id);
    assert.equal(unpinSuccess, true);
    const unpinnedClip = await service.getClipById(saved.id);
    assert.ok(unpinnedClip);
    assert.equal(unpinnedClip.isPinned, false);
    assert.equal(unpinnedClip.pinnedAt, null);

    // Delete
    const deleteSuccess = await service.deleteClip(saved.id);
    assert.equal(deleteSuccess, true);
    const deletedClip = await service.getClipById(saved.id);
    assert.equal(deletedClip, null);

    // Nonexistent IDs
    const fakeId = '00000000-0000-0000-0000-000000000000';
    assert.equal(await service.pinClip(fakeId), false);
    assert.equal(await service.unpinClip(fakeId), false);
    assert.equal(await service.deleteClip(fakeId), false);
  } finally {
    await env.teardown();
  }
});

test('Persistence 16 — Expired-record cleanup preserves unexpired records', async () => {
  const env = await setupTestEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy: () => true,
    });

    const now = new Date();
    const past = new Date(now.getTime() - 60000);
    const future = new Date(now.getTime() + 60000);

    // Expired item
    await service.saveTextClip({ text: 'Expired clip', expiresAt: past });
    // Future expiration item
    await service.saveTextClip({ text: 'Future clip', expiresAt: future });
    // No expiration item
    await service.saveTextClip({ text: 'Permanent clip', expiresAt: null });

    const purgedCount = await service.deleteExpiredClips(now);
    assert.equal(purgedCount, 1);

    const remaining = await service.getRecentClips();
    assert.equal(remaining.clips.length, 2);
    const remainingTexts = remaining.clips.map((c) => c.text);
    assert.ok(remainingTexts.includes('Future clip'));
    assert.ok(remainingTexts.includes('Permanent clip'));
    assert.equal(remainingTexts.includes('Expired clip'), false);
  } finally {
    await env.teardown();
  }
});

test('Persistence 17 — No persistence occurs automatically when the service module is imported', async () => {
  // Re-importing the module dynamically must not initiate connections or write files
  const mod = await import('../dist/services/clipboard/persistence.js');
  assert.ok(mod.EncryptedClipboardPersistenceService);
  assert.ok(mod.createEncryptedClipboardPersistenceService);
});
