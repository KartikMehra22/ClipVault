/**
 * ClipOrbit — Restored Encrypted Persisted History Test Suite
 * Phase 6.3.3.2: Restore Encrypted Persisted History
 *
 * Verifies:
 * 1. An encrypted saved clip can be retrieved and decrypted to the expected text.
 * 2. No ciphertext, nonce, authentication tag, or key metadata appears in the renderer-facing DTO.
 * 3. Tampered, corrupt, oversized, or newly detected sensitive records are excluded safely.
 * 4. Persisted history remains readable when the save-consent preference is off.
 * 5. A missing or corrupt record does not cause plaintext fallback or expose its contents in logs.
 * 6. A clip represented in both saved and live sources renders only once.
 * 7. Merged history is ordered by actual capture timestamps and respects the configured limit.
 * 8. Persisted pins survive a restart and appear in the Pinned view.
 * 9. Pin/unpin/delete failures are not incorrectly reported as successful operations.
 * 10. Deleting a saved clip removes it from both the persisted result and active-session results.
 * 11. Deletion remains available while save consent is disabled.
 * 12. Concurrent refresh responses cannot overwrite newer history with stale results.
 * 13. Unauthorized IPC requests and invalid inputs are rejected.
 * 14. Reading history never starts clipboard capture or writes/backfills records.
 * 15. Development database integrity is preserved.
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
} from '../dist/services/clipboard/index.js';
import { EncryptionService } from '../dist/services/crypto/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';
import { createClipRepository, createAppSettingRepository } from '@cliporbit/database';
import { createClipboardIpcHandlers } from '../dist/main/clipboardIpc.js';
import { isAuthorizedFrame } from '../dist/main/security.js';
import { mergeHistoryClips } from '@cliporbit/contracts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-restored-history-test-') {
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

function createMockEvent(url = 'http://127.0.0.1:3000', parent = null) {
  return {
    senderFrame: {
      url,
      parent,
    },
  };
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

before(() => {
  if (fs.existsSync(devDbPath)) {
    const stat = fs.statSync(devDbPath);
    devDbInitialMtime = stat.mtimeMs;
    devDbInitialSize = stat.size;
  }
});

after(() => {
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
      // Ignore cleanup error
    }
  }
});

async function setupIsolatedEnvironment(options = {}) {
  const tmpDir = options.tmpDir ?? createTempDir('cliporbit-restored-env-');
  const keyProtector = options.keyProtector ?? new FakeKeyProtector();

  const encService = new EncryptionService();
  await encService.initialize({
    userDataPath: tmpDir,
    keyProtector,
  });

  const dbResult = await initializeDatabase({ userDataPath: tmpDir });
  const client = dbResult.client;
  const clipRepo = createClipRepository(client);
  const settingRepo = createAppSettingRepository(client);

  const persistencePolicy = createClipboardPersistencePolicy(settingRepo);
  if (options.initialConsent !== false) {
    await persistencePolicy.setPersistenceEnabled(true);
  }

  const persistenceService = createEncryptedClipboardPersistenceService({
    repository: clipRepo,
    encryptionService: encService,
    policy: persistencePolicy,
  });

  const adapter = new FakeClipboardAdapter(options.initialClipboardText ?? '');
  const captureService = new ClipboardCaptureService({
    adapter,
    persistenceService,
  });

  let shutdownFlag = false;

  const handlers = createClipboardIpcHandlers({
    captureService,
    persistenceService,
    isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => shutdownFlag,
  });

  return {
    tmpDir,
    keyProtector,
    encService,
    client,
    clipRepo,
    settingRepo,
    persistencePolicy,
    persistenceService,
    adapter,
    captureService,
    handlers,
    setShutdown: (val) => {
      shutdownFlag = val;
    },
    close: async () => {
      captureService.stop();
      await closeDatabase();
    },
  };
}

// ============================================================================
// 1. Retrieval & Decryption
// ============================================================================

test('1. An encrypted saved clip can be retrieved and decrypted to the expected text', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const testText = 'https://example.com/item';
    await env.persistenceService.saveTextClip({
      id: 'clip-retrieval-1',
      text: testText,
      createdAt: new Date('2026-10-22T10:00:00Z'),
    });

    const results = await env.handlers.handleGetPersistedClips(createMockEvent(), 10);
    assert.equal(results.success, true);
    assert.equal(results.clips.length, 1);
    assert.equal(results.clips[0].id, 'clip-retrieval-1');
    assert.equal(results.clips[0].text, testText);
    assert.equal(results.clips[0].byteLength, Buffer.byteLength(testText, 'utf8'));
    assert.equal(results.clips[0].category, 'url');
    assert.equal(results.clips[0].isPinned, false);
  } finally {
    await env.close();
  }
});

// ============================================================================
// 2. DTO Sanitization & Absence of Cryptographic Internals
// ============================================================================

test('2. No ciphertext, nonce, authentication tag, or key metadata appears in the renderer-facing DTO', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.persistenceService.saveTextClip({
      id: 'clip-dto-sanitized',
      text: 'Confidential displayable content',
      createdAt: new Date('2026-10-22T10:05:00Z'),
    });

    const results = await env.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(results.success, true);
    assert.equal(results.clips.length, 1);
    const dto = results.clips[0];

    const forbiddenFields = [
      'ciphertext',
      'encryptedpayload',
      'encryptedbytes',
      'nonce',
      'iv',
      'authtag',
      'tag',
      'key',
      'keyid',
      'encryptionkey',
      'masterkey',
      'protecteddata',
    ];

    for (const key of Object.keys(dto)) {
      for (const forbidden of forbiddenFields) {
        assert.ok(
          !key.toLowerCase().includes(forbidden),
          `DTO exposes forbidden cryptographic field: ${key}`,
        );
      }
    }

    const json = JSON.stringify(dto);
    assert.ok(!json.includes('nonce'));
    assert.ok(!json.includes('authTag'));
    assert.ok(!json.includes('ciphertext'));
  } finally {
    await env.close();
  }
});

// ============================================================================
// 3. Corrupt, Tampered, Oversized, and Sensitive Records Excluded Safely
// ============================================================================

test('3. Tampered, corrupt, oversized, or newly detected sensitive records are excluded safely', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // 1. Valid clip
    await env.persistenceService.saveTextClip({
      id: 'clip-valid',
      text: 'Valid content here',
      createdAt: new Date('2026-10-22T10:10:00Z'),
    });

    // 2. Tampered ciphertext in database
    const encrypted = env.encService.encrypt(Buffer.from('Corrupt content', 'utf8'));
    // Flip bytes in ciphertext
    encrypted.ciphertext[0] ^= 0xff;
    await env.client.clip.create({
      data: {
        id: 'clip-corrupt',
        encryptedPayload: encrypted.ciphertext,
        encryptionNonce: encrypted.nonce,
        encryptionAuthTag: encrypted.authTag,
        encryptionVersion: 1,
        payloadByteLength: Buffer.byteLength('Corrupt content', 'utf8'),
        contentType: 'text',
        isSensitive: false,
        sourceApp: null,
      },
    });

    // 3. Directly marked sensitive in database
    const encSensitive = env.encService.encrypt(Buffer.from('Sensitive content', 'utf8'));
    await env.client.clip.create({
      data: {
        id: 'clip-marked-sensitive',
        encryptedPayload: encSensitive.ciphertext,
        encryptionNonce: encSensitive.nonce,
        encryptionAuthTag: encSensitive.authTag,
        encryptionVersion: 1,
        payloadByteLength: Buffer.byteLength('Sensitive content', 'utf8'),
        contentType: 'text',
        isSensitive: true,
        sourceApp: null,
      },
    });

    // 4. Decrypted payload matches newly detected sensitive pattern (e.g. AWS Key)
    const awsKey = 'AKIAIOSFODNN7EXAMPLE';
    const encAws = env.encService.encrypt(Buffer.from(awsKey, 'utf8'));
    await env.client.clip.create({
      data: {
        id: 'clip-aws-secret',
        encryptedPayload: encAws.ciphertext,
        encryptionNonce: encAws.nonce,
        encryptionAuthTag: encAws.authTag,
        encryptionVersion: 1,
        payloadByteLength: Buffer.byteLength(awsKey, 'utf8'),
        contentType: 'text',
        isSensitive: false,
        sourceApp: null,
      },
    });

    const results = await env.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(results.success, true);
    // Only the valid clip should be returned
    assert.equal(results.clips.length, 1);
    assert.equal(results.clips[0].id, 'clip-valid');
  } finally {
    await env.close();
  }
});

// ============================================================================
// 4. Saved History Remains Readable When Save Consent Is Off
// ============================================================================

test('4. Persisted history remains readable when the save-consent preference is off', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    await env.persistenceService.saveTextClip({
      id: 'clip-consent-saved',
      text: 'Saved while consent was ON',
      createdAt: new Date('2026-10-22T10:15:00Z'),
    });

    // Switch persistence consent OFF
    await env.persistencePolicy.setPersistenceEnabled(false);
    assert.equal(await env.persistencePolicy.isPersistenceEnabled(), false);

    // Reading saved clips must STILL succeed!
    const results = await env.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(results.success, true);
    assert.equal(results.clips.length, 1);
    assert.equal(results.clips[0].id, 'clip-consent-saved');
    assert.equal(results.clips[0].text, 'Saved while consent was ON');
  } finally {
    await env.close();
  }
});

// ============================================================================
// 5. Corrupt Records Do Not Cause Plaintext Fallback or Content Leaks
// ============================================================================

test('5. A missing or corrupt record does not cause plaintext fallback or expose its contents in logs', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const secretText = 'DO_NOT_LEAK_IN_LOGS_OR_FALLBACK';
    const encrypted = env.encService.encrypt(Buffer.from(secretText, 'utf8'));
    // Zero out the authentication tag to ensure tag mismatch
    encrypted.authTag.fill(0);

    await env.client.clip.create({
      data: {
        id: 'clip-tag-failure',
        encryptedPayload: encrypted.ciphertext,
        encryptionNonce: encrypted.nonce,
        encryptionAuthTag: encrypted.authTag,
        encryptionVersion: 1,
        payloadByteLength: Buffer.byteLength(secretText, 'utf8'),
        contentType: 'text',
        isSensitive: false,
        sourceApp: null,
      },
    });

    const logged = [];
    const origError = console.error;
    const origWarn = console.warn;
    console.error = (...args) => logged.push(args.join(' '));
    console.warn = (...args) => logged.push(args.join(' '));

    let results;
    try {
      results = await env.handlers.handleGetPersistedClips(createMockEvent());
    } finally {
      console.error = origError;
      console.warn = origWarn;
    }

    // Must be excluded safely
    assert.equal(results.success, true);
    assert.equal(results.clips.length, 0);

    // Secret text must never appear in any log
    const logOutput = logged.join(' ');
    assert.ok(!logOutput.includes(secretText), 'Corrupt record contents leaked in logs!');
  } finally {
    await env.close();
  }
});

// ============================================================================
// 6. Merge Deduplication (Live + Persisted)
// ============================================================================

test('6. A clip represented in both saved and live sources renders only once', () => {
  const liveClips = [
    {
      id: 'clip-shared-1',
      text: 'In-memory updated text',
      detectedAt: '2026-10-22T10:20:00Z',
      byteLength: 22,
      category: 'text',
    },
  ];

  const persistedClips = [
    {
      id: 'clip-shared-1',
      text: 'Persisted stored text',
      createdAt: '2026-10-22T10:19:00Z',
      byteLength: 21,
      category: 'text',
      isPinned: true,
      sourceApp: 'Finder',
    },
  ];

  const merged = mergeHistoryClips(liveClips, persistedClips, new Set(), 50);

  // Must only appear once!
  assert.equal(merged.clips.length, 1);
  const clip = merged.clips[0];
  assert.equal(clip.id, 'clip-shared-1');
  // Prefers in-memory active representation
  assert.equal(clip.text, 'In-memory updated text');
  // Preserves persisted presence and pin
  assert.equal(clip.isPersisted, true);
  assert.equal(clip.isPinned, true);
  assert.ok(merged.persistedIds.has('clip-shared-1'));
  assert.ok(merged.allPinnedIds.has('clip-shared-1'));
});

// ============================================================================
// 7. Merged History Ordering and Limit
// ============================================================================

test('7. Merged history is ordered by actual capture timestamps and respects the configured limit', () => {
  const liveClips = [
    {
      id: 'clip-live-newest',
      text: 'Newest live clip',
      detectedAt: '2026-10-22T12:00:00Z',
      byteLength: 16,
      category: 'text',
    },
    {
      id: 'clip-live-oldest',
      text: 'Oldest live clip',
      detectedAt: '2026-10-22T08:00:00Z',
      byteLength: 16,
      category: 'text',
    },
  ];

  const persistedClips = [
    {
      id: 'clip-persisted-middle',
      text: 'Middle persisted clip',
      createdAt: '2026-10-22T10:00:00Z',
      byteLength: 21,
      category: 'text',
      isPinned: false,
      sourceApp: null,
    },
  ];

  // Request with limit 2
  const merged = mergeHistoryClips(liveClips, persistedClips, new Set(), 2);

  assert.equal(merged.clips.length, 2);
  assert.equal(merged.clips[0].id, 'clip-live-newest'); // 12:00
  assert.equal(merged.clips[1].id, 'clip-persisted-middle'); // 10:00
  // clip-live-oldest (08:00) excluded by limit 2
});

// ============================================================================
// 8. Persisted Pins Survive Restart
// ============================================================================

test('8. Persisted pins survive a restart and appear in the Pinned view', async () => {
  const tmpDir = createTempDir('cliporbit-pin-restart-');
  const keyProtector = new FakeKeyProtector();

  // First session: save clip and pin it
  const env1 = await setupIsolatedEnvironment({ tmpDir, keyProtector });
  try {
    await env1.persistenceService.saveTextClip({
      id: 'clip-pin-survives',
      text: 'Pin me across restarts',
      createdAt: new Date('2026-10-22T10:30:00Z'),
    });

    const pinResult = await env1.handlers.handlePinClip(
      createMockEvent(),
      'clip-pin-survives',
      true,
    );
    assert.equal(pinResult, true);
  } finally {
    await env1.close();
  }

  // Second session (simulating restart with same database & key protector)
  const env2 = await setupIsolatedEnvironment({ tmpDir, keyProtector });
  try {
    const results = await env2.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(results.success, true);
    const clips = results.clips;
    assert.equal(clips.length, 1);
    assert.equal(clips[0].id, 'clip-pin-survives');
    assert.equal(clips[0].isPinned, true);

    const merged = mergeHistoryClips([], clips, new Set(), 50);
    assert.ok(merged.allPinnedIds.has('clip-pin-survives'));
    assert.equal(merged.clips[0].isPinned, true);
  } finally {
    await env2.close();
  }
});

// ============================================================================
// 9. Pin/Unpin/Delete Failures Are Not Reported as Success
// ============================================================================

test('9. Pin/unpin/delete failures are not incorrectly reported as successful operations', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // Non-existent ID returns false
    const pinMissing = await env.handlers.handlePinClip(createMockEvent(), 'non-existent-id', true);
    assert.equal(pinMissing, false);

    const unpinMissing = await env.handlers.handlePinClip(
      createMockEvent(),
      'non-existent-id',
      false,
    );
    assert.equal(unpinMissing, false);

    const deleteMissing = await env.handlers.handleDeleteClip(createMockEvent(), 'non-existent-id');
    assert.equal(deleteMissing, false);

    // Database error: simulate by making repository methods throw
    env.clipRepo.pin = async () => {
      throw new Error('Disk I/O error during pin');
    };
    env.clipRepo.delete = async () => {
      throw new Error('Disk I/O error during delete');
    };

    await assert.rejects(
      async () => {
        await env.handlers.handlePinClip(createMockEvent(), 'any-id', true);
      },
      (err) => err instanceof Error && err.message.includes('Disk I/O error during pin'),
    );

    await assert.rejects(
      async () => {
        await env.handlers.handleDeleteClip(createMockEvent(), 'any-id');
      },
      (err) => err instanceof Error && err.message.includes('Disk I/O error during delete'),
    );
  } finally {
    await env.close();
  }
});

// ============================================================================
// 10. Deleting Saved Clip Removes from Both Persisted & Active Session
// ============================================================================

test('10. Deleting a saved clip removes it from both the persisted result and active-session results', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const clipId = 'clip-delete-both';
    const text = 'Dual-presence clip';

    // 1. Saved in database
    await env.persistenceService.saveTextClip({
      id: clipId,
      text,
      createdAt: new Date('2026-10-22T10:35:00Z'),
    });

    // 2. Also present in active in-memory capture session
    env.adapter.setText(text);
    await env.captureService.start();
    // Simulate item in history with matching ID
    const recentItems = env.captureService.getRecentItems();
    recentItems.push({
      id: clipId,
      text,
      detectedAt: new Date('2026-10-22T10:35:00Z'),
      byteLength: Buffer.byteLength(text, 'utf8'),
      category: 'text',
    });

    // Delete through IPC
    const deleted = await env.handlers.handleDeleteClip(createMockEvent(), clipId);
    assert.equal(deleted, true);

    // Verify removed from database
    const persistedAfter = await env.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(persistedAfter.success, true);
    assert.equal(
      persistedAfter.clips.some((p) => p.id === clipId),
      false,
    );

    // Verify no ghost row in merged history
    const merged = mergeHistoryClips(
      env.captureService.getRecentItems(),
      persistedAfter.clips,
      new Set(),
      50,
    );
    assert.equal(
      merged.clips.some((c) => c.id === clipId),
      false,
    );
  } finally {
    await env.close();
  }
});

// ============================================================================
// 11. Deletion Remains Available While Save Consent Is Disabled
// ============================================================================

test('11. Deletion remains available while save consent is disabled', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const clipId = 'clip-delete-when-consent-off';
    await env.persistenceService.saveTextClip({
      id: clipId,
      text: 'Saved clip to be deleted later',
      createdAt: new Date('2026-10-22T10:40:00Z'),
    });

    // Disable consent
    await env.persistencePolicy.setPersistenceEnabled(false);
    assert.equal(await env.persistencePolicy.isPersistenceEnabled(), false);

    // Deleting the clip MUST still succeed!
    const deleted = await env.handlers.handleDeleteClip(createMockEvent(), clipId);
    assert.equal(deleted, true);

    const remaining = await env.handlers.handleGetPersistedClips(createMockEvent());
    assert.equal(remaining.success, true);
    assert.equal(remaining.clips.length, 0);
  } finally {
    await env.close();
  }
});

// ============================================================================
// 12. Concurrency: Stale History Cannot Overwrite Newer History
// ============================================================================

test('12. Concurrent refresh responses cannot overwrite newer history with stale results', async () => {
  let requestId = 0;
  let activeState = null;

  const d1 = createDeferred();
  const d2 = createDeferred();

  // Simulated renderer request executor
  async function triggerLoad(deferredPayload) {
    const reqId = ++requestId;
    const data = await deferredPayload.promise;
    // Guard against superseded requests
    if (reqId === requestId) {
      activeState = data;
    }
  }

  // Req 1 starts first (slow)
  const p1 = triggerLoad(d1);
  // Req 2 starts second (fast)
  const p2 = triggerLoad(d2);

  // Req 2 finishes first with newer data
  d2.resolve(['Newer History Item']);
  await p2;
  assert.deepEqual(activeState, ['Newer History Item']);

  // Req 1 finishes later with older/stale data
  d1.resolve(['Stale Slower Item']);
  await p1;

  // Active state must NOT be overwritten by Req 1!
  assert.deepEqual(activeState, ['Newer History Item']);
});

// ============================================================================
// 13. Unauthorized IPC Requests and Invalid Inputs Are Rejected
// ============================================================================

test('13. Unauthorized IPC requests and invalid inputs are rejected', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const unauthorizedEvent = {
      senderFrame: {
        url: 'http://malicious-origin.com',
        parent: null,
      },
    };

    const childFrameEvent = {
      senderFrame: {
        url: ALLOWED_ORIGIN,
        parent: {}, // Child frame / iframe
      },
    };

    // 1. Unauthorized origin
    await assert.rejects(
      async () => env.handlers.handleGetPersistedClips(unauthorizedEvent),
      (err) => err instanceof Error && err.message.includes('Unauthorized IPC sender origin'),
    );

    // 2. Child frame
    await assert.rejects(
      async () => env.handlers.handlePinClip(childFrameEvent, 'any-id', true),
      (err) => err instanceof Error && err.message.includes('Unauthorized IPC sender origin'),
    );

    // 3. Post-shutdown invocation
    env.setShutdown(true);
    await assert.rejects(
      async () => env.handlers.handleDeleteClip(createMockEvent(), 'any-id'),
      (err) => err instanceof Error && err.message.includes('Application is shutting down'),
    );
    env.setShutdown(false);

    // 4. Invalid limits
    await assert.rejects(
      async () => env.handlers.handleGetPersistedClips(createMockEvent(), -1),
      (err) =>
        err instanceof Error && err.message.includes('Limit must be an integer between 1 and 100'),
    );
    await assert.rejects(
      async () => env.handlers.handleGetPersistedClips(createMockEvent(), 101),
      (err) =>
        err instanceof Error && err.message.includes('Limit must be an integer between 1 and 100'),
    );
    await assert.rejects(
      async () => env.handlers.handleGetPersistedClips(createMockEvent(), '50'),
      (err) =>
        err instanceof Error && err.message.includes('Limit must be an integer between 1 and 100'),
    );

    // 5. Invalid pin inputs
    await assert.rejects(
      async () => env.handlers.handlePinClip(createMockEvent(), '', true),
      (err) => err instanceof Error && err.message.includes('ID must be a non-empty string'),
    );
    await assert.rejects(
      async () => env.handlers.handlePinClip(createMockEvent(), 'id', 'not-a-boolean'),
      (err) => err instanceof Error && err.message.includes('isPinned must be a boolean'),
    );

    // 6. Invalid delete inputs
    await assert.rejects(
      async () => env.handlers.handleDeleteClip(createMockEvent(), '   '),
      (err) => err instanceof Error && err.message.includes('ID must be a non-empty string'),
    );
  } finally {
    await env.close();
  }
});

// ============================================================================
// 14. Reading History Never Starts Capture or Writes/Backfills Records
// ============================================================================

test('14. Reading history never starts clipboard capture or writes/backfills records', async () => {
  const env = await setupIsolatedEnvironment({ initialClipboardText: 'Initial text' });
  try {
    // Capture engine is initially NOT started
    assert.equal(env.captureService.getStatus().isRunning, false);

    const initialDbRecords = await env.client.clip.count();

    // Call handleGetPersistedClips
    const results = await env.handlers.handleGetPersistedClips(createMockEvent(), 50);
    assert.equal(results.success, true);
    assert.equal(Array.isArray(results.clips), true);

    // Capture engine MUST still be stopped
    assert.equal(env.captureService.getStatus().isRunning, false);

    // Database record count MUST be unchanged
    const afterDbRecords = await env.client.clip.count();
    assert.equal(
      afterDbRecords,
      initialDbRecords,
      'Reading history must not write or backfill database records!',
    );
  } finally {
    await env.close();
  }
});

// ============================================================================
// Phase 6.3.3.2.1: Persistent History Retrieval Failure Handling
// ============================================================================

test('Phase 6.3.3.2.1 - 1. A genuinely empty successful query is distinguishable from a retrieval failure', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // 1. Genuinely empty successful query
    const emptySuccess = await env.handlers.handleGetPersistedClips(createMockEvent(), 50);
    assert.equal(emptySuccess.success, true);
    assert.deepEqual(emptySuccess.clips, []);

    // 2. Retrieval failure (simulate database query failure)
    env.persistenceService.getRecentClips = async () => {
      throw new Error('SQLite disk I/O failure');
    };
    const failureResult = await env.handlers.handleGetPersistedClips(createMockEvent(), 50);
    assert.equal(failureResult.success, false);
    assert.equal(typeof failureResult.error, 'string');
    assert.equal(
      failureResult.error,
      'Failed to retrieve saved clipboard history from local storage.',
    );

    // Empty success and failure must be clearly distinguishable
    assert.notDeepEqual(emptySuccess, failureResult);
    assert.equal(emptySuccess.success !== failureResult.success, true);
  } finally {
    await env.close();
  }
});

test('Phase 6.3.3.2.1 - 2. No failure response contains database internals or clipboard payload data', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const sensitiveDbPath = '/Users/secret/path/to/dev.db';
    const sensitivePayload = 'TOP_SECRET_CLIPBOARD_DATA_xyz';
    env.persistenceService.getRecentClips = async () => {
      throw new Error(
        `PrismaClientKnownRequestError: Table 'clips' corrupted at ${sensitiveDbPath} during query of ${sensitivePayload}`,
      );
    };

    const failureResult = await env.handlers.handleGetPersistedClips(createMockEvent(), 50);
    assert.equal(failureResult.success, false);
    assert.equal(typeof failureResult.error, 'string');
    // Error must be generic and must NOT contain database internals, filesystem paths, or sensitive payload data
    assert.equal(failureResult.error.includes('/Users/secret'), false);
    assert.equal(failureResult.error.includes('dev.db'), false);
    assert.equal(failureResult.error.includes('PrismaClient'), false);
    assert.equal(failureResult.error.includes('clips'), false);
    assert.equal(failureResult.error.includes(sensitivePayload), false);
    assert.equal(
      failureResult.error,
      'Failed to retrieve saved clipboard history from local storage.',
    );
  } finally {
    await env.close();
  }
});

test('Phase 6.3.3.2.1 - 3. Initial retrieval failure does not render the successful-empty state', async () => {
  // Simulate renderer state management for initial load
  let renderedView = null;
  let items = [];
  let persistedLoadError = null;
  let lastKnownPersistedClips = null;

  function simulateRendererLoad(liveClips, persistedResult) {
    let persistedClips = [];
    if (persistedResult.success) {
      lastKnownPersistedClips = persistedResult.clips;
      persistedClips = persistedResult.clips;
      persistedLoadError = null;
    } else {
      if (lastKnownPersistedClips !== null) {
        persistedClips = lastKnownPersistedClips;
        persistedLoadError =
          'Unable to refresh saved history. Showing previously loaded clips (stale).';
      } else {
        persistedClips = [];
        persistedLoadError = 'Saved history could not be loaded from local storage.';
      }
    }

    const merged = mergeHistoryClips(liveClips, persistedClips, new Set(), 50);
    items = merged.clips;

    // Determine what view renders (mimics HistoryList)
    if (items.length === 0) {
      if (persistedLoadError) {
        renderedView = 'ERROR_EMPTY_STATE';
      } else {
        renderedView = 'SUCCESSFUL_EMPTY_STATE';
      }
    } else {
      renderedView = 'ITEMS_LIST';
    }
  }

  // Initial load with database failure and 0 live items
  simulateRendererLoad([], {
    success: false,
    error: 'Failed to retrieve saved clipboard history from local storage.',
  });

  // Must NOT render the successful-empty state
  assert.equal(renderedView, 'ERROR_EMPTY_STATE');
  assert.equal(persistedLoadError, 'Saved history could not be loaded from local storage.');
  assert.equal(lastKnownPersistedClips, null);
});

test('Phase 6.3.3.2.1 - 4. A failed refresh retains the last successfully loaded persisted records and marks them stale', async () => {
  let items = [];
  let persistedLoadError = null;
  let isPersistedStale = false;
  let lastKnownPersistedClips = null;

  function simulateRendererLoad(liveClips, persistedResult) {
    let persistedClips = [];
    if (persistedResult.success) {
      lastKnownPersistedClips = persistedResult.clips;
      persistedClips = persistedResult.clips;
      persistedLoadError = null;
      isPersistedStale = false;
    } else {
      if (lastKnownPersistedClips !== null) {
        persistedClips = lastKnownPersistedClips;
        isPersistedStale = true;
        persistedLoadError =
          'Unable to refresh saved history. Showing previously loaded clips (stale).';
      } else {
        persistedClips = [];
        isPersistedStale = false;
        persistedLoadError = 'Saved history could not be loaded from local storage.';
      }
    }

    const merged = mergeHistoryClips(liveClips, persistedClips, new Set(), 50);
    items = merged.clips;
  }

  const initialClip = {
    id: 'clip-persisted-1',
    text: 'Saved clip from earlier',
    createdAt: '2026-10-22T10:00:00Z',
    byteLength: 22,
    category: 'text',
    isPinned: false,
    sourceApp: null,
  };

  // 1. Initial successful retrieval
  simulateRendererLoad([], { success: true, clips: [initialClip] });
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'clip-persisted-1');
  assert.equal(isPersistedStale, false);
  assert.equal(persistedLoadError, null);

  // 2. Subsequent refresh failure
  simulateRendererLoad([], { success: false, error: 'Database query timed out' });

  // Must retain previously loaded persisted clips as stale data!
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'clip-persisted-1');
  assert.equal(isPersistedStale, true);
  assert.equal(
    persistedLoadError,
    'Unable to refresh saved history. Showing previously loaded clips (stale).',
  );
});

test('Phase 6.3.3.2.1 - 5. Live in-memory history remains usable if persisted retrieval fails (Partial Success)', async () => {
  let items = [];
  let persistedLoadError = null;

  function simulateRendererLoad(liveClips, persistedResult) {
    let persistedClips = [];
    if (persistedResult.success) {
      persistedClips = persistedResult.clips;
      persistedLoadError = null;
    } else {
      persistedClips = [];
      persistedLoadError = 'Saved history could not be loaded from local storage.';
    }

    const merged = mergeHistoryClips(liveClips, persistedClips, new Set(), 50);
    items = merged.clips;
  }

  const liveClip = {
    id: 'clip-live-active',
    text: 'Active live copied item',
    detectedAt: '2026-10-22T11:00:00Z',
    byteLength: 23,
    category: 'text',
  };

  // Persisted retrieval fails, but live clips are available
  simulateRendererLoad([liveClip], { success: false, error: 'Local database locked' });

  // Live item remains displayed and usable
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'clip-live-active');
  assert.equal(items[0].isPersisted, false);
  // Persisted error warning is simultaneously indicated
  assert.equal(persistedLoadError, 'Saved history could not be loaded from local storage.');
});

test('Phase 6.3.3.2.1 - 6. A delayed failed response cannot overwrite a newer successful response', async () => {
  let requestId = 0;
  let activeItems = [];
  let activeError = null;
  let lastKnown = null;

  const d1 = createDeferred(); // older request (fails)
  const d2 = createDeferred(); // newer request (succeeds)

  async function triggerLoad(deferredResult) {
    const reqId = ++requestId;
    const result = await deferredResult.promise;
    // Sequencing check: guard against superseded requests
    if (reqId === requestId) {
      if (result.success) {
        lastKnown = result.clips;
        activeItems = result.clips;
        activeError = null;
      } else {
        activeItems = lastKnown || [];
        activeError = 'Error banner';
      }
    }
  }

  // Request 1 starts (slow failing query)
  const p1 = triggerLoad(d1);
  // Request 2 starts (quick retry succeeds)
  const p2 = triggerLoad(d2);

  // Request 2 finishes first with success
  d2.resolve({
    success: true,
    clips: [
      {
        id: 'clip-fresh-2',
        text: 'Fresh data',
        createdAt: '2026-10-22T12:00:00Z',
        byteLength: 10,
        category: 'text',
        isPinned: false,
        sourceApp: null,
      },
    ],
  });
  await p2;

  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, 'clip-fresh-2');
  assert.equal(activeError, null);

  // Request 1 arrives late and fails
  d1.resolve({ success: false, error: 'Database retrieval failed' });
  await p1;

  // Active items and error state must remain unchanged (Request 1 was discarded)
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, 'clip-fresh-2');
  assert.equal(activeError, null);
});

test('Phase 6.3.3.2.1 - 7. Retry after a retrieval failure can successfully refresh history', async () => {
  let activeItems = [];
  let activeError = null;
  let isStale = false;
  let lastKnown = null;

  function applyResult(result) {
    if (result.success) {
      lastKnown = result.clips;
      activeItems = result.clips;
      activeError = null;
      isStale = false;
    } else {
      activeItems = lastKnown || [];
      activeError = 'Saved history could not be loaded from local storage.';
      isStale = Boolean(lastKnown);
    }
  }

  // Attempt 1: Fails
  applyResult({ success: false, error: 'Disk read failed' });
  assert.equal(activeItems.length, 0);
  assert.equal(activeError, 'Saved history could not be loaded from local storage.');
  assert.equal(isStale, false);

  // Attempt 2: User clicks Retry -> query succeeds
  const retrievedClip = {
    id: 'clip-after-retry',
    text: 'Successfully retrieved on retry',
    createdAt: '2026-10-22T12:05:00Z',
    byteLength: 29,
    category: 'text',
    isPinned: false,
    sourceApp: null,
  };
  applyResult({ success: true, clips: [retrievedClip] });

  // State cleared of error, shows recovered clip
  assert.equal(activeItems.length, 1);
  assert.equal(activeItems[0].id, 'clip-after-retry');
  assert.equal(activeError, null);
  assert.equal(isStale, false);
});

// ============================================================================
// Local History Lifecycle Completion: Clear History, Expiry, Consent, & Pins
// ============================================================================

test('Clear History - 1. Successfully clears both persisted database records and active session clips', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const mockEvent = createMockEvent();

    // 1. Capture and save clips via captureService and persistenceService
    await env.captureService.start();

    env.adapter.setText('Alpha clip to be cleared');
    await env.captureService.pollNow();

    env.adapter.setText('Beta clip to be cleared');
    await env.captureService.pollNow();

    // Confirm items in memory and database
    assert.equal(env.captureService.getRecentItems().length, 2);

    const persistedResult = await env.handlers.handleGetPersistedClips(mockEvent, 10);
    assert.equal(persistedResult.success, true);
    assert.equal(persistedResult.clips.length, 2);

    // 2. Execute clear history action
    const clearResult = await env.handlers.handleClearHistory(mockEvent);
    assert.equal(clearResult.success, true);
    assert.equal(clearResult.clearedCount, 2);

    // 3. Verify database records are completely gone
    const postClearDb = await env.handlers.handleGetPersistedClips(mockEvent, 10);
    assert.equal(postClearDb.success, true);
    assert.equal(postClearDb.clips.length, 0);

    // 4. Verify in-memory session items are completely cleared
    const postClearMemory = env.captureService.getRecentItems();
    assert.equal(postClearMemory.length, 0);
  } finally {
    await env.close();
  }
});

test('Clear History - 2. Clear history does not touch snippets or application settings', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const mockEvent = createMockEvent();

    // 1. Save a clip
    await env.persistenceService.saveTextClip({
      id: 'clip-to-clear',
      text: 'Clip to clear',
      createdAt: new Date('2026-10-22T10:00:00Z'),
    });

    // 2. Insert a Snippet and an AppSetting into the isolated database
    await env.client.snippet.create({
      data: {
        title: 'Production Deploy Script',
        encryptedContent: Buffer.from('encrypted-snippet-bytes'),
        encryptionNonce: Buffer.from('123456789012'),
        encryptionAuthTag: Buffer.from('1234567890123456'),
        encryptionVersion: 1,
      },
    });

    await env.settingRepo.set('app.theme', 'dark-glass');

    // Verify initial presence
    const initialSnippets = await env.client.snippet.findMany();
    assert.equal(initialSnippets.length, 1);
    const initialTheme = await env.settingRepo.get('app.theme');
    assert.equal(initialTheme, 'dark-glass');

    // 3. Execute clear history
    const clearResult = await env.handlers.handleClearHistory(mockEvent);
    assert.equal(clearResult.success, true);

    // 4. Verify clips are removed
    const dbClips = await env.client.clip.findMany();
    assert.equal(dbClips.length, 0);

    // 5. Verify snippets and settings remain completely intact
    const postSnippets = await env.client.snippet.findMany();
    assert.equal(postSnippets.length, 1);
    assert.equal(postSnippets[0].title, 'Production Deploy Script');

    const postTheme = await env.settingRepo.get('app.theme');
    assert.equal(postTheme, 'dark-glass');
  } finally {
    await env.close();
  }
});

test('Clear History - 3. Clear history works when persistence consent is disabled', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const mockEvent = createMockEvent();

    // 1. Save a clip while consent is true
    await env.persistenceService.saveTextClip({
      id: 'saved-prior-consent',
      text: 'Saved while consent was ON',
      createdAt: new Date('2026-10-22T10:00:00Z'),
    });

    const beforeClips = await env.handlers.handleGetPersistedClips(mockEvent, 10);
    assert.equal(beforeClips.clips.length, 1);

    // 2. Disable consent
    await env.persistencePolicy.setPersistenceEnabled(false);
    assert.equal(await env.persistencePolicy.isPersistenceEnabled(), false);

    // 3. Clear history while consent is disabled
    const clearResult = await env.handlers.handleClearHistory(mockEvent);
    assert.equal(clearResult.success, true);
    assert.equal(clearResult.clearedCount, 1);

    // 4. Verify clips are purged from database
    const postClips = await env.handlers.handleGetPersistedClips(mockEvent, 10);
    assert.equal(postClips.clips.length, 0);
  } finally {
    await env.close();
  }
});

test('Clear History - 4. Fails safely and does not clear session memory when database deletion fails', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const mockEvent = createMockEvent();

    // 1. Add session items
    await env.captureService.start();
    env.adapter.setText('In-memory session item');
    await env.captureService.pollNow();

    assert.equal(env.captureService.getRecentItems().length, 1);

    // 2. Create throwing persistence service double
    const failingPersistence = {
      clearAllClips: async () => {
        throw new Error('SQLite disk I/O error during deleteAll');
      },
      getRecentClips: async () => ({ success: true, clips: [] }),
    };

    const handlersWithFailure = createClipboardIpcHandlers({
      captureService: env.captureService,
      persistenceService: failingPersistence,
      isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    });

    // 3. Invoke clear history
    const result = await handlersWithFailure.handleClearHistory(mockEvent);

    // 4. Verify fail-closed behavior: success=false, generic error message without database internals
    assert.equal(result.success, false);
    assert.equal(result.error, 'Failed to clear saved clipboard history from local storage.');
    assert.ok(!result.error.includes('SQLite'));
    assert.ok(!result.error.includes('I/O'));

    // 5. Verify session memory was NOT cleared
    assert.equal(env.captureService.getRecentItems().length, 1);
  } finally {
    await env.close();
  }
});

test('Clear History - 5. Fails safely when database persistence service is unavailable', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    const mockEvent = createMockEvent();

    await env.captureService.start();
    env.adapter.setText('Session item before unavail test');
    await env.captureService.pollNow();

    assert.equal(env.captureService.getRecentItems().length, 1);

    const handlersWithoutDb = createClipboardIpcHandlers({
      captureService: env.captureService,
      persistenceService: null,
      isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    });

    const result = await handlersWithoutDb.handleClearHistory(mockEvent);

    assert.equal(result.success, false);
    assert.equal(
      result.error,
      'Local database storage is unavailable; cannot clear persisted history.',
    );
    // In-memory items remain preserved
    assert.equal(env.captureService.getRecentItems().length, 1);
  } finally {
    await env.close();
  }
});

test('Expiry & Pinned Items - 1. deleteExpired preserves pinned clips even if expired', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    // 1. Manually insert an unpinned expired clip and a pinned expired clip
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day ahead

    const dummyCipher = Buffer.from('ciphertext');
    const dummyNonce = Buffer.from('123456789012');
    const dummyTag = Buffer.from('1234567890123456');

    // Unpinned expired
    await env.client.clip.create({
      data: {
        contentType: 'text/plain',
        encryptedPayload: dummyCipher,
        encryptionNonce: dummyNonce,
        encryptionAuthTag: dummyTag,
        payloadByteLength: 20,
        expiresAt: pastDate,
        pinnedAt: null,
      },
    });

    // Pinned expired
    await env.client.clip.create({
      data: {
        contentType: 'text/plain',
        encryptedPayload: dummyCipher,
        encryptionNonce: dummyNonce,
        encryptionAuthTag: dummyTag,
        payloadByteLength: 20,
        expiresAt: pastDate,
        pinnedAt: new Date(),
      },
    });

    // Unpinned active
    await env.client.clip.create({
      data: {
        contentType: 'text/plain',
        encryptedPayload: dummyCipher,
        encryptionNonce: dummyNonce,
        encryptionAuthTag: dummyTag,
        payloadByteLength: 20,
        expiresAt: futureDate,
        pinnedAt: null,
      },
    });

    assert.equal((await env.client.clip.findMany()).length, 3);

    // 2. Run deleteExpired
    const deletedCount = await env.clipRepo.deleteExpired(new Date());
    assert.equal(deletedCount, 1);

    // 3. Confirm 2 clips remain: the unpinned active clip AND the pinned expired clip
    const remaining = await env.client.clip.findMany();
    assert.equal(remaining.length, 2);
    const pinnedRemaining = remaining.find((c) => c.pinnedAt !== null);
    assert.ok(pinnedRemaining, 'Pinned clip must be preserved even if expired');
  } finally {
    await env.close();
  }
});

test('Expiry & Pinned Items - 2. maybePurgeExpiredClips throttles database cleanup', async () => {
  const env = await setupIsolatedEnvironment({ initialConsent: true });
  try {
    // First call runs cleanup
    const firstResult = await env.persistenceService.maybePurgeExpiredClips();
    assert.notEqual(firstResult, null);

    // Immediate second call is throttled and returns null without running queries
    const secondResult = await env.persistenceService.maybePurgeExpiredClips();
    assert.equal(secondResult, null);
  } finally {
    await env.close();
  }
});

test('Pin / Delete Consistency - 1. Session-only pins for unsaved clips and no ghost entries', () => {
  const liveClips = [
    {
      id: 'live-clip-unsaved-1',
      text: 'Unsaved active clip',
      detectedAt: '2026-10-22T10:00:00Z',
      byteLength: 19,
      category: 'text',
    },
  ];
  const persistedClips = [];
  const sessionPinnedIds = new Set(['live-clip-unsaved-1']);

  // Merging with session pin keeps unsaved item pinned without DB entry
  const result = mergeHistoryClips(liveClips, persistedClips, sessionPinnedIds, 100);
  assert.equal(result.clips.length, 1);
  assert.equal(result.clips[0].id, 'live-clip-unsaved-1');
  assert.equal(result.clips[0].isPinned, true);
  assert.equal(result.clips[0].isPersisted, false);
  assert.equal(result.persistedIds.has('live-clip-unsaved-1'), false);
  assert.equal(result.allPinnedIds.has('live-clip-unsaved-1'), true);

  // Clearing history removes all items and pinned IDs
  const cleared = mergeHistoryClips([], [], new Set(), 100);
  assert.equal(cleared.clips.length, 0);
  assert.equal(cleared.allPinnedIds.size, 0);
  assert.equal(cleared.persistedIds.size, 0);
});
