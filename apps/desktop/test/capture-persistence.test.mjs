/**
 * ClipOrbit — Clipboard Capture & Encrypted Persistence Integration Test Suite
 * Phase 6.3.3.1: Integrate Clipboard Capture with Encrypted Persistence
 *
 * Verifies:
 * 1. With persistence disabled, capture works in memory but writes no database records.
 * 2. With persistence enabled, a newly accepted eligible text capture is saved encrypted.
 * 3. Repeated polling or status retrieval does not create duplicate writes for the same accepted capture.
 * 4. Existing in-memory items are not backfilled when consent changes from disabled to enabled.
 * 5. Sensitive and oversized clipboard contents are never persisted.
 * 6. Unsupported content does not bypass existing text-only restrictions.
 * 7. A persistence error does not crash or stop normal in-memory capture.
 * 8. Disabling capture stops new capture-driven save requests according to existing stop semantics.
 * 9. A successful disable operation cannot complete while an older save remains capable of committing afterward.
 * 10. A failed preference mutation activates the existing fail-closed behavior and prevents subsequent saves.
 * 11. Concurrent captures and consent changes cannot bypass the policy through stale authorization.
 * 12. The existing explicit-start and first-poll baseline semantics remain unchanged.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ClipboardCaptureService,
  FakeClipboardAdapter,
  createClipboardPersistencePolicy,
  createEncryptedClipboardPersistenceService,
  PersistenceDisabledError,
} from '../dist/services/clipboard/index.js';
import { EncryptionService } from '../dist/services/crypto/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';
import { createClipRepository, createAppSettingRepository } from '@cliporbit/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-capture-persistence-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

class FakeKeyProtector {
  constructor() {
    this.storage = new Map();
  }

  isAvailable() {
    return true;
  }

  checkBackendSecurity() {}

  async protectKey(plainTextKeyHex) {
    const protectedBuf = Buffer.from(`ENC:${plainTextKeyHex}`, 'utf8');
    this.storage.set('key', protectedBuf);
    return protectedBuf;
  }

  async unprotectKey(protectedData) {
    const str = protectedData.toString('utf8');
    return {
      keyHex: str.slice(4),
      shouldReEncrypt: false,
    };
  }
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setupIsolatedEnvironment() {
  const tmpDir = createTempDir('cliporbit-cap-env-');

  const encService = new EncryptionService();
  await encService.initialize({
    userDataPath: tmpDir,
    keyProtector: new FakeKeyProtector(),
  });

  const dbResult = await initializeDatabase({ userDataPath: tmpDir });
  const client = dbResult.client;
  const clipRepo = createClipRepository(client);
  const settingRepo = createAppSettingRepository(client);
  const policy = createClipboardPersistencePolicy(settingRepo);
  const persistenceService = createEncryptedClipboardPersistenceService({
    repository: clipRepo,
    encryptionService: encService,
    policy,
  });

  return {
    tmpDir,
    encService,
    client,
    clipRepo,
    settingRepo,
    policy,
    persistenceService,
    async cleanup() {
      try {
        await closeDatabase();
      } catch {
        /* ignore */
      }
      try {
        encService.dispose();
      } catch {
        /* ignore */
      }
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

