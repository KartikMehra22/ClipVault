/**
 * ClipOrbit — Explicit Consent for Encrypted Clipboard Persistence Test Suite
 * Phase 6.3.2: Explicit Consent for Encrypted Clipboard Persistence
 *
 * Verifies:
 * 1. A missing preference resolves to disabled.
 * 2. Invalid or unreadable preference data fails closed.
 * 3. Enabling and disabling the preference persists the expected value.
 * 4. The policy used by the persistence service observes preference changes without requiring a restart.
 * 5. When disabled, saveTextClip() performs no encryption and no database write.
 * 6. When enabled, the policy allows eligible content to reach the existing validation and encryption pipeline,
 *    while automatic capture saving remains disconnected.
 * 7. IPC rejects unauthorized senders and invalid inputs according to existing conventions.
 * 8. The renderer receives only the typed preference value and result needed by the settings UI.
 * 9. UI loading or save failures never falsely represent persistence as enabled.
 * 10. Existing sensitive-content and oversized-payload protections remain intact.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseClipboardPersistenceConsent,
  ClipboardPersistencePolicy,
  createClipboardPersistencePolicy,
  createEncryptedClipboardPersistenceService,
  PersistenceDisabledError,
  PersistenceValidationError,
  PersistenceSensitiveContentError,
} from '../dist/services/clipboard/index.js';
import { EncryptionService } from '../dist/services/crypto/index.js';
import { initializeDatabase, closeDatabase } from '../dist/services/database.js';
import { createClipRepository, createAppSettingRepository } from '@cliporbit/database';
import { SETTING_KEYS } from '@cliporbit/contracts';
import { createSettingsIpcHandlers } from '../dist/main/settingsIpc.js';
import { isAuthorizedFrame } from '../dist/main/security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

const ALLOWED_ORIGIN = 'http://127.0.0.1:3000';

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-consent-test-') {
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

function createMockEvent(url, parent = null) {
  return {
    senderFrame: {
      url,
      parent,
    },
  };
}

async function setupIsolatedEnvironment() {
  const tmpDir = createTempDir('cliporbit-consent-env-');

  const encService = new EncryptionService();
  await encService.initialize({
    userDataPath: tmpDir,
    keyProtector: new FakeKeyProtector(),
  });

  const dbResult = await initializeDatabase({ userDataPath: tmpDir });
  const client = dbResult.client;
  const clipRepo = createClipRepository(client);
  const settingRepo = createAppSettingRepository(client);

  return {
    tmpDir,
    encService,
    client,
    clipRepo,
    settingRepo,
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
      // Ignore cleanup error
    }
  }

  // Development database integrity assertion
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
// Scope D: Test Suite
// ============================================================================

test('Consent 1 — Missing preference resolves to disabled', async () => {
  // Pure parser check
  assert.equal(parseClipboardPersistenceConsent(undefined), false);
  assert.equal(parseClipboardPersistenceConsent(null), false);
  assert.equal(parseClipboardPersistenceConsent(''), false);

  // Database-backed policy check with empty database
  const env = await setupIsolatedEnvironment();
  try {
    const policy = new ClipboardPersistencePolicy(env.settingRepo);
    const isEnabled = await policy.isPersistenceEnabled();
    assert.equal(isEnabled, false, 'Missing preference must strictly resolve to false');
  } finally {
    await env.teardown();
  }
});

test('Consent 2 — Invalid or unreadable preference data fails closed', async () => {
  // Pure parser check on invalid strings
  assert.equal(parseClipboardPersistenceConsent('0'), false);
  assert.equal(parseClipboardPersistenceConsent('1'), false);
  assert.equal(parseClipboardPersistenceConsent('yes'), false);
  assert.equal(parseClipboardPersistenceConsent('on'), false);
  assert.equal(parseClipboardPersistenceConsent('TRUE'), false); // Case-sensitive
  assert.equal(parseClipboardPersistenceConsent('{"enabled":true}'), false);
  assert.equal(parseClipboardPersistenceConsent('true '), false);

  // Database policy with invalid setting value inserted
  const env = await setupIsolatedEnvironment();
  try {
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'invalid_value');
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    assert.equal(
      await policy.isPersistenceEnabled(),
      false,
      'Invalid string value must fail closed',
    );

    // Database policy with unreadable/failing repository fails closed
    const failingRepo = {
      get: async () => {
        throw new Error('Database disk error');
      },
      set: async () => {
        throw new Error('Database disk error');
      },
    };
    const failingPolicy = createClipboardPersistencePolicy(failingRepo);
    assert.equal(
      await failingPolicy.isPersistenceEnabled(),
      false,
      'Database read error must fail closed',
    );
  } finally {
    await env.teardown();
  }
});

test('Consent 3 — Enabling and disabling the preference persists the expected value', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);

    // Initial state
    assert.equal(await policy.isPersistenceEnabled(), false);

    // Enable
    const enabledResult = await policy.setPersistenceEnabled(true);
    assert.equal(enabledResult, true);
    assert.equal(await policy.isPersistenceEnabled(), true);

    // Verify stored string in SQLite
    const storedAfterEnable = await env.settingRepo.get(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED);
    assert.equal(storedAfterEnable, 'true');

    // Disable
    const disabledResult = await policy.setPersistenceEnabled(false);
    assert.equal(disabledResult, false);
    assert.equal(await policy.isPersistenceEnabled(), false);

    // Verify stored string in SQLite
    const storedAfterDisable = await env.settingRepo.get(
      SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED,
    );
    assert.equal(storedAfterDisable, 'false');
  } finally {
    await env.teardown();
  }
});

test('Consent 4 — The policy used by the persistence service observes preference changes without requiring a restart', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    // 1. Starts disabled
    assert.equal(await service.isPersistenceEnabled(), false);

    // 2. Change preference in the database/policy
    await policy.setPersistenceEnabled(true);

    // 3. Service immediately sees the change without reinstantiation
    assert.equal(await service.isPersistenceEnabled(), true);

    // 4. Change directly via setting repository
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'false');

    // 5. Service immediately observes the direct DB change without restart
    assert.equal(await service.isPersistenceEnabled(), false);
  } finally {
    await env.teardown();
  }
});

test('Consent 5 — When disabled, saveTextClip() performs no encryption and no database write', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    let encryptionInvoked = false;
    const trackingEnc = {
      encrypt: (buf) => {
        encryptionInvoked = true;
        return env.encService.encrypt(buf);
      },
      decrypt: (input) => env.encService.decrypt(input),
    };

    const policy = createClipboardPersistencePolicy(env.settingRepo);
    // Explicitly ensure disabled
    await policy.setPersistenceEnabled(false);

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: trackingEnc,
      policy,
    });

    await assert.rejects(
      async () => service.saveTextClip({ text: 'Harmless text' }),
      PersistenceDisabledError,
    );

    assert.equal(
      encryptionInvoked,
      false,
      'No encryption must be performed when persistence is disabled',
    );

    const clipCount = await env.client.clip.count();
    assert.equal(clipCount, 0, 'No record must be written when persistence is disabled');
  } finally {
    await env.teardown();
  }
});

test('Consent 6 — When enabled, the policy allows eligible content to be encrypted and saved', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    await policy.setPersistenceEnabled(true);

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    const result = await service.saveTextClip({ text: 'Eligible safe note' });
    assert.ok(result.id);
    assert.equal(result.contentType, 'text/plain');

    const history = await service.getRecentClips();
    assert.equal(history.clips.length, 1);
    assert.equal(history.clips[0].text, 'Eligible safe note');
  } finally {
    await env.teardown();
  }
});

test('Consent 7 — IPC rejects unauthorized senders and invalid inputs', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    const handlers = createSettingsIpcHandlers({
      policy,
      isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
      isShutdown: () => false,
    });

    // 1. Authorized main-frame call succeeds
    const authorizedEvent = createMockEvent('http://127.0.0.1:3000/settings');
    const initial = await handlers.handleGetClipboardPersistence(authorizedEvent);
    assert.equal(initial, false);

    const updated = await handlers.handleSetClipboardPersistence(authorizedEvent, true);
    assert.equal(updated, true);

    // 2. Unauthorized origin rejected
    const untrustedEvent = createMockEvent('https://attacker.evil.com');
    await assert.rejects(async () => handlers.handleGetClipboardPersistence(untrustedEvent), {
      message: /Unauthorized IPC sender origin or frame/,
    });
    await assert.rejects(
      async () => handlers.handleSetClipboardPersistence(untrustedEvent, false),
      { message: /Unauthorized IPC sender origin or frame/ },
    );

    // 3. Child frame / iframe rejected
    const iframeEvent = createMockEvent('http://127.0.0.1:3000/settings', { id: 'child-frame' });
    await assert.rejects(async () => handlers.handleGetClipboardPersistence(iframeEvent), {
      message: /Unauthorized IPC sender origin or frame/,
    });

    // 4. Invalid inputs rejected
    const invalidInputs = ['true', 1, null, undefined, {}, []];
    for (const invalid of invalidInputs) {
      await assert.rejects(
        async () => handlers.handleSetClipboardPersistence(authorizedEvent, invalid),
        { message: /Invalid input: persistence preference must be a boolean/ },
      );
    }

    // 5. Shutdown state rejected
    const shutdownHandlers = createSettingsIpcHandlers({
      policy,
      isAuthorized: () => true,
      isShutdown: () => true,
    });
    await assert.rejects(
      async () => shutdownHandlers.handleGetClipboardPersistence(authorizedEvent),
      { message: /Application is shutting down/ },
    );
  } finally {
    await env.teardown();
  }
});

test('Consent 8 — The renderer receives only the typed boolean preference value', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    const handlers = createSettingsIpcHandlers({
      policy,
      isAuthorized: () => true,
    });

    const event = createMockEvent('http://127.0.0.1:3000');
    const getResult = await handlers.handleGetClipboardPersistence(event);
    assert.equal(typeof getResult, 'boolean');

    const setResult = await handlers.handleSetClipboardPersistence(event, true);
    assert.equal(typeof setResult, 'boolean');
  } finally {
    await env.teardown();
  }
});

test('Consent 9 — UI loading or save failures fail closed and never falsely represent persistence as enabled', async () => {
  // If repository fails, policy returns false (disabled)
  const failingRepo = {
    get: async () => {
      throw new Error('Database locked');
    },
    set: async () => {
      throw new Error('Database locked');
    },
  };
  const policy = createClipboardPersistencePolicy(failingRepo);
  const isEnabled = await policy.isPersistenceEnabled();
  assert.equal(isEnabled, false, 'Loading failure must strictly fail closed to false');

  await assert.rejects(async () => policy.setPersistenceEnabled(true), {
    message: /Database locked/,
  });

  // Preference remains false
  assert.equal(await policy.isPersistenceEnabled(), false);
});

test('Consent 10 — Existing sensitive-content and oversized-payload protections remain intact when enabled', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    const policy = createClipboardPersistencePolicy(env.settingRepo);
    await policy.setPersistenceEnabled(true);

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    // Sensitive item is rejected
    await assert.rejects(
      async () => service.saveTextClip({ text: 'AKIAIOSFODNN7EXAMPLE' }),
      PersistenceSensitiveContentError,
    );

    // Oversized item is rejected
    const oversized = 'x'.repeat(65537);
    await assert.rejects(
      async () => service.saveTextClip({ text: oversized }),
      PersistenceValidationError,
    );

    // Database still has 0 items
    assert.equal(await env.client.clip.count(), 0);
  } finally {
    await env.teardown();
  }
});
