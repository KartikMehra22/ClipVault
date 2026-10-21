/**
 * ClipOrbit — Application Lifecycle Coordinator Test Suite
 * Phase 4.6: Runtime Encryption Initialization and Lifecycle Integration
 *
 * Verifies:
 * 1. Startup sequence: Database initializes before encryption.
 * 2. BrowserWindow is created only after both database and encryption succeed.
 * 3. Database failure prevents encryption and window creation.
 * 4. Encryption failure prevents window creation and dispatches clear native error.
 * 5. Encryption failure disconnects initialized database resources cleanly.
 * 6. Error dialogs sanitize sensitive details and never leak raw key material.
 * 7. Repeated initialization is idempotent and does not create duplicate services.
 * 8. Shutdown disposes encryption before disconnecting database (safe teardown ordering).
 * 9. Repeated shutdown is idempotent and does not cause recursive quit loops.
 * 10. Non-secret readiness status contains no secret keys, paths, or payload content.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LifecycleCoordinator, sanitizeErrorMessage } from '../dist/main/lifecycle.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

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
});

/**
 * Creates a mock test environment for the LifecycleCoordinator.
 */
function createMockCoordinator(overrides = {}) {
  const callLog = [];
  const errorsShown = [];
  let quitCalled = false;

  const deps = {
    initializeDatabase: async () => {
      callLog.push('initDb');
      return { success: true };
    },
    closeDatabase: async () => {
      callLog.push('closeDb');
    },
    initializeEncryption: async () => {
      callLog.push('initEnc');
      return { isInitialized: true };
    },
    disposeEncryption: () => {
      callLog.push('disposeEnc');
    },
    createWindow: () => {
      callLog.push('createWindow');
    },
    showErrorBox: (title, content) => {
      callLog.push('showErrorBox');
      errorsShown.push({ title, content });
    },
    quitApp: () => {
      callLog.push('quitApp');
      quitCalled = true;
    },
    log: () => {},
    logError: () => {},
    ...overrides,
  };

  const coordinator = new LifecycleCoordinator(deps);

  return {
    coordinator,
    callLog,
    errorsShown,
    getQuitCalled: () => quitCalled,
  };
}

// ============================================================================
// 1. Startup Order & Window Creation
// ============================================================================

test('Lifecycle - database initializes before encryption, followed by window creation', async () => {
  const { coordinator, callLog } = createMockCoordinator();

  const success = await coordinator.startup();

  assert.equal(success, true);
  assert.deepEqual(callLog, ['initDb', 'initEnc', 'createWindow']);

  const status = coordinator.getStatus();
  assert.equal(status.isDatabaseReady, true);
  assert.equal(status.isEncryptionReady, true);
  assert.equal(status.isFullyReady, true);
  assert.equal(status.isShutdownInProgress, false);
  assert.equal(status.isShutdownCompleted, false);
});

test('Lifecycle - window is not created until both database and encryption succeed', async () => {
  let dbWasReadyAtWindowCreation = false;
  let encWasReadyAtWindowCreation = false;

  const { coordinator } = createMockCoordinator({
    createWindow: () => {
      const currentStatus = coordinator.getStatus();
      dbWasReadyAtWindowCreation = currentStatus.isDatabaseReady;
      encWasReadyAtWindowCreation = currentStatus.isEncryptionReady;
    },
  });

  const success = await coordinator.startup();
  assert.equal(success, true);
  assert.equal(dbWasReadyAtWindowCreation, true);
  assert.equal(encWasReadyAtWindowCreation, true);
});

// ============================================================================
// 2. Failure Handling & Resource Cleanup
// ============================================================================

test('Lifecycle - database failure prevents encryption initialization and window creation', async () => {
  const { coordinator, callLog, errorsShown, getQuitCalled } = createMockCoordinator({
    initializeDatabase: async () => {
      callLog.push('initDb');
      throw new Error('SQLite disk I/O error or migration failure');
    },
  });

  const success = await coordinator.startup();

  assert.equal(success, false);
  // Encryption should never be called if database fails
  assert.equal(callLog.includes('initEnc'), false);
  // Window must not be created
  assert.equal(callLog.includes('createWindow'), false);
  // Must clean up, show error box, and quit
  assert.equal(callLog.includes('showErrorBox'), true);
  assert.equal(getQuitCalled(), true);

  assert.equal(errorsShown.length, 1);
  assert.ok(errorsShown[0].title.includes('Database Initialization Error'));
  assert.ok(errorsShown[0].content.includes('SQLite disk I/O error'));

  const status = coordinator.getStatus();
  assert.equal(status.isDatabaseReady, false);
  assert.equal(status.isEncryptionReady, false);
  assert.equal(status.isFullyReady, false);
});

test('Lifecycle - encryption failure prevents window creation and dispatches native error', async () => {
  const { coordinator, callLog, errorsShown, getQuitCalled } = createMockCoordinator({
    initializeEncryption: async () => {
      callLog.push('initEnc');
      throw new Error('Operating system secure storage (safeStorage) is not available.');
    },
  });

  const success = await coordinator.startup();

  assert.equal(success, false);
  assert.equal(callLog.includes('createWindow'), false);
  assert.equal(callLog.includes('showErrorBox'), true);
  assert.equal(getQuitCalled(), true);

  assert.equal(errorsShown.length, 1);
  assert.ok(errorsShown[0].title.includes('Encryption Initialization Error'));
  assert.ok(errorsShown[0].content.includes('safeStorage'));

  const status = coordinator.getStatus();
  assert.equal(status.isFullyReady, false);
  assert.equal(status.isEncryptionReady, false);
});

