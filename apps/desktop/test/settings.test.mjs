/**
 * ClipOrbit — Settings IPC & Configuration Test Suite
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SETTING_KEYS,
} from '@cliporbit/contracts';
import { createAppSettingRepository } from '@cliporbit/database';
import { createSettingsIpcHandlers } from '../dist/main/settingsIpc.js';
import {
  ClipboardCaptureService,
  FakeClipboardAdapter,
} from '../dist/services/clipboard/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

let devDbInitialMtime = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-settings-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
}

function createMockEvent(url, parent = null) {
  return {
    senderFrame: {
      url,
      parent,
    },
  };
}

class FakeElectronApp {
  constructor() {
    this.openAtLogin = false;
  }

  getLoginItemSettings() {
    return {
      openAtLogin: this.openAtLogin,
    };
  }

  setLoginItemSettings(settings) {
    if (typeof settings?.openAtLogin === 'boolean') {
      this.openAtLogin = settings.openAtLogin;
    }
  }
}

class FakePersistencePolicy {
  constructor(initialEnabled = false) {
    this.enabled = initialEnabled;
  }

  async isPersistenceEnabled() {
    return this.enabled;
  }

  async setPersistenceEnabled(val) {
    this.enabled = Boolean(val);
    return this.enabled;
  }
}

let testEnv;

async function setupTestEnvironment() {
  const tmpDir = createTempDir('cliporbit-settings-env-');
  const dbInit = await initializeDatabase({ userDataPath: tmpDir });
  const repo = createAppSettingRepository(dbInit.client);
  const app = new FakeElectronApp();
  const policy = new FakePersistencePolicy();

  return {
    tmpDir,
    dbInit,
    repo,
    app,
    policy,
  };
}

before(async () => {
  if (fs.existsSync(devDbPath)) {
    devDbInitialMtime = fs.statSync(devDbPath).mtimeMs;
  }
  testEnv = await setupTestEnvironment();
});

after(async () => {
  await closeDatabase();
  for (const dir of tempDirsToCleanup) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in test
    }
  }

  if (fs.existsSync(devDbPath) && devDbInitialMtime !== null) {
    const currentMtime = fs.statSync(devDbPath).mtimeMs;
    assert.equal(
      currentMtime,
      devDbInitialMtime,
      'DEVELOPMENT DATABASE INTEGRITY VIOLATION: dev.db was modified during tests!',
    );
  }
});

// ============================================================================
// Settings IPC Handler Tests
// ============================================================================

test('Settings IPC - handleGetAllSettings returns defaults on fresh installation', async () => {
  const handlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent(ALLOWED_ORIGIN);
  const settings = await handlers.handleGetAllSettings(event);

  assert.equal(settings.clipboardPersistenceEnabled, false);
  assert.equal(settings.launchAtLogin, false);
  assert.equal(settings.defaultView, 'history');
  assert.equal(settings.excludePasswordManagers, true);
  assert.equal(settings.maskDetectedSecrets, true);
  assert.equal(settings.clearOnExit, false);
  assert.equal(settings.maxHistorySize, 1000);
  assert.equal(settings.retentionPeriod, '30');
});

test('Settings IPC - handleSetSetting updates and persists preferences', async () => {
  const handlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent(ALLOWED_ORIGIN);

  // 1. Update Launch at login
  await handlers.handleSetSetting(event, SETTING_KEYS.LAUNCH_AT_LOGIN, 'true');
  assert.equal(testEnv.app.openAtLogin, true);

  // 2. Update Default view
  await handlers.handleSetSetting(event, SETTING_KEYS.DEFAULT_VIEW, 'snippets');

  // 3. Update Exclude password managers
  await handlers.handleSetSetting(event, SETTING_KEYS.EXCLUDE_PASSWORD_MANAGERS, 'false');

  // 4. Update Mask detected secrets
  await handlers.handleSetSetting(event, SETTING_KEYS.MASK_DETECTED_SECRETS, 'false');

  // 5. Update Clear on exit
  await handlers.handleSetSetting(event, SETTING_KEYS.CLEAR_ON_EXIT, 'true');

  // 6. Update Max history size
  await handlers.handleSetSetting(event, SETTING_KEYS.MAX_HISTORY_SIZE, '500');

  // 7. Update Retention period
  await handlers.handleSetSetting(event, SETTING_KEYS.RETENTION_PERIOD, '90');

  // Verify all updated settings in handleGetAllSettings
  const updated = await handlers.handleGetAllSettings(event);
  assert.equal(updated.launchAtLogin, true);
  assert.equal(updated.defaultView, 'snippets');
  assert.equal(updated.excludePasswordManagers, false);
  assert.equal(updated.maskDetectedSecrets, false);
  assert.equal(updated.clearOnExit, true);
  assert.equal(updated.maxHistorySize, 500);
  assert.equal(updated.retentionPeriod, '90');
});

test('Settings IPC - handleSetLaunchAtLogin and handleGetLaunchAtLogin', async () => {
  const handlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent(ALLOWED_ORIGIN);

  const res1 = await handlers.handleSetLaunchAtLogin(event, true);
  assert.equal(res1, true);
  assert.equal(await handlers.handleGetLaunchAtLogin(event), true);

  const res2 = await handlers.handleSetLaunchAtLogin(event, false);
  assert.equal(res2, false);
  assert.equal(await handlers.handleGetLaunchAtLogin(event), false);

  // Rejects invalid input
  await assert.rejects(
    () => handlers.handleSetLaunchAtLogin(event, 'not-a-bool'),
    /must be a boolean/,
  );
});

test('Settings IPC - authorization and shutdown validation', async () => {
  const handlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: (ev) => ev.senderFrame.url === ALLOWED_ORIGIN,
    isShutdown: () => false,
  });

  const unauthorizedEvent = createMockEvent('http://malicious.org');

  await assert.rejects(
    () => handlers.handleGetAllSettings(unauthorizedEvent),
    /Unauthorized IPC sender origin or frame/,
  );

  await assert.rejects(
    () => handlers.handleSetSetting(unauthorizedEvent, SETTING_KEYS.DEFAULT_VIEW, 'history'),
    /Unauthorized IPC sender origin or frame/,
  );

  // Shutdown containment
  const shutdownHandlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: () => true,
    isShutdown: () => true,
  });

  const validEvent = createMockEvent(ALLOWED_ORIGIN);
  await assert.rejects(
    () => shutdownHandlers.handleGetAllSettings(validEvent),
    /Application is shutting down/,
  );
});

test('Settings IPC - input validation bounds', async () => {
  const handlers = createSettingsIpcHandlers({
    policy: testEnv.policy,
    repo: testEnv.repo,
    app: testEnv.app,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent(ALLOWED_ORIGIN);

  // Rejects invalid keys
  await assert.rejects(
    () => handlers.handleSetSetting(event, 'invalid.setting.key', 'value'),
    /Invalid setting key/,
  );

  // Rejects non-string values
  await assert.rejects(
    () => handlers.handleSetSetting(event, SETTING_KEYS.DEFAULT_VIEW, 123),
    /Setting value must be a string/,
  );

  // Rejects excessively long values (> 1024 characters)
  await assert.rejects(
    () => handlers.handleSetSetting(event, SETTING_KEYS.DEFAULT_VIEW, 'a'.repeat(2000)),
    /exceeds maximum allowed length/,
  );
});

test('Password Manager Exclusion - excludes concealed clipboard content', async () => {
  const adapter = new FakeClipboardAdapter();
  adapter.setText('vault-password-secret-1234');
  adapter.setConcealed(true);

  let excludePref = true;
  const service = new ClipboardCaptureService({
    adapter,
    config: {
      isExcludePasswordManagersEnabled: () => excludePref,
    },
  });

  await service.start();
  // Poll with concealed content
  adapter.setText('new-vault-password');
  await service.pollNow();

  // With excludePref = true, it must be skipped and never appear in history
  const items = service.getRecentItems();
  assert.equal(items.length, 0);
  assert.equal(service.getStatus().skippedSensitiveCount, 1);

  // Now disable exclude password managers
  excludePref = false;
  adapter.setText('non-excluded-password');
  await service.pollNow();

  // Now it is captured normally
  assert.equal(service.getRecentItems().length, 1);
  assert.equal(service.getRecentItems()[0].text, 'non-excluded-password');

  service.stop();
});
