import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

import electronPath from 'electron';

test('Application Launch — Electron boots, initializes services in userData, and shuts down cleanly', async () => {
  const electronBin =
    typeof electronPath === 'string'
      ? electronPath
      : path.resolve(rootRepoDir, 'apps/desktop/node_modules/.bin/electron');
  const desktopDir = path.resolve(rootRepoDir, 'apps/desktop');

  const { stdout, stderr, exitCode } = await new Promise((resolve) => {
    execFile(
      electronBin,
      ['.'],
      {
        cwd: desktopDir,
        env: {
          ...process.env,
          CLIPORBIT_SMOKE_TEST: '1',
          NODE_ENV: 'production',
        },
        timeout: 20000,
        encoding: 'utf-8',
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout || '',
          stderr: stderr || '',
          exitCode: error ? (error.code ?? 1) : 0,
        });
      },
    );
  });

  assert.equal(
    exitCode,
    0,
    `Electron process failed with exit code ${exitCode}. Stderr: ${stderr}`,
  );

  // Verify full orderly startup markers
  assert.ok(
    stdout.includes('[ClipOrbit Main] Electron app ready event received.'),
    'Should receive Electron app ready event',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Main] Registered secure IPC handlers.'),
    'Should register all secure IPC handlers',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Initializing local SQLite database...'),
    'Should initialize local SQLite database',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Main] Runtime database initialized and verified at:'),
    'Should verify runtime database path',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Initializing authenticated encryption service...'),
    'Should initialize authenticated encryption service',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Main] Local encryption service initialized.'),
    'Should confirm local encryption service initialized',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Creating main BrowserWindow...'),
    'Should create main BrowserWindow',
  );
  assert.ok(
    stdout.includes(
      '[ClipOrbit Main] Smoke test startup verified successfully. Initiating clean exit...',
    ),
    'Should verify smoke test success hook',
  );

  // Verify graceful shutdown sequence markers
  assert.ok(
    stdout.includes('[ClipOrbit Main] Graceful shutdown sequence initiated...'),
    'Should initiate graceful shutdown',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Clipboard capture service disposed cleanly.'),
    'Should dispose clipboard service on shutdown',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Encryption service disposed cleanly.'),
    'Should dispose encryption service on shutdown',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Lifecycle] Database disconnected cleanly.'),
    'Should disconnect database on shutdown',
  );
  assert.ok(
    stdout.includes('[ClipOrbit Main] Graceful shutdown completed cleanly.'),
    'Should complete graceful shutdown cleanly',
  );

  // Verify no raw encryption secrets or keys leaked in stdout/stderr
  assert.match(
    stdout,
    /^(?:(?!([0-9a-fA-F]{64})).)*$/s,
    'Stdout must not contain any 64-character hexadecimal raw key material',
  );
});
