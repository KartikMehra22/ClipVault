import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  createClipRepository,
  createSnippetRepository,
  createAppSettingRepository,
  DatabaseValidationError,
} from '../dist/index.js';
import { createIsolatedTestDatabase } from './setup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devDbPath = path.resolve(__dirname, '..', 'prisma', 'dev.db');

/**
 * SYNTHETIC TEST FIXTURES ONLY.
 *
 * CAUTION: These synthetic byte buffers are non-cryptographic mock fixtures used
 * exclusively to test that the database access layer preserves binary BLOB data
 * faithfully. They are NOT encrypted, secure, or genuine cryptographic outputs.
 */
const MOCK_FIXTURE_PAYLOAD = Buffer.from([0x01, 0x02, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]);
const MOCK_FIXTURE_NONCE = Buffer.from([
  0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
]);
const MOCK_FIXTURE_TAG = Buffer.from([0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7]);

let testDb;
let clipRepo;
let snippetRepo;
let settingRepo;
let devDbInitialMtime = null;

before(async () => {
  // Record initial modification time of dev.db (if it exists) to verify test isolation
  if (fs.existsSync(devDbPath)) {
    devDbInitialMtime = fs.statSync(devDbPath).mtimeMs;
  }

  testDb = await createIsolatedTestDatabase();
  clipRepo = createClipRepository(testDb.prisma);
  snippetRepo = createSnippetRepository(testDb.prisma);
  settingRepo = createAppSettingRepository(testDb.prisma);
});

after(async () => {
  if (testDb) {
    await testDb.cleanup();
  }

  // Ensure dev.db was not modified or destroyed
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
// Factory & Lifecycle Tests
// ============================================================================
test('Database Factory - rejects invalid SQLite URLs', () => {
  assert.throws(
    () => createDatabaseClient({ datasourceUrl: 'postgresql://localhost:5432/db' }),
    /Invalid SQLite datasource URL/,
  );

  assert.throws(() => createDatabaseClient({ datasourceUrl: '' }), /Invalid SQLite datasource URL/);

  assert.throws(
    // @ts-expect-error Testing invalid runtime argument
    () => createDatabaseClient(null),
    /datasourceUrl is required/,
  );
});

// ============================================================================
// Clip Repository Tests
// ============================================================================
test('Clip - create and fetch clip preserving binary payloads', async () => {
  const clip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    encryptionAuthTag: MOCK_FIXTURE_TAG,
    encryptionVersion: 1,
    payloadByteLength: MOCK_FIXTURE_PAYLOAD.byteLength,
    sourceApp: 'com.apple.Terminal',
    isSensitive: false,
  });

  assert.ok(clip.id);
  assert.equal(clip.contentType, 'text/plain');
  assert.equal(clip.payloadByteLength, MOCK_FIXTURE_PAYLOAD.byteLength);
  assert.equal(clip.sourceApp, 'com.apple.Terminal');
  assert.equal(clip.isSensitive, false);
  assert.equal(clip.encryptionVersion, 1);

  // Verify binary fields preserved exactly as binary buffers
  assert.deepEqual(Buffer.from(clip.encryptedPayload), MOCK_FIXTURE_PAYLOAD);
  assert.deepEqual(Buffer.from(clip.encryptionNonce), MOCK_FIXTURE_NONCE);
  assert.deepEqual(Buffer.from(clip.encryptionAuthTag), MOCK_FIXTURE_TAG);

  // Fetch by ID
  const fetched = await clipRepo.findById(clip.id);
  assert.ok(fetched);
  assert.equal(fetched.id, clip.id);
  assert.deepEqual(Buffer.from(fetched.encryptedPayload), MOCK_FIXTURE_PAYLOAD);
});

test('Clip - stable recent ordering with identical timestamps', async () => {
  const fixedDate = new Date('2026-10-21T10:00:00.000Z');

  // Insert multiple clips with the exact same millisecond createdAt
  const clipA = await clipRepo.create({
    id: 'clip-order-1',
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
    createdAt: fixedDate,
  });

  const clipB = await clipRepo.create({
    id: 'clip-order-2',
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
    createdAt: fixedDate,
  });

  const recent = await clipRepo.findRecent({ limit: 10 });
  const ids = recent.map((c) => c.id);

  // Stable secondary sorting by ID descending: 'clip-order-2' should appear before 'clip-order-1'
  const indexB = ids.indexOf(clipB.id);
  const indexA = ids.indexOf(clipA.id);
  assert.ok(indexB !== -1 && indexA !== -1);
  assert.ok(indexB < indexA, 'clip-order-2 should precede clip-order-1 due to stable ID ordering');
});

test('Clip - filter by content type', async () => {
  await clipRepo.create({
    contentType: 'image/png',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 200,
  });

  const images = await clipRepo.findByContentType('image/png', { limit: 10 });
  assert.ok(images.length > 0);
  assert.ok(images.every((c) => c.contentType === 'image/png'));
});

