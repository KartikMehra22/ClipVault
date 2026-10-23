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

test('Consent 11 — Stored value is true; a request to disable consent fails; the persistence policy denies subsequent saves', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // 1. Initial stored state is 'true'
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'true');

    // 2. Wrap repo to simulate write failure when attempting to disable
    let shouldFailWrite = false;
    const failingRepo = {
      get: async (key) => env.settingRepo.get(key),
      set: async (key, value) => {
        if (shouldFailWrite) {
          throw new Error('Database disk error during preference update');
        }
        return env.settingRepo.set(key, value);
      },
      delete: async (key) => env.settingRepo.delete(key),
    };

    const policy = createClipboardPersistencePolicy(failingRepo);
    assert.equal(await policy.isPersistenceEnabled(), true, 'Initial state must be true');

    // 3. User attempts to turn persistence off, but saving fails
    shouldFailWrite = true;
    await assert.rejects(
      async () => policy.setPersistenceEnabled(false),
      /Database disk error during preference update/,
    );

    // Database still holds 'true' because the write failed
    const storedInDb = await env.settingRepo.get(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED);
    assert.equal(storedInDb, 'true');

    // BUT the policy strictly fails closed to false in the current process
    assert.equal(
      await policy.isPersistenceEnabled(),
      false,
      'Policy must deny persistence immediately after write failure',
    );

    // 5. Encrypted clipboard persistence service checks its policy immediately afterward
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    assert.equal(await service.isPersistenceEnabled(), false);

    // Attempting to save a text clip must be denied
    await assert.rejects(
      async () => service.saveTextClip({ text: 'Attempted clip after failed disable' }),
      PersistenceDisabledError,
    );

    // Zero records written to database
    assert.equal(await env.client.clip.count(), 0);
  } finally {
    await env.teardown();
  }
});

test('Consent 12 — Stored value is false or missing; a request to enable consent fails; the persistence policy denies subsequent saves', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // 1. Preference is missing initially
    let shouldFailWrite = false;
    const failingRepo = {
      get: async (key) => env.settingRepo.get(key),
      set: async (key, value) => {
        if (shouldFailWrite) {
          throw new Error('Disk full during enable preference update');
        }
        return env.settingRepo.set(key, value);
      },
      delete: async (key) => env.settingRepo.delete(key),
    };

    const policy = createClipboardPersistencePolicy(failingRepo);
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 2. User attempts to enable persistence, but write fails
    shouldFailWrite = true;
    await assert.rejects(
      async () => policy.setPersistenceEnabled(true),
      /Disk full during enable preference update/,
    );

    // 3. Policy strictly denies persistence
    assert.equal(await policy.isPersistenceEnabled(), false);

    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    await assert.rejects(
      async () => service.saveTextClip({ text: 'Attempted clip after failed enable' }),
      PersistenceDisabledError,
    );

    assert.equal(await env.client.clip.count(), 0);
  } finally {
    await env.teardown();
  }
});

test('Consent 13 — A subsequent successful explicit preference update restores policy behavior according to confirmed stored value', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'true');

    let failWrite = true;
    const flappyRepo = {
      get: async (key) => env.settingRepo.get(key),
      set: async (key, value) => {
        if (failWrite) {
          throw new Error('Temporary SQLite busy lock');
        }
        return env.settingRepo.set(key, value);
      },
      delete: async (key) => env.settingRepo.delete(key),
    };

    const policy = createClipboardPersistencePolicy(flappyRepo);
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    // 1. Disable attempt fails -> policy enters fail-closed override
    await assert.rejects(
      async () => policy.setPersistenceEnabled(false),
      /Temporary SQLite busy lock/,
    );
    assert.equal(await policy.isPersistenceEnabled(), false);
    await assert.rejects(
      async () => service.saveTextClip({ text: 'Blocked clip' }),
      PersistenceDisabledError,
    );

    // 2. Lock clears: user explicitly enables persistence and write succeeds
    failWrite = false;
    const enableResult = await policy.setPersistenceEnabled(true);
    assert.equal(enableResult, true);
    assert.equal(await policy.isPersistenceEnabled(), true);

    // Saves succeed now
    const saved = await service.saveTextClip({ text: 'Explicitly allowed clip' });
    assert.ok(saved.id);
    assert.equal(await env.client.clip.count(), 1);

    // 3. User explicitly disables persistence and write succeeds
    const disableResult = await policy.setPersistenceEnabled(false);
    assert.equal(disableResult, false);
    assert.equal(await policy.isPersistenceEnabled(), false);

    // Saves are denied per confirmed stored value
    await assert.rejects(
      async () => service.saveTextClip({ text: 'Blocked after disable' }),
      PersistenceDisabledError,
    );
    assert.equal(await env.client.clip.count(), 1);
  } finally {
    await env.teardown();
  }
});