after(() => {
  // Ensure development database was not touched
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

  for (const dir of tempDirsToCleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

// ============================================================================
// Phase 6.3.3.1 Tests
// ============================================================================

test('Capture-Persistence 1 — With persistence disabled, capture works in memory but writes no database records', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();
    adapter.setText('In-memory only text clip');
    await service.pollNow();

    const inMemoryItems = service.getRecentItems();
    assert.equal(inMemoryItems.length, 1);
    assert.equal(inMemoryItems[0].text, 'In-memory only text clip');

    const dbClips = await env.clipRepo.findRecent();
    assert.equal(
      dbClips.length,
      0,
      'No database records should be written when persistence is disabled',
    );
    assert.equal(service.getStatus().itemCount, 1);
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 2 — With persistence enabled, a newly accepted eligible text capture is saved encrypted', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();
    adapter.setText('Confidential project notes for ClipOrbit');
    await service.pollNow();

    // Verify in-memory state
    const inMemoryItems = service.getRecentItems();
    assert.equal(inMemoryItems.length, 1);
    const captured = inMemoryItems[0];
    assert.equal(captured.text, 'Confidential project notes for ClipOrbit');

    // Verify database record
    const dbClips = await env.clipRepo.findRecent();
    assert.equal(dbClips.length, 1);
    const clip = dbClips[0];

    assert.equal(clip.id, captured.id);
    assert.equal(clip.contentType, 'text/plain');
    assert.equal(clip.encryptionVersion, 1);

    const payloadBuffer = Buffer.from(clip.encryptedPayload);
    const nonceBuffer = Buffer.from(clip.encryptionNonce);
    const authTagBuffer = Buffer.from(clip.encryptionAuthTag);

    assert.equal(nonceBuffer.length, 12);
    assert.equal(authTagBuffer.length, 16);
    assert.equal(clip.isSensitive, false);

    // Verify ciphertext does not leak plaintext
    const rawCiphertext = payloadBuffer.toString('utf8');
    assert.ok(!rawCiphertext.includes('Confidential'));
    assert.ok(!rawCiphertext.includes('ClipOrbit'));

    // Verify decryption via persistence service
    const retrieved = await env.persistenceService.getRecentClips();
    assert.equal(retrieved.clips.length, 1);
    assert.equal(retrieved.clips[0].text, 'Confidential project notes for ClipOrbit');
    assert.equal(retrieved.clips[0].id, captured.id);
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 3 — Repeated polling or status retrieval does not create duplicate writes for the same accepted capture', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();
    adapter.setText('Single unique clip');
    await service.pollNow();

    const initialClips = await env.clipRepo.findRecent();
    assert.equal(initialClips.length, 1);

    // Trigger multiple polling evaluations without clipboard change
    for (let i = 0; i < 5; i++) {
      await service.pollNow();
      service.getStatus();
      service.getRecentItems();
    }

    const afterClips = await env.clipRepo.findRecent();
    assert.equal(afterClips.length, 1, 'Repeated polling must not create duplicate writes');
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 4 — Existing in-memory items are not backfilled when consent changes from disabled to enabled', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    // Start with consent disabled
    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();

    adapter.setText('Captured while disabled 1');
    await service.pollNow();

    adapter.setText('Captured while disabled 2');
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 2);
    assert.equal((await env.clipRepo.findRecent()).length, 0);

    // Now enable persistence
    await env.policy.setPersistenceEnabled(true);

    // Poll without change — existing items must not be backfilled
    await service.pollNow();
    service.getStatus();
    assert.equal(
      (await env.clipRepo.findRecent()).length,
      0,
      'No backfill of prior in-memory items on consent enable',
    );

    // Subsequent new capture must be saved
    adapter.setText('Captured after persistence enabled');
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 3);
    const dbClips = await env.clipRepo.findRecent();
    assert.equal(dbClips.length, 1, 'Only future eligible captures are persisted');

    const retrieved = await env.persistenceService.getRecentClips();
    assert.equal(retrieved.clips.length, 1);
    assert.equal(retrieved.clips[0].text, 'Captured after persistence enabled');
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 5 — Sensitive and oversized clipboard contents are never persisted', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();

    // 1. Sensitive text: Synthetic private key
    adapter.setText(
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0m...\n-----END RSA PRIVATE KEY-----',
    );
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 0);
    assert.equal((await env.clipRepo.findRecent()).length, 0);
    assert.equal(service.getStatus().skippedSensitiveCount, 1);

    // 2. Sensitive text: Synthetic AWS Access Key
    adapter.setText(
      'export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nexport AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 0);
    assert.equal((await env.clipRepo.findRecent()).length, 0);
    assert.equal(service.getStatus().skippedSensitiveCount, 2);

    // 3. Oversized text: Exceeds 64 KiB
    const oversized = 'A'.repeat(65 * 1024);
    adapter.setText(oversized);
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 0);
    assert.equal((await env.clipRepo.findRecent()).length, 0);
    assert.equal(service.getStatus().skippedOversizedCount, 1);
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 6 — Unsupported content does not bypass existing text-only restrictions', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();

    // Empty string
    adapter.setText('');
    await service.pollNow();
    assert.equal(service.getRecentItems().length, 0);
    assert.equal((await env.clipRepo.findRecent()).length, 0);
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 7 — A persistence error does not crash or stop normal in-memory capture', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    // Wrap persistence service so saveTextClip throws a simulated database error
    const faultyPersistence = {
      isPersistenceEnabled: () => true,
      saveTextClip: async () => {
        throw new Error('Simulated SQLite disk error');
      },
      getRecentClips: async () => env.persistenceService.getRecentClips(),
    };

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: faultyPersistence,
    });

    await service.start();

    // Capture text with failing persistence
    adapter.setText('Resilient capture item 1');
    await service.pollNow();

    // In-memory capture must succeed despite persistence failure
    assert.equal(service.getStatus().isRunning, true);
    assert.equal(service.getRecentItems().length, 1);
    assert.equal(service.getRecentItems()[0].text, 'Resilient capture item 1');

    // Subsequent capture continues normally
    adapter.setText('Resilient capture item 2');
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 2);
    assert.equal(service.getRecentItems()[0].text, 'Resilient capture item 2');
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 8 — Disabling capture stops new capture-driven save requests according to existing stop semantics', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    await service.start();
    adapter.setText('Saved while active');
    await service.pollNow();

    assert.equal((await env.clipRepo.findRecent()).length, 1);

    // Stop capture
    service.stop();
    assert.equal(service.getStatus().isRunning, false);
    assert.equal(service.getRecentItems().length, 0);

    // New clipboard change while stopped
    adapter.setText('Copied while stopped');
    await service.pollNow();

    // Must not save to database or in-memory history
    assert.equal(service.getRecentItems().length, 0);
    assert.equal((await env.clipRepo.findRecent()).length, 1, 'No new saves while stopped');
  } finally {
    service?.stop();
    await env.cleanup();
  }
});

