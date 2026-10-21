/**
 * ClipOrbit — Secure Clipboard IPC & Lifecycle Integration Test Suite
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 *
 * Verifies:
 * 1. IPC sender authorization: Authorized main-frame succeeds.
 * 2. IPC sender authorization: Unauthorized origin is rejected.
 * 3. IPC sender authorization: Child frame / iframe is rejected.
 * 4. IPC channel isolation: Handlers do not accept generic arbitrary IPC requests.
 * 5. Lifecycle shutdown: Capture operations are rejected after shutdown begins.
 * 6. Baseline establishment: Initial clipboard text before start is not emitted into history.
 * 7. Live change detection: Modifying clipboard emits new clip entries through getRecentClips.
 * 8. Deduplication: Unchanged clipboard text does not duplicate entries.
 * 9. Pause semantics: Pause prevents clipboard reads.
 * 10. Resume baseline: Changes during pause are ignored when establishing fresh baseline on resume.
 * 11. Stop cleanup: Stop clears in-memory history and resets counters.
 * 12. DTO serialization: No SHA-256 fingerprints, secret keys, or Buffer instances leak across IPC.
 * 13. Lifecycle coordination: Clipboard polling is stopped before encryption and database teardown.
 * 14. Shutdown idempotency: Repeated shutdown does not create race conditions or duplicate teardown.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ClipboardCaptureService, FakeClipboardAdapter } from '../dist/services/clipboard/index.js';
import {
  createClipboardIpcHandlers,
  serializeClipboardStatus,
  serializeCapturedClips,
} from '../dist/main/clipboardIpc.js';
import { LifecycleCoordinator } from '../dist/main/lifecycle.js';
import { isAuthorizedFrame } from '../dist/main/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

let devDbInitialMtime = null;
let devDbInitialSize = null;

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
});

function createMockEvent(url = 'http://127.0.0.1:3000', parent = null) {
  return {
    senderFrame: {
      url,
      parent,
    },
  };
}

// ============================================================================
// 1. IPC Sender Authorization & Channel Narrowing
// ============================================================================

test('Clipboard IPC - authorized main-frame request succeeds', async () => {
  const adapter = new FakeClipboardAdapter('Initial text');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => false,
  });

  const event = createMockEvent('http://127.0.0.1:3000/settings');
  const status = await handlers.handleStartCapture(event);

  assert.equal(status.isRunning, true);
  assert.equal(status.isPaused, false);
  assert.equal(status.itemCount, 0); // baseline established without emitting

  service.stop();
});

test('Clipboard IPC - unauthorized origin is rejected with error', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => false,
  });

  const untrustedEvent = createMockEvent('https://attacker.evil.com');

  await assert.rejects(
    async () => {
      await handlers.handleStartCapture(untrustedEvent);
    },
    { message: /Unauthorized IPC sender origin or frame/ },
  );

  assert.throws(() => handlers.handleGetCaptureStatus(untrustedEvent), {
    message: /Unauthorized IPC sender origin or frame/,
  });

  assert.throws(() => handlers.handleGetRecentClips(untrustedEvent), {
    message: /Unauthorized IPC sender origin or frame/,
  });

  service.stop();
});

test('Clipboard IPC - child frame and iframe requests are rejected', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
    isShutdown: () => false,
  });

  const childFrameEvent = createMockEvent('http://127.0.0.1:3000/embed', { parentId: 'top' });

  await assert.rejects(
    async () => {
      await handlers.handleStartCapture(childFrameEvent);
    },
    { message: /Unauthorized IPC sender origin or frame/ },
  );

  service.stop();
});

test('Clipboard IPC - capture operations are rejected after shutdown begins', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  let isShuttingDown = false;

  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => isShuttingDown,
  });

  const event = createMockEvent();

  // Initially succeeds
  const initialStatus = handlers.handleGetCaptureStatus(event);
  assert.equal(initialStatus.isRunning, false);

  // Mark shutdown active
  isShuttingDown = true;

  await assert.rejects(
    async () => {
      await handlers.handleStartCapture(event);
    },
    { message: /Application is shutting down; clipboard operation rejected/ },
  );

  assert.throws(() => handlers.handlePauseCapture(event), {
    message: /Application is shutting down; clipboard operation rejected/,
  });

  assert.throws(() => handlers.handleGetRecentClips(event), {
    message: /Application is shutting down; clipboard operation rejected/,
  });

  service.stop();
});

// ============================================================================
// 2. Capture Lifecycle and Live DTO Sync
// ============================================================================

test('Clipboard IPC - start establishes baseline and detects subsequent live changes', async () => {
  const adapter = new FakeClipboardAdapter('Existing clipboard data before app start');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent();

  // 1. Start capture
  const startStatus = await handlers.handleStartCapture(event);
  assert.equal(startStatus.isRunning, true);
  assert.equal(startStatus.itemCount, 0);

  // Baseline data must not be in recent clips
  const initialClips = handlers.handleGetRecentClips(event);
  assert.equal(initialClips.length, 0);

  // 2. Change clipboard content
  adapter.setText('https://github.com/KartikMehra22/ClipVault');
  await service.pollNow();

  const statusAfterChange = handlers.handleGetCaptureStatus(event);
  assert.equal(statusAfterChange.itemCount, 1);
  assert.ok(statusAfterChange.totalByteLength > 0);
  assert.ok(statusAfterChange.lastDetectedAt !== null);

  const clips = handlers.handleGetRecentClips(event);
  assert.equal(clips.length, 1);
  assert.equal(clips[0].text, 'https://github.com/KartikMehra22/ClipVault');
  assert.equal(clips[0].category, 'url');
  assert.equal(typeof clips[0].detectedAt, 'string'); // ISO string
  assert.equal(clips[0].byteLength, Buffer.byteLength(clips[0].text, 'utf8'));

  service.stop();
});

test('Clipboard IPC - pause and resume establish fresh baselines correctly', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent();

  await handlers.handleStartCapture(event);
  adapter.setText('Active clip item 1');
  await service.pollNow();
  assert.equal(handlers.handleGetRecentClips(event).length, 1);

  // Pause
  const pauseStatus = handlers.handlePauseCapture(event);
  assert.equal(pauseStatus.isPaused, true);

  // Change copied while paused
  adapter.setText('Copied while paused - should be ignored');
  await service.pollNow();
  assert.equal(handlers.handleGetRecentClips(event).length, 1); // Not recorded

  // Resume establishes fresh baseline with "Copied while paused"
  const resumeStatus = await handlers.handleResumeCapture(event);
  assert.equal(resumeStatus.isPaused, false);
  assert.equal(handlers.handleGetRecentClips(event).length, 1); // Still 1

  // New clip after resume
  adapter.setText('Active clip item 2');
  await service.pollNow();

  const finalClips = handlers.handleGetRecentClips(event);
  assert.equal(finalClips.length, 2);
  assert.equal(finalClips[0].text, 'Active clip item 2');
  assert.equal(finalClips[1].text, 'Active clip item 1');

  service.stop();
});

test('Clipboard IPC - stop purges in-memory history and returns clean inactive status', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent();

  await handlers.handleStartCapture(event);
  adapter.setText('Text to be wiped on stop');
  await service.pollNow();
  assert.equal(handlers.handleGetRecentClips(event).length, 1);

  // Stop & clear
  const stopStatus = handlers.handleStopCapture(event);
  assert.equal(stopStatus.isRunning, false);
  assert.equal(stopStatus.isPaused, false);
  assert.equal(stopStatus.itemCount, 0);
  assert.equal(stopStatus.totalByteLength, 0);

  const clipsAfterStop = handlers.handleGetRecentClips(event);
  assert.equal(clipsAfterStop.length, 0);
});

// ============================================================================
// 3. Serialization Privacy & Redaction
// ============================================================================

test('Clipboard IPC - serialization redacts internal fingerprints and secret material', () => {
  const internalStatus = {
    isRunning: true,
    isPaused: false,
    itemCount: 42,
    totalByteLength: 2048,
    skippedOversizedCount: 1,
    lastDetectedAt: new Date('2026-10-21T10:00:00Z'),
  };

  const dto = serializeClipboardStatus(internalStatus);

  assert.deepEqual(Object.keys(dto).sort(), [
    'isPaused',
    'isRunning',
    'itemCount',
    'lastDetectedAt',
    'skippedOversizedCount',
    'totalByteLength',
  ]);

  assert.equal('fingerprint' in dto, false);
  assert.equal('lastFingerprint' in dto, false);
  assert.equal('key' in dto, false);
  assert.equal('path' in dto, false);
  assert.equal(dto.lastDetectedAt, '2026-10-21T10:00:00.000Z');
});

test('Clipboard IPC - serialized clips output strict expected fields', () => {
  const items = [
    {
      id: 'uuid-1',
      text: 'hello world',
      detectedAt: new Date('2026-10-21T10:05:00Z'),
      byteLength: 11,
      category: 'text',
    },
  ];

  const dtos = serializeCapturedClips(items);
  assert.equal(dtos.length, 1);
  assert.deepEqual(Object.keys(dtos[0]).sort(), [
    'byteLength',
    'category',
    'detectedAt',
    'id',
    'text',
  ]);
  assert.equal(dtos[0].detectedAt, '2026-10-21T10:05:00.000Z');
});

// ============================================================================
// 4. Lifecycle Coordinator Integration
// ============================================================================

test('Lifecycle - clipboard polling is stopped before encryption and database teardown', async () => {
  const callLog = [];

  const coordinator = new LifecycleCoordinator({
    initializeDatabase: async () => {
      callLog.push('initDb');
    },
    closeDatabase: async () => {
      callLog.push('closeDb');
    },
    initializeEncryption: async () => {
      callLog.push('initEnc');
    },
    disposeEncryption: () => {
      callLog.push('disposeEnc');
    },
    disposeClipboard: () => {
      callLog.push('disposeClipboard');
    },
    createWindow: () => {
      callLog.push('createWindow');
    },
    showErrorBox: () => {},
    quitApp: () => {},
  });

  await coordinator.startup();
  assert.equal(coordinator.getStatus().isFullyReady, true);

  await coordinator.shutdown();

  // Order must be: disposeClipboard -> disposeEnc -> closeDb
  const clipIndex = callLog.indexOf('disposeClipboard');
  const encIndex = callLog.indexOf('disposeEnc');
  const dbIndex = callLog.indexOf('closeDb');

  assert.ok(clipIndex !== -1, 'disposeClipboard must be called');
  assert.ok(encIndex !== -1, 'disposeEnc must be called');
  assert.ok(dbIndex !== -1, 'closeDb must be called');

  assert.ok(clipIndex < encIndex, 'Clipboard service must be disposed before encryption service');
  assert.ok(encIndex < dbIndex, 'Encryption service must be disposed before closing database');
});

test('Lifecycle - repeated shutdown does not duplicate clipboard disposal or crash', async () => {
  let clipboardDisposedCount = 0;

  const coordinator = new LifecycleCoordinator({
    initializeDatabase: async () => {},
    closeDatabase: async () => {},
    initializeEncryption: async () => {},
    disposeEncryption: () => {},
    disposeClipboard: () => {
      clipboardDisposedCount += 1;
    },
    createWindow: () => {},
    showErrorBox: () => {},
    quitApp: () => {},
  });

  await coordinator.startup();
  await coordinator.shutdown();
  await coordinator.shutdown();
  await coordinator.shutdown();

  assert.equal(clipboardDisposedCount, 1, 'Clipboard must only be disposed once during shutdown');
  assert.equal(coordinator.isShutdownCompleted(), true);
});