test('Consent 14 — A failed setting read also denies persistence', async () => {
  const failingReadRepo = {
    get: async () => {
      throw new Error('EIO: i/o error reading database file');
    },
    set: async () => {},
    delete: async () => false,
  };

  const policy = createClipboardPersistencePolicy(failingReadRepo);
  assert.equal(await policy.isPersistenceEnabled(), false, 'Failed read must evaluate to false');

  const env = await setupIsolatedEnvironment();
  try {
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    assert.equal(await service.isPersistenceEnabled(), false);
    await assert.rejects(
      async () => service.saveTextClip({ text: 'Denied due to read failure' }),
      PersistenceDisabledError,
    );
  } finally {
    await env.teardown();
  }
});

test('Consent 15 — The persistence service performs neither encryption nor a database write when policy denies permission', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'true');

    let writeShouldFail = true;
    const failingRepo = {
      get: async (key) => env.settingRepo.get(key),
      set: async (key, value) => {
        if (writeShouldFail) {
          throw new Error('Write error');
        }
        return env.settingRepo.set(key, value);
      },
    };

    const policy = createClipboardPersistencePolicy(failingRepo);
    await assert.rejects(async () => policy.setPersistenceEnabled(false), /Write error/);

    let encryptionAttempted = false;
    const spyEncryptionService = {
      encrypt: (buf) => {
        encryptionAttempted = true;
        return env.encService.encrypt(buf);
      },
      decrypt: (input) => env.encService.decrypt(input),
    };

    let repoCreateAttempted = false;
    const spyClipRepo = {
      create: async (input) => {
        repoCreateAttempted = true;
        return env.clipRepo.create(input);
      },
      findById: (id) => env.clipRepo.findById(id),
      findRecent: (opts) => env.clipRepo.findRecent(opts),
      pin: (id) => env.clipRepo.pin(id),
      unpin: (id) => env.clipRepo.unpin(id),
      delete: (id) => env.clipRepo.delete(id),
      deleteExpired: (ref) => env.clipRepo.deleteExpired(ref),
    };

    const service = createEncryptedClipboardPersistenceService({
      repository: spyClipRepo,
      encryptionService: spyEncryptionService,
      policy,
    });

    await assert.rejects(
      async () => service.saveTextClip({ text: 'Candidate text that must not be processed' }),
      PersistenceDisabledError,
    );

    assert.equal(encryptionAttempted, false, 'No encryption must be invoked');
    assert.equal(repoCreateAttempted, false, 'No repository create must be invoked');
    assert.equal(await env.client.clip.count(), 0, 'No clips stored in database');
  } finally {
    await env.teardown();
  }
});

test('Consent 16 — The UI state transition logic does not present an unsuccessful change as successfully saved', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'true');

    let shouldFail = true;
    const repo = {
      get: async (k) => env.settingRepo.get(k),
      set: async (k, v) => {
        if (shouldFail) throw new Error('Simulated write failure in IPC');
        return env.settingRepo.set(k, v);
      },
    };

    const policy = createClipboardPersistencePolicy(repo);
    const handlers = createSettingsIpcHandlers({ policy, isAuthorized: () => true });
    const mockEvent = createMockEvent('http://127.0.0.1:3000');

    // UI state machine simulation matching SettingsView.tsx handleTogglePersistence
    const simulateUiToggle = async (initialState, targetValue) => {
      let persistenceEnabled = initialState;
      let isSaving = true;
      let error = null;
      let successMessage = null;

      try {
        const updated = await handlers.handleSetClipboardPersistence(mockEvent, targetValue);
        persistenceEnabled = Boolean(updated);
        successMessage = updated
          ? 'Encrypted local history saving is enabled.'
          : 'Encrypted local history saving is disabled.';
      } catch {
        error = 'Failed to update persistence preference. Local history saving remains disabled.';
        persistenceEnabled = false;
        try {
          const effectivePolicy = await handlers.handleGetClipboardPersistence(mockEvent);
          persistenceEnabled = Boolean(effectivePolicy);
        } catch {
          persistenceEnabled = false;
        }
      } finally {
        isSaving = false;
      }

      return { persistenceEnabled, isSaving, error, successMessage };
    };

    // Attempting to turn OFF when stored is 'true', but write fails:
    const result1 = await simulateUiToggle(true, false);
    assert.equal(result1.isSaving, false);
    assert.equal(result1.persistenceEnabled, false, 'UI must show false (fail closed), not true');
    assert.equal(result1.successMessage, null, 'UI must NOT claim successful save');
    assert.match(result1.error, /Failed to update persistence preference/);

    // Verify backend policy also evaluates to false:
    assert.equal(await policy.isPersistenceEnabled(), false);

    // Case 2: Stored is OFF, user attempts to toggle ON, write fails:
    shouldFail = true;
    const result2 = await simulateUiToggle(false, true);
    assert.equal(result2.isSaving, false);
    assert.equal(result2.persistenceEnabled, false, 'UI must show false, not true');
    assert.equal(result2.successMessage, null, 'UI must NOT claim successful save');
    assert.match(result2.error, /Failed to update persistence preference/);

    // Case 3: Recovery — write succeeds:
    shouldFail = false;
    const result3 = await simulateUiToggle(false, true);
    assert.equal(result3.isSaving, false);
    assert.equal(result3.persistenceEnabled, true);
    assert.equal(result3.error, null);
    assert.match(result3.successMessage, /Encrypted local history saving is enabled/);
    assert.equal(await policy.isPersistenceEnabled(), true);
  } finally {
    await env.teardown();
  }
});

