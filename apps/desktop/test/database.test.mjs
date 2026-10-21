import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveDatabasePaths,
  resolvePrismaAssets,
  applyMigrations,
  initializeDatabase,
  getDatabaseClient,
  getDatabasePaths,
  closeDatabase,
  DatabaseMigrationError,
} from '../dist/services/database.js';
import { createClipRepository, createAppSettingRepository } from '@cliporbit/database';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootRepoDir = path.resolve(__dirname, '../../..');
const devDbPath = path.resolve(rootRepoDir, 'packages/database/prisma/dev.db');

let devDbInitialMtime = null;
let devDbInitialSize = null;
const tempDirsToCleanup = [];

function createTempDir(prefix = 'cliporbit-runtime-test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirsToCleanup.push(dir);
  return dir;
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

  // Verification that development database was not modified or destroyed
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
// 1. Path resolution tests
// ============================================================================
test('resolveDatabasePaths - resolves paths outside repository source directories', () => {
  const tmpDir = createTempDir('cliporbit-paths-');
  const paths = resolveDatabasePaths(tmpDir);

  // 1. Must be inside the supplied userData directory
  assert.ok(paths.userDataDir.startsWith(tmpDir));
  assert.ok(paths.dataDir.startsWith(tmpDir));
  assert.ok(paths.dbFilePath.startsWith(tmpDir));

  // 2. Must be strictly outside repository source tree
  assert.ok(!paths.dbFilePath.startsWith(path.join(rootRepoDir, 'apps/desktop/src')));
  assert.ok(!paths.dbFilePath.startsWith(path.join(rootRepoDir, 'apps/desktop/dist')));
  assert.ok(!paths.dbFilePath.startsWith(path.join(rootRepoDir, 'packages/database/prisma')));

  // 3. Dedicated subpath structure: <userData>/data/cliporbit.sqlite
  assert.equal(paths.dataDir, path.join(tmpDir, 'data'));
  assert.equal(paths.dbFilePath, path.join(tmpDir, 'data', 'cliporbit.sqlite'));
});

test('resolveDatabasePaths - derives datasource URL matching SQLite file format', () => {
  const tmpDir = createTempDir('cliporbit-url-');
  const paths = resolveDatabasePaths(tmpDir);

  assert.ok(paths.datasourceUrl.startsWith('file:'));
  const urlPath = paths.datasourceUrl.slice('file:'.length);
  assert.equal(urlPath, paths.dbFilePath.replace(/\\/g, '/'));
});

test('resolveDatabasePaths - throws clear error if userData is empty or missing outside Electron', () => {
  assert.throws(() => resolveDatabasePaths(''), /userData directory is undefined or empty/);
  assert.throws(() => resolveDatabasePaths('   '), /userData directory is undefined or empty/);
});

// ============================================================================
// 2. Directory creation & space handling
// ============================================================================
test('initializeDatabase - creates dedicated data directory if absent', async () => {
  const tmpRoot = createTempDir('cliporbit-mkdir-');
  const nonExistentUserData = path.join(tmpRoot, 'custom-user-data');
  const expectedDataDir = path.join(nonExistentUserData, 'data');

  assert.equal(fs.existsSync(expectedDataDir), false);

  const result = await initializeDatabase({ userDataPath: nonExistentUserData });
  try {
    assert.ok(fs.existsSync(expectedDataDir));
    assert.ok(fs.existsSync(result.paths.dbFilePath));
  } finally {
    await closeDatabase();
  }
});

test('initializeDatabase - paths containing spaces work correctly', async () => {
  const spaceUserData = path.join(os.tmpdir(), `cliporbit test space ${Date.now()}`);
  tempDirsToCleanup.push(spaceUserData);

  const result = await initializeDatabase({ userDataPath: spaceUserData });
  try {
    assert.ok(fs.existsSync(result.paths.dbFilePath));
    assert.ok(result.paths.dbFilePath.includes(' '));

    // Verify query executes on space path database
    const queryResult = await result.client.$queryRawUnsafe('SELECT 1 as test_val;');
    assert.ok(Array.isArray(queryResult));
  } finally {
    await closeDatabase();
  }
});

// ============================================================================
// 3. Migration and table creation tests
// ============================================================================
test('initializeDatabase - initial migration creates expected tables', async () => {
  const tmpDir = createTempDir('cliporbit-tables-');
  const result = await initializeDatabase({ userDataPath: tmpDir });

  try {
    const tables = await result.client.$queryRawUnsafe(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    );
    const tableNames = tables.map((t) => t.name);

    assert.ok(tableNames.includes('clips'), 'Expected clips table to exist');
    assert.ok(tableNames.includes('snippets'), 'Expected snippets table to exist');
    assert.ok(tableNames.includes('app_settings'), 'Expected app_settings table to exist');
    assert.ok(
      tableNames.includes('_prisma_migrations'),
      'Expected _prisma_migrations table to exist',
    );
  } finally {
    await closeDatabase();
  }
});

// ============================================================================
// 4. Record preservation and idempotency tests
// ============================================================================
test('initializeDatabase - re-running initialization preserves existing records', async () => {
  const tmpDir = createTempDir('cliporbit-persist-');

  // First initialization: insert a clip and a setting
  const firstInit = await initializeDatabase({ userDataPath: tmpDir });
  const clipRepo = createClipRepository(firstInit.client);
  const settingRepo = createAppSettingRepository(firstInit.client);

  const NON_CRYPTOGRAPHIC_MOCK_PAYLOAD = Buffer.from([0x01, 0x02, 0xaa, 0xbb]);
  const NON_CRYPTOGRAPHIC_MOCK_NONCE = Buffer.from([
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
  ]);

  const createdClip = await clipRepo.create({
    id: 'persisted-clip-1',
    contentType: 'text/plain',
    encryptedPayload: NON_CRYPTOGRAPHIC_MOCK_PAYLOAD,
    encryptionNonce: NON_CRYPTOGRAPHIC_MOCK_NONCE,
    payloadByteLength: 4,
  });
  assert.equal(createdClip.id, 'persisted-clip-1');

  await settingRepo.set('ui.theme', 'dark');

  // Disconnect cleanly
  await closeDatabase();

  // Second initialization against the exact same userData path
  const secondInit = await initializeDatabase({ userDataPath: tmpDir });
  try {
    const secondClipRepo = createClipRepository(secondInit.client);
    const secondSettingRepo = createAppSettingRepository(secondInit.client);

    const fetchedClip = await secondClipRepo.findById('persisted-clip-1');
    assert.ok(fetchedClip, 'Clip must be preserved across re-initialization');
    assert.equal(fetchedClip.id, 'persisted-clip-1');
    assert.deepEqual(Buffer.from(fetchedClip.encryptedPayload), NON_CRYPTOGRAPHIC_MOCK_PAYLOAD);

    const theme = await secondSettingRepo.get('ui.theme');
    assert.equal(theme, 'dark', 'Setting must be preserved across re-initialization');
  } finally {
    await closeDatabase();
  }
});

test('initializeDatabase - two consecutive initialization attempts do not corrupt or reset database', async () => {
  const tmpDir = createTempDir('cliporbit-consecutive-');

  // Run 1
  const run1 = await initializeDatabase({ userDataPath: tmpDir });
  const settingRepo1 = createAppSettingRepository(run1.client);
  await settingRepo1.set('test.key', 'initial_value');
  await closeDatabase();

  // Run 2
  const run2 = await initializeDatabase({ userDataPath: tmpDir });
  const settingRepo2 = createAppSettingRepository(run2.client);
  const val = await settingRepo2.get('test.key');
  assert.equal(val, 'initial_value');
  await closeDatabase();
});

// ============================================================================
// 5. Error handling and migration failure tests
// ============================================================================
test('applyMigrations - returns clear DatabaseMigrationError on failure', async () => {
  const tmpDir = createTempDir('cliporbit-mig-err-');
  const dummyDbFile = path.join(tmpDir, 'data', 'cliporbit.sqlite');
  const assets = resolvePrismaAssets();

  // Pass an invalid non-existent schema file path to trigger a predictable migration failure
  const invalidSchemaPath = path.join(tmpDir, 'non_existent_schema.prisma');

  await assert.rejects(
    () => applyMigrations(`file:${dummyDbFile}`, invalidSchemaPath, assets.prismaCliPath),
    DatabaseMigrationError,
  );
});

// ============================================================================
// 6. Prisma connect and disconnect lifecycle
// ============================================================================
test('closeDatabase - disconnects Prisma client and clears active references', async () => {
  const tmpDir = createTempDir('cliporbit-disconnect-');
  const initResult = await initializeDatabase({ userDataPath: tmpDir });

  // Can execute queries while connected
  const result = await initResult.client.$queryRawUnsafe('SELECT 1 as num;');
  assert.ok(result);

  assert.ok(getDatabaseClient() !== null);
  assert.ok(getDatabasePaths() !== null);

  // Close database
  await closeDatabase();

  // Active references cleared
  assert.equal(getDatabaseClient(), null);
  assert.equal(getDatabasePaths(), null);

  // Subsequent closeDatabase calls are idempotent and safe
  await assert.doesNotReject(async () => {
    await closeDatabase();
  });
});
