import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  createDatabaseClient,
  disconnectDatabaseClient,
  type PrismaClient,
} from '@cliporbit/database';

export interface DatabasePaths {
  /** The root Electron userData directory. */
  userDataDir: string;
  /** The dedicated data directory (<userData>/data). */
  dataDir: string;
  /** The SQLite database file path (<userData>/data/cliporbit.sqlite). */
  dbFilePath: string;
  /** The derived Prisma SQLite datasource URL ("file:..."). */
  datasourceUrl: string;
}

export interface PrismaAssets {
  /** Absolute path to schema.prisma. */
  schemaPath: string;
  /** Absolute path to the prisma/migrations directory. */
  migrationsDir: string;
  /** Absolute path to the Prisma CLI executable / script. */
  prismaCliPath: string;
}

export interface DatabaseInitOptions {
  /**
   * Optional custom userData path (useful for testing isolated temporary directories).
   * If omitted, Electron's `app.getPath('userData')` is resolved.
   */
  userDataPath?: string;

  /** Optional custom schema.prisma path override. */
  schemaPath?: string;

  /** Optional custom Prisma CLI path override. */
  prismaCliPath?: string;

  /** Optional Prisma log configurations. */
  log?: ('query' | 'info' | 'warn' | 'error')[];
}

export interface DatabaseInitResult {
  client: PrismaClient;
  paths: DatabasePaths;
  migrationSummary: string;
}

/**
 * Thrown when applying Prisma database migrations fails.
 */
export class DatabaseMigrationError extends Error {
  public readonly exitCode: number | null;
  public readonly stderr: string;