test('Clip - pin and unpin operations', async () => {
  const clip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 20,
  });

  assert.equal(clip.pinnedAt, null);

  const pinDate = new Date('2026-10-21T11:00:00.000Z');
  const pinned = await clipRepo.pin(clip.id, pinDate);
  assert.ok(pinned);
  assert.equal(pinned.pinnedAt?.toISOString(), pinDate.toISOString());

  // List pinned
  const pinnedList = await clipRepo.listPinned({ limit: 10 });
  assert.ok(pinnedList.some((c) => c.id === clip.id));

  // Unpin
  const unpinned = await clipRepo.unpin(clip.id);
  assert.ok(unpinned);
  assert.equal(unpinned.pinnedAt, null);

  // List pinned again
  const afterUnpin = await clipRepo.listPinned({ limit: 10 });
  assert.ok(!afterUnpin.some((c) => c.id === clip.id));
});

test('Clip - delete operation and nonexistent IDs', async () => {
  const clip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
  });

  // Successful deletion
  const deleted = await clipRepo.delete(clip.id);
  assert.equal(deleted, true);

  // Fetching deleted clip returns null
  const fetched = await clipRepo.findById(clip.id);
  assert.equal(fetched, null);

  // Deleting again returns false (record does not exist, does not silently succeed)
  const deletedAgain = await clipRepo.delete(clip.id);
  assert.equal(deletedAgain, false);

  // Pinning nonexistent ID returns null
  const pinMissing = await clipRepo.pin('nonexistent-clip-id');
  assert.equal(pinMissing, null);

  // Unpinning nonexistent ID returns null
  const unpinMissing = await clipRepo.unpin('nonexistent-clip-id');
  assert.equal(unpinMissing, null);

  // findById for nonexistent ID returns null
  const findMissing = await clipRepo.findById('nonexistent-clip-id');
  assert.equal(findMissing, null);
});

test('Clip - delete expired records without deleting unexpired records', async () => {
  const now = new Date('2026-10-21T12:00:00.000Z');
  const pastDate = new Date('2026-10-21T11:00:00.000Z');
  const futureDate = new Date('2026-10-21T13:00:00.000Z');

  // Expired clip
  const expiredClip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
    expiresAt: pastDate,
  });

  // Future unexpired clip
  const futureClip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
    expiresAt: futureDate,
  });

  // Clip without expiration
  const persistentClip = await clipRepo.create({
    contentType: 'text/plain',
    encryptedPayload: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    payloadByteLength: 10,
    expiresAt: null,
  });

  // Run deleteExpired with reference date `now`
  const deletedCount = await clipRepo.deleteExpired(now);
  assert.ok(deletedCount >= 1);

  // Verify expired clip was deleted
  const checkExpired = await clipRepo.findById(expiredClip.id);
  assert.equal(checkExpired, null);

  // Verify future clip was preserved
  const checkFuture = await clipRepo.findById(futureClip.id);
  assert.ok(checkFuture);

  // Verify persistent clip without expiration was preserved
  const checkPersistent = await clipRepo.findById(persistentClip.id);
  assert.ok(checkPersistent);
});

test('Clip - input validations and boundary checks', async () => {
  // Rejects invalid limit
  await assert.rejects(() => clipRepo.findRecent({ limit: 0 }), DatabaseValidationError);
  await assert.rejects(() => clipRepo.findRecent({ limit: 101 }), DatabaseValidationError);
  await assert.rejects(() => clipRepo.findRecent({ limit: -5 }), DatabaseValidationError);

  // Rejects invalid offset
  await assert.rejects(() => clipRepo.findRecent({ offset: -1 }), DatabaseValidationError);

  // Rejects empty or invalid IDs
  await assert.rejects(() => clipRepo.findById('   '), DatabaseValidationError);
  await assert.rejects(() => clipRepo.delete(''), DatabaseValidationError);

  // Rejects plaintext strings as payload (boundary enforcement)
  await assert.rejects(
    // @ts-expect-error Testing invalid runtime string payload
    () =>
      clipRepo.create({
        contentType: 'text/plain',
        encryptedPayload: 'plaintext-should-fail',
        encryptionNonce: MOCK_FIXTURE_NONCE,
        payloadByteLength: 10,
      }),
    /must be binary data/,
  );

  // Rejects empty payload buffer
  await assert.rejects(
    () =>
      clipRepo.create({
        contentType: 'text/plain',
        encryptedPayload: Buffer.alloc(0),
        encryptionNonce: MOCK_FIXTURE_NONCE,
        payloadByteLength: 10,
      }),
    /cannot be empty/,
  );
});

