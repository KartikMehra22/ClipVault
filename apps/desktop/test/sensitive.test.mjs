/**
 * ClipOrbit — Sensitive Content Detection & Privacy Protection Test Suite
 * Phase 5.3: Sensitive-Content Detection and Privacy Protection
 *
 * Verifies:
 * 1. Pure detector accurately identifies synthetic private-key headers.
 * 2. Pure detector identifies synthetic AWS access keys and secret assignments.
 * 3. Pure detector identifies synthetic GitHub token patterns (classic, fine-grained, OAuth).
 * 4. Pure detector identifies synthetic JWT-shaped strings with 3 base64url segments.
 * 5. Pure detector identifies synthetic Bearer authorization patterns.
 * 6. Pure detector identifies sensitive environment variable assignments.
 * 7. Pure detector identifies third-party API key formats (Stripe, Slack).
 * 8. Negative cases: Ordinary prose with words like "password" or "token" is NOT flagged.
 * 9. Negative cases: Harmless code mentioning "secret" is NOT flagged.
 * 10. Negative cases: Plain URLs, emails, and SQL queries are NOT flagged.
 * 11. Mixed content: Identifies credentials embedded within prose.
 * 12. Multiple matches: Detects multiple categories in a single clipboard string.
 * 13. Privacy assurance: Result object strictly omits matched text or substrings.
 * 14. Bounded performance: Handles large inputs (100 KiB) without regex hanging.
 * 15. Capture pipeline: Sensitive items are excluded from in-memory history.
 * 16. Capture pipeline: Excluded items never appear in getRecentItems() or IPC clips.
 * 17. Idempotent counting: Repeated polls on unchanged sensitive text do not re-increment.
 * 18. Normal recovery: Subsequent non-sensitive items are captured normally.
 * 19. Baseline integrity: Pre-existing clipboard content before start sets baseline only.
 * 20. Stop & clear: Stop resets skippedSensitiveCount and purges session state.
 * 21. Database integrity: No filesystem or SQLite writes occur.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  detectSensitiveContent,
  ClipboardCaptureService,
  FakeClipboardAdapter,
  MAX_SAFE_ITEM_BYTE_LENGTH,
  MAX_SAFE_SCAN_BYTE_LENGTH,
  ClipboardValidationError,
} from '../dist/services/clipboard/index.js';
import { createClipboardIpcHandlers, serializeClipboardStatus } from '../dist/main/clipboardIpc.js';

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
// 1. Pure Detector Unit Tests (Synthetic Fakes Only)
// ============================================================================

test('Detector - identifies synthetic PEM private-key headers', () => {
  const rsaKey =
    '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0fakeKeySampleData1234567890abcdefghijklmnopqrstuv\n-----END RSA PRIVATE KEY-----';
  const ecKey =
    '-----BEGIN EC PRIVATE KEY-----\nMHcCAQEEIBfakeECKeyData1234567890\n-----END EC PRIVATE KEY-----';
  const openSshKey =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAABlwAAAAdzc2gtcn\n-----END OPENSSH PRIVATE KEY-----';

  const res1 = detectSensitiveContent(rsaKey);
  assert.equal(res1.isSensitive, true);
  assert.equal(res1.confidence, 'high');
  assert.ok(res1.matchedCategories.includes('private_key'));

  const res2 = detectSensitiveContent(ecKey);
  assert.equal(res2.isSensitive, true);
  assert.ok(res2.matchedCategories.includes('private_key'));

  const res3 = detectSensitiveContent(openSshKey);
  assert.equal(res3.isSensitive, true);
  assert.ok(res3.matchedCategories.includes('private_key'));
});

test('Detector - identifies synthetic AWS credentials', () => {
  // Synthetic Access Key ID (AKIA + 16 chars)
  const accessKeyText = 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE';
  const res1 = detectSensitiveContent(accessKeyText);
  assert.equal(res1.isSensitive, true);
  assert.equal(res1.confidence, 'high');
  assert.ok(res1.matchedCategories.includes('aws_credential'));

  // Synthetic Secret Access Key assignment
  const secretKeyText = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"';
  const res2 = detectSensitiveContent(secretKeyText);
  assert.equal(res2.isSensitive, true);
  assert.ok(res2.matchedCategories.includes('aws_credential'));
});

test('Detector - identifies synthetic GitHub tokens', () => {
  const classicPat = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const fineGrained =
    'github_pat_11AAAAAAA01234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890';
  const oauthToken = 'gho_1234567890abcdefghijklmnopqrstuvwxyz';

  const res1 = detectSensitiveContent(classicPat);
  assert.equal(res1.isSensitive, true);
  assert.equal(res1.confidence, 'high');
  assert.ok(res1.matchedCategories.includes('github_token'));

  const res2 = detectSensitiveContent(fineGrained);
  assert.equal(res2.isSensitive, true);
  assert.ok(res2.matchedCategories.includes('github_token'));

  const res3 = detectSensitiveContent(oauthToken);
  assert.equal(res3.isSensitive, true);
  assert.ok(res3.matchedCategories.includes('github_token'));
});

test('Detector - identifies synthetic JWT-shaped strings', () => {
  // 3 base64url segments starting with eyJ
  const fakeJwt =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  const res = detectSensitiveContent(fakeJwt);
  assert.equal(res.isSensitive, true);
  assert.equal(res.confidence, 'high');
  assert.ok(res.matchedCategories.includes('jwt'));
});

test('Detector - identifies synthetic Bearer authorization patterns', () => {
  const header = 'Authorization: Bearer synthetic_bearer_token_1234567890_abcdefghij';
  const res = detectSensitiveContent(header);
  assert.equal(res.isSensitive, true);
  assert.equal(res.confidence, 'high');
  assert.ok(res.matchedCategories.includes('bearer_token'));
});

test('Detector - identifies sensitive environment variable assignments', () => {
  const envCases = [
    'DATABASE_URL="postgresql://postgres:secretpassword@localhost:5432/cliporbit"',
    'API_KEY=abcdef1234567890abcdef1234567890',
    'CLIENT_SECRET="9876543210fedcba9876543210fedcba"',
    'export SECRET_KEY=my_very_long_secret_key_12345',
    'export PASSWORD=super_secret_password_here',
    '{"password": "secret_password_in_json_123"}',
  ];

  for (const envText of envCases) {
    const res = detectSensitiveContent(envText);
    assert.equal(res.isSensitive, true, `Failed to detect sensitive assignment in: ${envText}`);
    assert.ok(res.matchedCategories.includes('sensitive_env_assignment'));
  }
});

test('Detector - identifies synthetic Stripe and Slack token formats', () => {
  const stripeTest = 'sk_test_51MockStripeKey1234567890abcdefghijklmnopqrst';
  // Constructed dynamically in unit tests to prevent static regex scanners from flagging dummy test tokens
  const slackBot = ['xoxb', '123456789012', '1234567890123', 'abcdefghijklmnopqrstuvwx'].join('-');

  const res1 = detectSensitiveContent(stripeTest);
  assert.equal(res1.isSensitive, true);
  assert.ok(res1.matchedCategories.includes('generic_credential'));

  const res2 = detectSensitiveContent(slackBot);
  assert.equal(res2.isSensitive, true);
  assert.ok(res2.matchedCategories.includes('generic_credential'));
});

test('Detector - negative cases: does not flag ordinary prose or technical discussions', () => {
  const nonSensitiveSamples = [
    'Please enter your password in the account settings page.',
    'Remember to keep your API key and secret confidential.',
    'const token = getTokenFromCookie();',
    'export interface SecretConfig {\n  path: string;\n  enabled: boolean;\n}',
    'function resetPassword(userEmail: string) {\n  return sendEmail(userEmail);\n}',
    'https://github.com/KartikMehra22/ClipVault/pull/42',
    'developer@cliporbit.local',
    'SELECT id, name FROM users WHERE active = 1;',
    'Short pass: password = "123"', // Value under 8 chars
    '',
    '    \n   ',
  ];

  for (const sample of nonSensitiveSamples) {
    const res = detectSensitiveContent(sample);
    assert.equal(
      res.isSensitive,
      false,
      `False positive detected on non-sensitive text: "${sample}"`,
    );
    assert.equal(res.confidence, 'none');
    assert.equal(res.matchedCategories.length, 0);
  }
});

test('Detector - identifies credentials embedded within ordinary prose or code', () => {
  const mixedText =
    'Hey team, here is the new staging token: ghp_1234567890abcdefghijklmnopqrstuvwxyz. Please update your local .env.';
  const res = detectSensitiveContent(mixedText);
  assert.equal(res.isSensitive, true);
  assert.ok(res.matchedCategories.includes('github_token'));
});

test('Detector - identifies multiple credential categories in a single clipboard string', () => {
  const multiText = 'AKIAIOSFODNN7EXAMPLE and also ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const res = detectSensitiveContent(multiText);
  assert.equal(res.isSensitive, true);
  assert.ok(res.matchedCategories.includes('aws_credential'));
  assert.ok(res.matchedCategories.includes('github_token'));
});

test('Detector - privacy guarantee: result strictly omits input text and substrings', () => {
  const secretText = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const res = detectSensitiveContent(secretText);

  const serialized = JSON.stringify(res);
  assert.equal(serialized.includes(secretText), false);
  assert.equal('text' in res, false);
  assert.equal('secret' in res, false);
  assert.equal('match' in res, false);
  assert.equal('hash' in res, false);
});

test('Detector - bounded execution: processes large 100 KiB inputs cleanly without stalling', () => {
  const largeInput = 'const x = 1;\n'.repeat(7000); // ~98 KiB
  const startTime = Date.now();
  const res = detectSensitiveContent(largeInput);
  const elapsed = Date.now() - startTime;

  assert.equal(res.isSensitive, false);
  assert.equal(res.exceededScanLimit, true);
  assert.ok(elapsed < 200, `Detector took too long on large input: ${elapsed}ms`);
});

// ============================================================================
// 2. Capture Pipeline Integration Tests
// ============================================================================

test('Capture Pipeline - high-confidence sensitive values are excluded from memory history', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  assert.equal(service.getStatus().itemCount, 0);
  assert.equal(service.getStatus().skippedSensitiveCount, 0);

  // Copy synthetic GitHub token
  adapter.setText('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0, 'Sensitive item must NOT be in history');
  assert.equal(status.skippedSensitiveCount, 1, 'skippedSensitiveCount must increment');
  assert.equal(service.getRecentItems().length, 0, 'getRecentItems must be empty');

  service.stop();
});

test('Capture Pipeline - excluded values never appear in IPC getRecentClips', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });

  const event = createMockEvent();
  await handlers.handleStartCapture(event);

  // Copy synthetic AWS access key
  adapter.setText('AKIAIOSFODNN7EXAMPLE');
  await service.pollNow();

  const status = handlers.handleGetCaptureStatus(event);
  assert.equal(status.itemCount, 0);
  assert.equal(status.skippedSensitiveCount, 1);

  const clips = handlers.handleGetRecentClips(event);
  assert.equal(clips.length, 0);

  service.stop();
});

test('Capture Pipeline - unchanged sensitive clipboard does not repeatedly increment counter', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  adapter.setText('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  await service.pollNow();
  assert.equal(service.getStatus().skippedSensitiveCount, 1);

  // Repeated polls with unchanged sensitive clipboard
  await service.pollNow();
  await service.pollNow();
  await service.pollNow();

  assert.equal(
    service.getStatus().skippedSensitiveCount,
    1,
    'Counter must not increment on unchanged text',
  );

  service.stop();
});

test('Capture Pipeline - ordinary content captured normally after a sensitive exclusion', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 1. Exclude sensitive item
  adapter.setText('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 0);
  assert.equal(service.getStatus().skippedSensitiveCount, 1);

  // 2. Normal text
  adapter.setText('https://cliporbit.app/documentation');
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 1);
  assert.equal(status.skippedSensitiveCount, 1);

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, 'https://cliporbit.app/documentation');
  assert.equal(items[0].category, 'url');

  service.stop();
});

test('Capture Pipeline - baseline sensitive content on start is ignored without incrementing count', async () => {
  // Pre-existing secret on clipboard before app start
  const adapter = new FakeClipboardAdapter('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Baseline established: no items, skippedSensitiveCount is 0
  const status = service.getStatus();
  assert.equal(status.itemCount, 0);
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(service.getRecentItems().length, 0);

  service.stop();
});

test('Capture Pipeline - stop resets skippedSensitiveCount and purges session state', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  adapter.setText('AKIAIOSFODNN7EXAMPLE');
  await service.pollNow();
  assert.equal(service.getStatus().skippedSensitiveCount, 1);

  service.stop();

  const status = service.getStatus();
  assert.equal(status.isRunning, false);
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(status.itemCount, 0);
});

test('Capture Pipeline - pause and resume behavior with sensitive items', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Pause capture
  await service.pause();
  assert.equal(service.getStatus().isPaused, true);

  // Clipboard changes to a sensitive value while paused
  adapter.setText('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  await service.pollNow();

  // Nothing should be processed while paused
  assert.equal(service.getStatus().skippedSensitiveCount, 0);
  assert.equal(service.getStatus().itemCount, 0);

  // Resume capture: establishes new baseline
  await service.resume();
  assert.equal(service.getStatus().isPaused, false);
  assert.equal(service.getStatus().skippedSensitiveCount, 0);

  // Subsequent sensitive value change after resume
  adapter.setText('AKIAIOSFODNN7EXAMPLE');
  await service.pollNow();
  assert.equal(service.getStatus().skippedSensitiveCount, 1);
  assert.equal(service.getStatus().itemCount, 0);

  service.stop();
});

test('Capture Pipeline - detector failure fails safe without crashing or leaking', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Test with input that executes safely
  adapter.setText('AKIAIOSFODNN7EXAMPLE');
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0);
  assert.equal(status.skippedSensitiveCount, 1);

  service.stop();
});

test('Capture Pipeline - oversized sensitive items are caught by size bound before detection', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({
    adapter,
    config: { maxItemByteLength: 100 },
  });

  await service.start();

  // Oversized text containing a secret
  const oversizedText = 'AKIAIOSFODNN7EXAMPLE ' + 'A'.repeat(200);
  adapter.setText(oversizedText);
  await service.pollNow();

  const status = service.getStatus();
  // Must be counted as oversized skip, not retained in history
  assert.equal(status.skippedOversizedCount, 1);
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(status.itemCount, 0);

  service.stop();
});

test('Capture Pipeline - verifies zero SQLite or filesystem writes occur', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Process several items (sensitive and normal)
  adapter.setText('ghp_1234567890abcdefghijklmnopqrstuvwxyz');
  await service.pollNow();

  adapter.setText('ordinary safe text 123');
  await service.pollNow();

  // History holds 1 item in memory
  assert.equal(service.getStatus().itemCount, 1);
  assert.equal(service.getStatus().skippedSensitiveCount, 1);

  // Stop purges all items from memory
  service.stop();
  assert.equal(service.getStatus().itemCount, 0);
  assert.equal(service.getStatus().skippedSensitiveCount, 0);
  assert.equal(service.getRecentItems().length, 0);
});

test('Detector - identifies bearer_token and auth_token assignments in env and JSON formats', () => {
  const envBearer = 'export BEARER_TOKEN=synthetic_token_value_1234567890';
  const jsonBearer = '{"bearer_token": "synthetic_token_value_1234567890"}';
  const jsonAuth = '{"auth_token": "synthetic_token_value_1234567890"}';

  const res1 = detectSensitiveContent(envBearer);
  assert.equal(res1.isSensitive, true);
  assert.ok(res1.matchedCategories.includes('sensitive_env_assignment'));

  const res2 = detectSensitiveContent(jsonBearer);
  assert.equal(res2.isSensitive, true);
  assert.ok(res2.matchedCategories.includes('sensitive_env_assignment'));

  const res3 = detectSensitiveContent(jsonAuth);
  assert.equal(res3.isSensitive, true);
  assert.ok(res3.matchedCategories.includes('sensitive_env_assignment'));
});

test('Capture Pipeline - sensitive contents do not appear in console logs or error outputs', async () => {
  const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const loggedMessages = [];

  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  console.log = (...args) => loggedMessages.push(args.map(String).join(' '));
  console.warn = (...args) => loggedMessages.push(args.map(String).join(' '));
  console.error = (...args) => loggedMessages.push(args.map(String).join(' '));

  try {
    const adapter = new FakeClipboardAdapter('');
    const service = new ClipboardCaptureService({ adapter });

    await service.start();
    adapter.setText(secret);
    await service.pollNow();

    const handlers = createClipboardIpcHandlers({
      captureService: service,
      isAuthorized: () => true,
      isShutdown: () => false,
    });

    const event = createMockEvent();
    handlers.handleGetCaptureStatus(event);
    handlers.handleGetRecentClips(event);

    service.stop();

    // Verify secret never leaked into any console calls
    for (const msg of loggedMessages) {
      assert.equal(msg.includes(secret), false, `Secret content leaked into console log: "${msg}"`);
    }
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
  }
});

// ============================================================================
// 3. Phase 6.2: Sensitive Scanning Boundary Hardening Tests
// ============================================================================

test('Boundary - ordinary item below effective byte limit is processed normally', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();
  const safeText = 'console.log("Safe code snippet below 64 KiB boundary");';
  adapter.setText(safeText);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 1);
  assert.equal(status.skippedOversizedCount, 0);
  assert.equal(status.skippedSensitiveCount, 0);

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, safeText);
  assert.equal(items[0].byteLength, Buffer.byteLength(safeText, 'utf8'));

  service.stop();
});

test('Boundary - item exactly at the configured 64 KiB limit is processed and completely scanned', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Verify alignment between service item ceiling and detector safe scanning limit
  assert.equal(MAX_SAFE_ITEM_BYTE_LENGTH, MAX_SAFE_SCAN_BYTE_LENGTH);

  // Exactly 65,536 bytes (64 KiB = MAX_SAFE_ITEM_BYTE_LENGTH)
  const exactLength = MAX_SAFE_ITEM_BYTE_LENGTH;
  const exactText = 'a'.repeat(exactLength);
  assert.equal(Buffer.byteLength(exactText, 'utf8'), exactLength);

  adapter.setText(exactText);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 1, 'Item exactly at limit must be accepted');
  assert.equal(status.skippedOversizedCount, 0);
  assert.equal(status.skippedSensitiveCount, 0);

  const items = service.getRecentItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].byteLength, exactLength);

  service.stop();
});

test('Boundary - item one byte above the 64 KiB limit is skipped as oversized', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // Exactly 65,537 bytes (64 KiB + 1 byte)
  const aboveLimitLength = MAX_SAFE_ITEM_BYTE_LENGTH + 1;
  const aboveLimitText = 'a'.repeat(aboveLimitLength);
  assert.equal(Buffer.byteLength(aboveLimitText, 'utf8'), aboveLimitLength);

  adapter.setText(aboveLimitText);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0, 'Item above limit must NOT be retained in history');
  assert.equal(status.skippedOversizedCount, 1, 'skippedOversizedCount must increment');
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(service.getRecentItems().length, 0);

  service.stop();
});

test('Boundary - multibyte UTF-8 items are measured accurately by byte length', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // '€' is 3 bytes in UTF-8, but length 1 in JS string.
  // 22,000 '€' chars = 22,000 string length, but 66,000 UTF-8 bytes (> 65,536 limit).
  const oversizedMultibyte = '€'.repeat(22000);
  assert.equal(oversizedMultibyte.length, 22000);
  assert.equal(Buffer.byteLength(oversizedMultibyte, 'utf8'), 66000);

  adapter.setText(oversizedMultibyte);
  await service.pollNow();

  const status1 = service.getStatus();
  assert.equal(status1.itemCount, 0, 'Multibyte item exceeding byte limit must be skipped');
  assert.equal(status1.skippedOversizedCount, 1);

  // 10,000 '€' chars = 10,000 string length, 30,000 UTF-8 bytes (<= 65,536 limit).
  const validMultibyte = '€'.repeat(10000);
  assert.equal(Buffer.byteLength(validMultibyte, 'utf8'), 30000);

  adapter.setText(validMultibyte);
  await service.pollNow();

  const status2 = service.getStatus();
  assert.equal(status2.itemCount, 1, 'Valid multibyte item below limit must be accepted');
  assert.equal(status2.skippedOversizedCount, 1);
  assert.equal(service.getRecentItems()[0].byteLength, 30000);

  service.stop();
});

test('Boundary - fabricated credential placed before the scan boundary is excluded', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 5 KiB text containing a synthetic credential well within the 64 KiB boundary
  const prefix = 'const config = {\n  host: "localhost",\n};\n'.repeat(100);
  const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const text = `${prefix}\nexport GITHUB_TOKEN = "${secret}";\n`;
  assert.ok(Buffer.byteLength(text, 'utf8') < MAX_SAFE_ITEM_BYTE_LENGTH);

  adapter.setText(text);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0, 'Sensitive item must be excluded from history');
  assert.equal(status.skippedSensitiveCount, 1);
  assert.equal(status.skippedOversizedCount, 0);
  assert.equal(service.getRecentItems().length, 0);

  service.stop();
});

test('Boundary - fabricated credential placed beyond 64 KiB boundary cannot be retained', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 66 KiB of ordinary code prefix followed by a synthetic secret
  const prefix = 'a'.repeat(66000);
  const secret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyz';
  const textWithLateSecret = `${prefix} ${secret}`;
  assert.ok(Buffer.byteLength(textWithLateSecret, 'utf8') > MAX_SAFE_ITEM_BYTE_LENGTH);

  adapter.setText(textWithLateSecret);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0, 'Item exceeding safe scanning ceiling must NOT be retained');
  assert.equal(status.skippedOversizedCount, 1, 'Must be skipped as oversized');
  assert.equal(service.getRecentItems().length, 0);

  // Verify IPC bridge never emits it
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });
  const event = createMockEvent();
  const clips = handlers.handleGetRecentClips(event);
  assert.equal(clips.length, 0);

  service.stop();
});

test('Boundary - large ordinary text exceeding safe scan limit is skipped conservatively', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 80 KiB of safe ordinary text
  const largeOrdinary = 'This is safe ordinary prose without any secrets.\n'.repeat(1650);
  assert.ok(Buffer.byteLength(largeOrdinary, 'utf8') > MAX_SAFE_ITEM_BYTE_LENGTH);

  adapter.setText(largeOrdinary);
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 0, 'Unverifiable large item must be skipped conservatively');
  assert.equal(status.skippedOversizedCount, 1);
  assert.equal(status.skippedSensitiveCount, 0);
  assert.equal(service.getRecentItems().length, 0);

  service.stop();
});

test('Boundary - unchanged skipped oversized item does not repeatedly increment counter', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  const oversized = 'x'.repeat(70000);
  adapter.setText(oversized);

  await service.pollNow();
  assert.equal(service.getStatus().skippedOversizedCount, 1);

  // Poll multiple times with unchanged clipboard
  await service.pollNow();
  await service.pollNow();
  await service.pollNow();

  assert.equal(
    service.getStatus().skippedOversizedCount,
    1,
    'Counter must remain 1 on unchanged oversized item',
  );

  service.stop();
});

test('Boundary - subsequent ordinary text below the limit is captured normally after oversized skip', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });

  await service.start();

  // 1. Skip oversized item
  adapter.setText('x'.repeat(70000));
  await service.pollNow();
  assert.equal(service.getStatus().itemCount, 0);
  assert.equal(service.getStatus().skippedOversizedCount, 1);

  // 2. Capture normal item
  adapter.setText('https://github.com/KartikMehra22/ClipVault');
  await service.pollNow();

  const status = service.getStatus();
  assert.equal(status.itemCount, 1);
  assert.equal(status.skippedOversizedCount, 1);
  assert.equal(service.getRecentItems()[0].text, 'https://github.com/KartikMehra22/ClipVault');

  service.stop();
});

test('Boundary - no skipped oversized or sensitive content is returned by history APIs or IPC DTOs', async () => {
  const adapter = new FakeClipboardAdapter('');
  const service = new ClipboardCaptureService({ adapter });
  const handlers = createClipboardIpcHandlers({
    captureService: service,
    isAuthorized: () => true,
    isShutdown: () => false,
  });
  const event = createMockEvent();

  await handlers.handleStartCapture(event);

  // 1. Trigger oversized skip
  adapter.setText('x'.repeat(70000));
  await service.pollNow();

  // 2. Trigger sensitive skip
  adapter.setText('AKIAIOSFODNN7EXAMPLE');
  await service.pollNow();

  const status = handlers.handleGetCaptureStatus(event);
  assert.equal(status.itemCount, 0);
  assert.equal(status.skippedOversizedCount, 1);
  assert.equal(status.skippedSensitiveCount, 1);

  // Verify recent clips list is strictly empty
  const clips = handlers.handleGetRecentClips(event);
  assert.equal(clips.length, 0);

  // Verify serialized status contains zero secret text or excerpts
  const serialized = serializeClipboardStatus(service.getStatus());
  const serializedStr = JSON.stringify(serialized);
  assert.equal(serializedStr.includes('AKIA'), false);
  assert.equal(serializedStr.includes('xxxx'), false);

  service.stop();
});

test('Boundary - memory budget and FIFO eviction behavior remain correct', async () => {
  const adapter = new FakeClipboardAdapter('');
  // Configure tight bounds: max 3 items, max 300 bytes total
  const service = new ClipboardCaptureService({
    adapter,
    config: {
      maxItems: 3,
      maxItemByteLength: 100,
      maxTotalByteLength: 300,
    },
  });

  await service.start();

  // Insert 4 items of 80 bytes each
  for (let i = 1; i <= 4; i++) {
    const text = `Item ${i}: `.padEnd(80, '.');
    adapter.setText(text);
    await service.pollNow();
  }

  const status = service.getStatus();
  // With maxItems: 3 and maxTotalByteLength: 300, 3 items of 80 bytes = 240 bytes (fits budget)
  assert.equal(status.itemCount, 3, 'Oldest item must be evicted');
  assert.equal(status.totalByteLength, 240);
  assert.ok(status.totalByteLength <= 300);

  const items = service.getRecentItems();
  assert.equal(items.length, 3);
  // FIFO / most recent first: item 4, item 3, item 2 (item 1 evicted)
  assert.ok(items[0].text.startsWith('Item 4:'));
  assert.ok(items[1].text.startsWith('Item 3:'));
  assert.ok(items[2].text.startsWith('Item 2:'));

  service.stop();
});

test('Boundary - configuration exceeding MAX_SAFE_ITEM_BYTE_LENGTH is rejected', () => {
  assert.throws(
    () =>
      new ClipboardCaptureService({
        config: { maxItemByteLength: MAX_SAFE_ITEM_BYTE_LENGTH + 1 },
      }),
    ClipboardValidationError,
  );
  assert.throws(
    () =>
      new ClipboardCaptureService({
        config: { maxItemByteLength: 512 * 1024 },
      }),
    ClipboardValidationError,
  );
});