  constructor(message: string, exitCode: number | null = null, stderr: string = '') {
    super(message);
    this.name = 'DatabaseMigrationError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Safely retrieves the Electron `app` object if running inside Electron,
 * or returns null when running in a standalone Node.js environment (e.g. tests).
 */
function getElectronApp(): typeof import('electron').app | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null && 'app' in electron) {
      return electron.app;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolves the runtime SQLite database paths based on Electron's userData directory.
 *
 * Dedicated structure:
 *   <userData>/data/cliporbit.sqlite
 *
 * Returns absolute paths and a normalized SQLite datasource URL ("file:...").
 */
export function resolveDatabasePaths(userDataPath?: string): DatabasePaths {
  let resolvedUserData = userDataPath;

  if (!resolvedUserData) {
    const electronApp = getElectronApp();
    if (electronApp && typeof electronApp.getPath === 'function') {
      resolvedUserData = electronApp.getPath('userData');
    }
  }

  if (
    !resolvedUserData ||
    typeof resolvedUserData !== 'string' ||
    resolvedUserData.trim().length === 0
  ) {
    throw new Error(
      'Unable to resolve database path: userData directory is undefined or empty. When running outside Electron, an explicit userDataPath must be provided.',
    );
  }

  const userDataDir = path.resolve(resolvedUserData.trim());
  const dataDir = path.join(userDataDir, 'data');
  const dbFilePath = path.join(dataDir, 'cliporbit.sqlite');

  // Standardize backslashes for URL format across all platforms (macOS, Linux, Windows)
  const normalizedPath = dbFilePath.replace(/\\/g, '/');
  const datasourceUrl = `file:${normalizedPath}`;

  return {
    userDataDir,
    dataDir,
    dbFilePath,
    datasourceUrl,
  };
}

/**
 * Resolves the Prisma schema and CLI assets with robust project-relative fallback.
 *
 * In development and tests, these are resolved relative to the monorepo structure.
 * In a future packaged production build, assets must be bundled into app resources;
 * this function explicitly checks for asset availability and fails cleanly if missing.
 */
export function resolvePrismaAssets(
  customSchemaPath?: string,
  customPrismaCliPath?: string,
): PrismaAssets {
  let schemaPath = customSchemaPath;
  let prismaCliPath = customPrismaCliPath;

  if (!schemaPath) {
    const candidateSchemaPaths = [
      // Relative to compiled dist/services/ (4 levels to workspace root)
      path.resolve(__dirname, '../../../../packages/database/prisma/schema.prisma'),
      // Relative to src/services/ (3 levels to workspace root)
      path.resolve(__dirname, '../../../packages/database/prisma/schema.prisma'),
      // Relative to staged packaging directory
      path.resolve(__dirname, '../../../../.packaging/prisma/schema.prisma'),
      // Packaged app resources
      ...(process.resourcesPath
        ? [
            path.resolve(process.resourcesPath, 'prisma/schema.prisma'),
            path.resolve(process.resourcesPath, 'app/prisma/schema.prisma'),
            path.resolve(process.resourcesPath, 'packages/database/prisma/schema.prisma'),
          ]
        : []),
      // Relative to process.cwd() (when run from root or apps/desktop)
      path.resolve(process.cwd(), 'packages/database/prisma/schema.prisma'),
      path.resolve(process.cwd(), '../../packages/database/prisma/schema.prisma'),
    ];

    for (const candidate of candidateSchemaPaths) {
      if (fs.existsSync(candidate)) {
        schemaPath = candidate;
        break;
      }
    }
  }

  if (!schemaPath || !fs.existsSync(schemaPath)) {
    throw new DatabaseMigrationError(
      `Prisma schema not found. Searched candidate paths for "packages/database/prisma/schema.prisma". ` +
        `Note: In packaged production builds, Prisma schema and migration assets must be bundled into app resources.`,
    );
  }

  const migrationsDir = path.join(path.dirname(schemaPath), 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    throw new DatabaseMigrationError(
      `Prisma migrations directory not found at: "${migrationsDir}".`,
    );
  }

  if (!prismaCliPath) {
    const candidateCliPaths = [
      // Relative to compiled dist/services/ in staged packaging or packaged app
      // (__dirname: <app>/desktop/dist/services -> 3 levels up is <app>)
      path.resolve(__dirname, '../../../node_modules/prisma/build/index.js'),
      path.resolve(__dirname, '../../../../.packaging/node_modules/prisma/build/index.js'),
      // Relative to compiled dist/services/ in monorepo development (4 levels to workspace root)
      path.resolve(__dirname, '../../../../packages/database/node_modules/prisma/build/index.js'),
      // Relative to src/services/ in development (3 levels to workspace root)
      path.resolve(__dirname, '../../../packages/database/node_modules/prisma/build/index.js'),
      // Packaged app resources
      ...(process.resourcesPath
        ? [
            path.resolve(process.resourcesPath, 'app/node_modules/prisma/build/index.js'),
            path.resolve(process.resourcesPath, 'prisma/build/index.js'),
            path.resolve(process.resourcesPath, 'node_modules/prisma/build/index.js'),
            path.resolve(
              process.resourcesPath,
              'packages/database/node_modules/prisma/build/index.js',
            ),
          ]
        : []),
      // Relative to process.cwd() (when run from root or apps/desktop)
      path.resolve(process.cwd(), 'node_modules/prisma/build/index.js'),
      path.resolve(process.cwd(), 'packages/database/node_modules/prisma/build/index.js'),
      path.resolve(process.cwd(), '../../packages/database/node_modules/prisma/build/index.js'),
      path.resolve(__dirname, '../../../../node_modules/prisma/build/index.js'),
    ];

    for (const candidate of candidateCliPaths) {
      if (fs.existsSync(candidate)) {
        prismaCliPath = candidate;
        break;
      }
    }
  }

  if (!prismaCliPath || !fs.existsSync(prismaCliPath)) {
    throw new DatabaseMigrationError(
      `Prisma CLI binary not found. Searched candidate paths for "prisma/build/index.js". ` +
        `Note: In packaged production builds, the Prisma CLI engine must be bundled into app resources.`,
    );
  }

  return { schemaPath, migrationsDir, prismaCliPath };
}

/**
 * Applies pending Prisma migrations to the specified SQLite database file
 * using a fixed executable and argument array (never shell string interpolation).
 *
 * Exclusively executes `prisma migrate deploy` to safely apply pending migrations
 * without resetting or destroying existing user data.
 */
export async function applyMigrations(
  datasourceUrl: string,
  schemaPath: string,
  prismaCliPath: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Fixed executable and arguments array
    const executable = process.execPath;
    const args = [prismaCliPath, 'migrate', 'deploy', `--schema=${schemaPath}`];

    execFile(
      executable,
      args,
      {
        env: {
          ...process.env,
          DATABASE_URL: datasourceUrl,
          ELECTRON_RUN_AS_NODE: '1',
        },
        timeout: 30000,
        encoding: 'utf-8',
      },
      (error, stdout, stderr) => {
        if (error) {
          const exitCode =
            typeof (error as { code?: unknown }).code === 'number'
              ? ((error as { code?: unknown }).code as number)
              : null;
          const cleanStderr = stderr ? stderr.trim() : '';
          reject(
            new DatabaseMigrationError(
              `Database migration failed: ${error.message}${cleanStderr ? `\nStderr: ${cleanStderr}` : ''}`,
              exitCode,
              cleanStderr,
            ),
          );
          return;
        }

        resolve(stdout ? stdout.trim() : '');
      },
    );
  });
}