test('Lifecycle - encryption failure causes initialized database resources to be disconnected', async () => {
  const { coordinator, callLog } = createMockCoordinator({
    initializeEncryption: async () => {
      callLog.push('initEnc');
      throw new Error('Linux basic_text backend rejected as insecure.');
    },
  });

  await coordinator.startup();

  // Database was initialized, then disconnected during error cleanup
  assert.ok(callLog.indexOf('initDb') < callLog.indexOf('closeDb'));
  assert.ok(callLog.includes('closeDb'));
  assert.ok(callLog.includes('disposeEnc'));

  const status = coordinator.getStatus();
  assert.equal(status.isDatabaseReady, false);
  assert.equal(status.isEncryptionReady, false);
});

// ============================================================================
// 3. Error Sanitization & Key Privacy
// ============================================================================

test('Lifecycle - error messages sanitize 64-character hexadecimal key strings', async () => {
  const fakeKeyHex = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const rawErrorMessage = `Encryption key error with master key ${fakeKeyHex} during load`;

  const { coordinator, errorsShown } = createMockCoordinator({
    initializeEncryption: async () => {
      throw new Error(rawErrorMessage);
    },
  });

  await coordinator.startup();

  assert.equal(errorsShown.length, 1);
  const errorContent = errorsShown[0].content;

  // The raw key hex must be scrubbed from the error box
  assert.equal(errorContent.includes(fakeKeyHex), false);
  assert.ok(errorContent.includes('[REDACTED_KEY]'));
});

test('Lifecycle - sanitizeErrorMessage handles various input types', () => {
  assert.equal(sanitizeErrorMessage(null), 'An unknown internal error occurred.');
  assert.equal(sanitizeErrorMessage(''), 'An unknown internal error occurred.');
  assert.equal(sanitizeErrorMessage(new Error('Normal error message')), 'Normal error message');

  const textWithHex =
    'Secret key: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef found';
  const sanitized = sanitizeErrorMessage(textWithHex);
  assert.ok(!sanitized.includes('0123456789abcdef'));
  assert.ok(sanitized.includes('[REDACTED_KEY]'));
});

// ============================================================================
// 4. Idempotency & Shutdown Coordination
// ============================================================================

test('Lifecycle - repeated startup is idempotent and does not create duplicate services', async () => {
  const { coordinator, callLog } = createMockCoordinator();

  const firstResult = await coordinator.startup();
  assert.equal(firstResult, true);
  assert.deepEqual(callLog, ['initDb', 'initEnc', 'createWindow']);

  // Second call
  const secondResult = await coordinator.startup();
  assert.equal(secondResult, true);

  // Call counts must remain 1
  const initDbCount = callLog.filter((c) => c === 'initDb').length;
  const initEncCount = callLog.filter((c) => c === 'initEnc').length;
  const windowCount = callLog.filter((c) => c === 'createWindow').length;

  assert.equal(initDbCount, 1);
  assert.equal(initEncCount, 1);
  assert.equal(windowCount, 1);
});

test('Lifecycle - shutdown disposes encryption before disconnecting database', async () => {
  const { coordinator, callLog } = createMockCoordinator();

  await coordinator.startup();
  assert.equal(coordinator.getStatus().isFullyReady, true);

  await coordinator.shutdown();

  // Teardown ordering: disposeEnc must precede closeDb
  const disposeIndex = callLog.indexOf('disposeEnc');
  const closeDbIndex = callLog.indexOf('closeDb');

  assert.ok(disposeIndex !== -1);
  assert.ok(closeDbIndex !== -1);
  assert.ok(
    disposeIndex < closeDbIndex,
    'Encryption service must be disposed before closing database',
  );

  const status = coordinator.getStatus();
  assert.equal(status.isFullyReady, false);
  assert.equal(status.isDatabaseReady, false);
  assert.equal(status.isEncryptionReady, false);
  assert.equal(status.isShutdownCompleted, true);
  assert.equal(coordinator.isShutdownCompleted(), true);
});

test('Lifecycle - repeated shutdown calls do not recurse or duplicate teardown', async () => {
  const { coordinator, callLog } = createMockCoordinator();

  await coordinator.startup();

  // Call shutdown three times
  await coordinator.shutdown();
  await coordinator.shutdown();
  await coordinator.shutdown();

  const disposeCount = callLog.filter((c) => c === 'disposeEnc').length;
  const closeDbCount = callLog.filter((c) => c === 'closeDb').length;

  assert.equal(disposeCount, 1);
  assert.equal(closeDbCount, 1);
  assert.equal(coordinator.isShutdownCompleted(), true);
});

// ============================================================================
// 5. Readiness Status Privacy & Safety
// ============================================================================

test('Lifecycle - getStatus returns strictly non-secret boolean flags', () => {
  const { coordinator } = createMockCoordinator();
  const status = coordinator.getStatus();

  // Ensure only approved fields exist
  const keys = Object.keys(status).sort();
  assert.deepEqual(keys, [
    'isDatabaseReady',
    'isEncryptionReady',
    'isFullyReady',
    'isShutdownCompleted',
    'isShutdownInProgress',
  ]);

  // Ensure every field is a boolean
  for (const key of keys) {
    assert.equal(typeof status[key], 'boolean');
  }

  // Ensure no secret material or paths exist
  assert.equal('key' in status, false);
  assert.equal('path' in status, false);
  assert.equal('payload' in status, false);
});