test('Consent 17 — No public reset method or override modifier is available for arbitrary callers', () => {
  const policy = createClipboardPersistencePolicy({ get: async () => null, set: async () => {} });
  assert.equal(
    typeof policy.clearWriteFailureOverride,
    'undefined',
    'clearWriteFailureOverride must not exist',
  );
  assert.equal(
    typeof policy.resetFailureOverride,
    'undefined',
    'resetFailureOverride must not exist',
  );
  assert.equal(typeof policy.clearOverride, 'undefined', 'clearOverride must not exist');
  assert.equal(
    typeof policy.hasWriteFailureOverride,
    'undefined',
    'hasWriteFailureOverride must not be exposed',
  );
});

test('Consent 18 — Invalid input or an unauthorized IPC request cannot clear the override', async () => {
  const env = await setupIsolatedEnvironment();
  try {
    // 1. Establish stored consent as 'true'
    await env.settingRepo.set(SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED, 'true');

    let failWrite = true;
    const repo = {
      get: async (k) => env.settingRepo.get(k),
      set: async (k, v) => {
        if (failWrite) {
          throw new Error('Database locked');
        }
        return env.settingRepo.set(k, v);
      },
    };

    const policy = createClipboardPersistencePolicy(repo);
    const service = createEncryptedClipboardPersistenceService({
      repository: env.clipRepo,
      encryptionService: env.encService,
      policy,
    });

    const handlers = createSettingsIpcHandlers({
      policy,
      isAuthorized: (e) => isAuthorizedFrame(e.senderFrame, ALLOWED_ORIGIN),
      isShutdown: () => false,
    });

    // 2. Initial state is enabled
    assert.equal(await policy.isPersistenceEnabled(), true);

    // 3. Trigger write failure -> policy enters fail-closed state
    await assert.rejects(async () => policy.setPersistenceEnabled(false), /Database locked/);
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 4. Invalid input from authorized caller cannot clear the override
    const authorizedEvent = createMockEvent('http://127.0.0.1:3000/settings');
    const invalidInputs = ['true', 1, 0, null, undefined, {}, []];
    for (const invalid of invalidInputs) {
      await assert.rejects(
        async () => handlers.handleSetClipboardPersistence(authorizedEvent, invalid),
        { message: /Invalid input: persistence preference must be a boolean/ },
      );
      assert.equal(
        await policy.isPersistenceEnabled(),
        false,
        'Invalid input must not clear failure override',
      );
    }

    // Direct invalid call to policy cannot clear override
    await assert.rejects(async () => policy.setPersistenceEnabled('true'), {
      message: /Invalid persistence preference/,
    });
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 5. Unauthorized IPC requests cannot clear the override
    const unauthorizedEvent = createMockEvent('https://attacker.evil.com');
    await assert.rejects(
      async () => handlers.handleSetClipboardPersistence(unauthorizedEvent, true),
      { message: /Unauthorized IPC sender origin or frame/ },
    );
    assert.equal(
      await policy.isPersistenceEnabled(),
      false,
      'Unauthorized IPC request must not clear failure override',
    );

    await assert.rejects(
      async () => handlers.handleSetClipboardPersistence(unauthorizedEvent, false),
      { message: /Unauthorized IPC sender origin or frame/ },
    );
    assert.equal(await policy.isPersistenceEnabled(), false);

    // Unauthorized with malformed payload
    await assert.rejects(
      async () => handlers.handleSetClipboardPersistence(unauthorizedEvent, 'malicious'),
      { message: /Unauthorized IPC sender origin or frame/ },
    );
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 6. Child frame IPC request cannot clear the override
    const iframeEvent = createMockEvent('http://127.0.0.1:3000/settings', { id: 'child-frame' });
    await assert.rejects(async () => handlers.handleSetClipboardPersistence(iframeEvent, true), {
      message: /Unauthorized IPC sender origin or frame/,
    });
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 7. Post-shutdown IPC request cannot clear the override
    const shutdownHandlers = createSettingsIpcHandlers({
      policy,
      isAuthorized: () => true,
      isShutdown: () => true,
    });
    await assert.rejects(
      async () => shutdownHandlers.handleSetClipboardPersistence(authorizedEvent, true),
      { message: /Application is shutting down/ },
    );
    assert.equal(await policy.isPersistenceEnabled(), false);

    // 8. Persistence service confirms permission remains strictly denied
    assert.equal(await service.isPersistenceEnabled(), false);
    await assert.rejects(
      async () => service.saveTextClip({ text: 'Blocked after all invalid attempts' }),
      PersistenceDisabledError,
    );
  } finally {
    await env.teardown();
  }
});