let activeDatabaseClient: PrismaClient | null = null;
let activeDatabasePaths: DatabasePaths | null = null;

/**
 * Initializes the application's runtime SQLite database:
 *
 * 1. Resolves the runtime data directory (<userData>/data).
 * 2. Ensures the data directory exists.
 * 3. Applies pending Prisma migrations to the database.
 * 4. Creates a single PrismaClient instance via @cliporbit/database.
 * 5. Establishes the database connection and verifies usability via a health check query.
 * 6. Returns the connected client, paths, and migration summary.
 */
export async function initializeDatabase(
  options: DatabaseInitOptions = {},
): Promise<DatabaseInitResult> {
  const paths = resolveDatabasePaths(options.userDataPath);

  // 1. Ensure the dedicated data directory exists
  if (!fs.existsSync(paths.dataDir)) {
    fs.mkdirSync(paths.dataDir, { recursive: true });
  }

  // 2. Resolve Prisma CLI and migration assets
  const assets = resolvePrismaAssets(options.schemaPath, options.prismaCliPath);

  // 3. Apply pending migrations safely using Prisma CLI
  const migrationSummary = await applyMigrations(
    paths.datasourceUrl,
    assets.schemaPath,
    assets.prismaCliPath,
  );

  // 4. Create Prisma client using the shared database factory
  const client = createDatabaseClient({
    datasourceUrl: paths.datasourceUrl,
    log: options.log,
  });

  // 5. Establish connection and verify it is usable
  try {
    await client.$connect();
    await client.$queryRawUnsafe('SELECT 1');
  } catch (connectError) {
    await disconnectDatabaseClient(client);
    throw new Error(
      `Database connection verification failed: ${connectError instanceof Error ? connectError.message : String(connectError)}`,
    );
  }

  activeDatabaseClient = client;
  activeDatabasePaths = paths;

  return {
    client,
    paths,
    migrationSummary,
  };
}

/**
 * Returns the currently active runtime PrismaClient, or null if not initialized.
 */
export function getDatabaseClient(): PrismaClient | null {
  return activeDatabaseClient;
}

/**
 * Returns the currently active runtime DatabasePaths, or null if not initialized.
 */
export function getDatabasePaths(): DatabasePaths | null {
  return activeDatabasePaths;
}

/**
 * Closes and disconnects the active PrismaClient, safely releasing all SQLite locks.
 */
export async function closeDatabase(): Promise<void> {
  if (activeDatabaseClient) {
    const client = activeDatabaseClient;
    activeDatabaseClient = null;
    activeDatabasePaths = null;
    await disconnectDatabaseClient(client);
  }
}