// ============================================================================
// Snippet Repository Tests
// ============================================================================
test('Snippet - create, fetch, update, and delete', async () => {
  const snippet = await snippetRepo.create({
    title: 'TypeScript Helper',
    description: 'Utility for date formatting',
    language: 'typescript',
    encryptedContent: MOCK_FIXTURE_PAYLOAD,
    encryptionNonce: MOCK_FIXTURE_NONCE,
    encryptionAuthTag: MOCK_FIXTURE_TAG,
    encryptionVersion: 1,
  });

  assert.ok(snippet.id);
  assert.equal(snippet.title, 'TypeScript Helper');
  assert.equal(snippet.description, 'Utility for date formatting');
  assert.equal(snippet.language, 'typescript');
  assert.deepEqual(Buffer.from(snippet.encryptedContent), MOCK_FIXTURE_PAYLOAD);
  assert.deepEqual(Buffer.from(snippet.encryptionNonce), MOCK_FIXTURE_NONCE);
  assert.deepEqual(Buffer.from(snippet.encryptionAuthTag), MOCK_FIXTURE_TAG);

  // Fetch
  const fetched = await snippetRepo.findById(snippet.id);
  assert.ok(fetched);
  assert.equal(fetched.id, snippet.id);

  // Update permitted fields
  const NEW_MOCK_PAYLOAD = Buffer.from([0x99, 0x88, 0x77]);
  const updated = await snippetRepo.update(snippet.id, {
    title: 'Updated TypeScript Helper',
    description: 'Updated description',
    encryptedContent: NEW_MOCK_PAYLOAD,
  });

  assert.ok(updated);
  assert.equal(updated.title, 'Updated TypeScript Helper');
  assert.equal(updated.description, 'Updated description');
  assert.deepEqual(Buffer.from(updated.encryptedContent), NEW_MOCK_PAYLOAD);

  // List with language filter
  const list = await snippetRepo.list({ language: 'typescript' });
  assert.ok(list.length > 0);
  assert.ok(list.some((s) => s.id === snippet.id));

  // Delete
  const deleted = await snippetRepo.delete(snippet.id);
  assert.equal(deleted, true);

  // Verify deletion
  const checkDeleted = await snippetRepo.findById(snippet.id);
  assert.equal(checkDeleted, null);

  // Deleting again returns false
  const deletedAgain = await snippetRepo.delete(snippet.id);
  assert.equal(deletedAgain, false);

  // Updating nonexistent ID returns null
  const updateMissing = await snippetRepo.update('nonexistent-id', { title: 'New' });
  assert.equal(updateMissing, null);
});

test('Snippet - input validations', async () => {
  // Empty title rejected
  await assert.rejects(
    () =>
      snippetRepo.create({
        title: '   ',
        encryptedContent: MOCK_FIXTURE_PAYLOAD,
        encryptionNonce: MOCK_FIXTURE_NONCE,
      }),
    /Snippet title must be a non-empty string/,
  );

  // Empty update rejected
  await assert.rejects(
    () => snippetRepo.update('some-id', {}),
    /At least one field must be supplied/,
  );
});

// ============================================================================
// AppSetting Repository Tests
// ============================================================================
test('AppSetting - read missing, create, update, and delete', async () => {
  // Read missing returns null
  const missing = await settingRepo.get('preferences.theme');
  assert.equal(missing, null);

  // Set / create
  const created = await settingRepo.set('preferences.theme', 'dark');
  assert.equal(created.key, 'preferences.theme');
  assert.equal(created.value, 'dark');

  // Read back
  const readBack = await settingRepo.get('preferences.theme');
  assert.equal(readBack, 'dark');

  // Update existing
  const updated = await settingRepo.set('preferences.theme', 'system');
  assert.equal(updated.value, 'system');

  const readUpdated = await settingRepo.get('preferences.theme');
  assert.equal(readUpdated, 'system');

  // Delete setting
  const deleted = await settingRepo.delete('preferences.theme');
  assert.equal(deleted, true);

  // Read deleted returns null
  const readAfterDelete = await settingRepo.get('preferences.theme');
  assert.equal(readAfterDelete, null);

  // Deleting again returns false
  const deleteAgain = await settingRepo.delete('preferences.theme');
  assert.equal(deleteAgain, false);
});

test('AppSetting - validates keys and rejects sensitive credentials', async () => {
  // Rejects forbidden secret-like keys
  await assert.rejects(() => settingRepo.set('app.master_key', 'some-value'), /prohibited/);

  await assert.rejects(() => settingRepo.set('auth_token', 'jwt-token-string'), /prohibited/);

  await assert.rejects(() => settingRepo.set('user.password', 'p@ssword'), /prohibited/);

  await assert.rejects(() => settingRepo.set('encryption_key', '0123456789abcdef'), /prohibited/);

  // Rejects keys with invalid special characters
  await assert.rejects(() => settingRepo.set('bad key with spaces!', 'val'), /invalid characters/);

  // Rejects oversized values (> 32KB)
  const oversizedValue = 'a'.repeat(32769);
  await assert.rejects(
    () => settingRepo.set('preferences.large', oversizedValue),
    /exceeds maximum permitted size/,
  );
});