test('Capture-Persistence 9 — A successful disable operation cannot complete while an older save remains capable of committing afterward', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.policy.setPersistenceEnabled(true);

    const saveGate = createDeferred();
    const saveReachedDb = createDeferred();

    // Intercept repository create to pause before committing to the database
    const originalCreate = env.clipRepo.create.bind(env.clipRepo);
    env.clipRepo.create = async (input) => {
      saveReachedDb.resolve();
      await saveGate.promise;
      return originalCreate(input);
    };

    // Start saveTextClip while persistence is enabled
    const savePromise = env.persistenceService.saveTextClip({
      text: 'In-flight text save',
    });

    // Wait until the save operation has reached the database layer
    await saveReachedDb.promise;

    // Concurrently trigger disable of persistence
    let disableCompleted = false;
    const disablePromise = env.policy.setPersistenceEnabled(false).then((res) => {
      disableCompleted = true;
      return res;
    });

    // Allow any immediate microtasks to process
    await new Promise((resolve) => setImmediate(resolve));

    // CRITICAL GUARANTEE: setPersistenceEnabled(false) MUST NOT complete while the older save is still pending
    assert.equal(
      disableCompleted,
      false,
      'Disable operation must not report completion while an in-flight save could still commit afterward',
    );

    // Release the older save
    saveGate.resolve();

    // Both operations should now settle cleanly
    const savedClip = await savePromise;
    assert.ok(savedClip.id);

    const disableResult = await disablePromise;
    assert.equal(disableResult, false);
    assert.equal(disableCompleted, true);

    // Verify database has the completed older save
    const clips = await env.clipRepo.findRecent();
    assert.equal(clips.length, 1);

    // Any subsequent save MUST be rejected under the now-disabled policy
    await assert.rejects(
      async () => {
        await env.persistenceService.saveTextClip({ text: 'Subsequent text save' });
      },
      PersistenceDisabledError,
      'Subsequent save must be rejected after disable completes',
    );

    assert.equal((await env.clipRepo.findRecent()).length, 1);
  } finally {
    await env.cleanup();
  }
});

