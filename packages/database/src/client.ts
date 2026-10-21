import { PrismaClient } from '@prisma/client';

export interface DatabaseClientOptions {
  /**
   * SQLite datasource connection URL.
   *
   * Must follow the Prisma SQLite datasource format: "file:<path>".
   * For example: "file:/path/to/cliporbit.db" or "file:./dev.db".
   */
  datasourceUrl: string;

  /**
   * Optional logging level or Prisma log configurations.
   */
  log?: ('query' | 'info' | 'warn' | 'error')[];
}

/**
 * Creates and returns an isolated, typed PrismaClient configured with the
 * explicitly supplied SQLite datasource URL.
 *
 * This factory accepts an explicit database URL, keeping database location
 * decisions (such as Electron userData paths or isolated test temp directories)
 * outside the database package.
 */
export function createDatabaseClient(options: DatabaseClientOptions): PrismaClient {
  if (!options || typeof options.datasourceUrl !== 'string') {
    throw new Error('DatabaseClientOptions.datasourceUrl is required and must be a string.');
  }

  const trimmedUrl = options.datasourceUrl.trim();
  if (!trimmedUrl.startsWith('file:')) {
    throw new Error(
      `Invalid SQLite datasource URL: "${options.datasourceUrl}". Expected format: "file:<path>".`,
    );
  }

  return new PrismaClient({
    datasourceUrl: trimmedUrl,
    log: options.log,
  });
}

/**
 * Disconnects the supplied PrismaClient cleanly, releasing database locks.
 */
export async function disconnectDatabaseClient(client: PrismaClient): Promise<void> {
  if (client && typeof client.$disconnect === 'function') {
    await client.$disconnect();
  }
}
