import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, disconnectDatabaseClient } from '../dist/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databasePkgDir = path.resolve(__dirname, '..');
const schemaPath = path.join(databasePkgDir, 'prisma', 'schema.prisma');
const prismaBin = path.join(databasePkgDir, 'node_modules', '.bin', 'prisma');

/**
 * Creates an isolated SQLite database in a temporary directory and applies
 * migrations using the installed Prisma CLI binary.
 *
 * Guaranteed never to touch packages/database/prisma/dev.db.
 */
export async function createIsolatedTestDatabase() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliporbit-test-db-'));
  const dbFilePath = path.join(tmpDir, 'test.db');
  const datasourceUrl = `file:${dbFilePath}`;

  // Execute migration deploy using installed Prisma 6.19.3 binary
  execFileSync(prismaBin, ['migrate', 'deploy', `--schema=${schemaPath}`], {
    env: {
      ...process.env,
      DATABASE_URL: datasourceUrl,
    },
    stdio: 'pipe',
    encoding: 'utf-8',
  });

  const prisma = createDatabaseClient({ datasourceUrl });

  return {
    prisma,
    datasourceUrl,
    dbFilePath,
    tmpDir,
    async cleanup() {
      try {
        await disconnectDatabaseClient(prisma);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  };
}