test('Capture-Persistence 10 — A failed preference mutation activates the existing fail-closed behavior and prevents subsequent saves', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.policy.setPersistenceEnabled(true);

    // Ensure save works while enabled
    await env.persistenceService.saveTextClip({ text: 'Valid clip when enabled' });
    assert.equal((await env.clipRepo.findRecent()).length, 1);

    // Simulate database write failure during disable mutation
    env.settingRepo.set = async () => {
      throw new Error('Simulated SQLite disk write failure');
    };

    // Attempting to disable fails due to the database write error
    await assert.rejects(async () => {
      await env.policy.setPersistenceEnabled(false);
    }, /Simulated SQLite disk write failure/);

    // Permission check must fail closed
    const isAllowed = await env.policy.isPersistenceEnabled();
    assert.equal(
      isAllowed,
      false,
      'Failed preference write must activate fail-closed policy override',
    );

    // Subsequent save must be rejected immediately without writing to database
    await assert.rejects(async () => {
      await env.persistenceService.saveTextClip({
        text: 'Must be blocked by fail-closed override',
      });
    }, PersistenceDisabledError);

    assert.equal(
      (await env.clipRepo.findRecent()).length,
      1,
      'No new records after mutation failure',
    );
  } finally {
    await env.cleanup();
  }
});

test('Capture-Persistence 11 — Concurrent captures and consent changes cannot bypass the policy through stale authorization', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.policy.setPersistenceEnabled(true);

    const mutationGate = createDeferred();
    const originalSet = env.settingRepo.set.bind(env.settingRepo);
    env.settingRepo.set = async (key, val) => {
      await mutationGate.promise;
      return originalSet(key, val);
    };

    // Start disabling persistence (mutation paused in-flight)
    const disablePromise = env.policy.setPersistenceEnabled(false);

    // Concurrently trigger saves while mutation is in flight
    // These must coordinate behind activeMutation, not execute with stale 'true' permission
    const concurrentSave1 = env.persistenceService.saveTextClip({ text: 'Concurrent save 1' });
    const concurrentSave2 = env.persistenceService.saveTextClip({ text: 'Concurrent save 2' });

    // Release the preference mutation to complete the disable
    mutationGate.resolve();
    await disablePromise;

    // Both concurrent saves must have evaluated the new disabled policy and failed closed
    await assert.rejects(async () => concurrentSave1, PersistenceDisabledError);
    await assert.rejects(async () => concurrentSave2, PersistenceDisabledError);

    // Database must remain clean
    assert.equal((await env.clipRepo.findRecent()).length, 0);
  } finally {
    await env.cleanup();
  }
});

test('Capture-Persistence 12 — The existing explicit-start and first-poll baseline semantics remain unchanged', async () => {
  const env = await setupIsolatedEnvironment();
  let service;
  try {
    await env.policy.setPersistenceEnabled(true);

    const adapter = new FakeClipboardAdapter();
    adapter.setText('Pre-existing clipboard content before start');

    service = new ClipboardCaptureService({
      adapter,
      persistenceService: env.persistenceService,
    });

    // Capture service is STOPPED by default
    assert.equal(service.getStatus().isRunning, false);
    assert.equal((await env.clipRepo.findRecent()).length, 0);

    // Start establishes baseline
    await service.start();
    assert.equal(service.getStatus().isRunning, true);
    assert.equal(
      service.getRecentItems().length,
      0,
      'Baseline content is not emitted to in-memory history',
    );
    assert.equal(
      (await env.clipRepo.findRecent()).length,
      0,
      'Baseline content is not persisted to database',
    );

    // First actual change after start
    adapter.setText('First post-start clipboard capture');
    await service.pollNow();

    assert.equal(service.getRecentItems().length, 1);
    assert.equal(service.getRecentItems()[0].text, 'First post-start clipboard capture');

    const dbClips = await env.clipRepo.findRecent();
    assert.equal(dbClips.length, 1);

    const retrieved = await env.persistenceService.getRecentClips();
    assert.equal(retrieved.clips.length, 1);
    assert.equal(retrieved.clips[0].text, 'First post-start clipboard capture');
  } finally {
    service?.stop();
    await env.cleanup();
  }
});
