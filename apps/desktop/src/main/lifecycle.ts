/**
 * ClipOrbit — Application Lifecycle Coordinator
 * Phase 4.6: Runtime Encryption Initialization and Lifecycle Integration
 *
 * Coordinates the orderly startup, health verification, and graceful shutdown
 * of the runtime SQLite database, authenticated encryption service, and Electron window.
 */

import { type DatabaseInitOptions } from '../services/database';
import { type EncryptionServiceInitOptions } from '../services/crypto';

/**
 * Non-secret readiness status representing the application lifecycle state.
 * Contains no secret keys, paths, or payload content.
 */
export interface AppReadinessStatus {
  /** Indicates whether the runtime database is initialized and ready. */
  isDatabaseReady: boolean;
  /** Indicates whether the local encryption service is initialized and ready. */
  isEncryptionReady: boolean;
  /** Indicates whether the application shutdown process has commenced. */
  isShutdownInProgress: boolean;
  /** Indicates whether application shutdown and resource cleanup has completed. */
  isShutdownCompleted: boolean;
  /** Indicates whether both database and encryption services are operational. */
  isFullyReady: boolean;
}

/**
 * Pluggable dependencies for the lifecycle coordinator.
 * Enables deterministic testing without spinning up an Electron GUI.
 */
export interface LifecycleCoordinatorDependencies {
  /** Initializes the runtime SQLite database. */
  initializeDatabase: (options?: DatabaseInitOptions) => Promise<unknown>;
  /** Closes and disconnects the runtime database client. */
  closeDatabase: () => Promise<void>;
  /** Initializes the local authenticated encryption service. */
  initializeEncryption: (options?: EncryptionServiceInitOptions) => Promise<unknown>;
  /** Disposes the encryption service and zeroes in-memory key material. */
  disposeEncryption: () => void;
  /** Disposes the clipboard capture service, stopping polling and purging in-memory entries. */
  disposeClipboard?: () => void;
  /** Creates the main application BrowserWindow. */
  createWindow: () => unknown;
  /** Displays a native error dialog box. */
  showErrorBox: (title: string, content: string) => void;
  /** Quits the Electron application. */
  quitApp: () => void;
  /** Optional logging helper. */
  log?: (message: string) => void;
  /** Optional error logging helper. */
  logError?: (message: string, error?: unknown) => void;
}

/**
 * Sanitizes an error message before presenting to the user or logging,
 * ensuring no potential 64-character hexadecimal key strings, raw buffer data,
 * or cryptographic internals are leaked.
 */
export function sanitizeErrorMessage(rawError: unknown): string {
  if (!rawError) {
    return 'An unknown internal error occurred.';
  }

  const message = rawError instanceof Error ? rawError.message : String(rawError);

  // Strip potential 32-byte (64-character) hex strings representing raw keys
  const sanitized = message.replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_KEY]');

  return sanitized.trim() || 'An unknown internal error occurred.';
}

/**
 * Coordinates application initialization and shutdown sequences.
 */
export class LifecycleCoordinator {
  private readonly dependencies: LifecycleCoordinatorDependencies;
  private isDatabaseReady = false;
  private isEncryptionReady = false;
  private isStartupInProgress = false;
  private shutdownInProgress = false;
  private shutdownCompleted = false;

  constructor(dependencies: LifecycleCoordinatorDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Returns a snapshot of the non-secret application readiness status.
   */
  public getStatus(): AppReadinessStatus {
    return {
      isDatabaseReady: this.isDatabaseReady,
      isEncryptionReady: this.isEncryptionReady,
      isShutdownInProgress: this.shutdownInProgress,
      isShutdownCompleted: this.shutdownCompleted,
      isFullyReady:
        this.isDatabaseReady &&
        this.isEncryptionReady &&
        !this.shutdownInProgress &&
        !this.shutdownCompleted,
    };
  }

  public isShutdownInProgress(): boolean {
    return this.shutdownInProgress;
  }

  public isShutdownCompleted(): boolean {
    return this.shutdownCompleted;
  }

  /**
   * Executes the startup sequence:
   * 1. Check idempotency (prevent duplicate initialization).
   * 2. Initialize runtime database.
   * 3. Initialize authenticated encryption service.
   * 4. Verify both services are operational.
   * 5. Create the main application window.
   *
   * On failure:
   * - Cleans up any partially initialized resources.
   * - Shows a sanitized error box to the user.
   * - Quits the application without creating a window.
   *
   * @returns True if startup succeeded, false otherwise.
   */
  public async startup(): Promise<boolean> {
    if (this.isDatabaseReady && this.isEncryptionReady) {
      this.dependencies.log?.(
        '[ClipOrbit Lifecycle] Startup called but application is already initialized; ignoring.',
      );
      return true;
    }

    if (this.isStartupInProgress) {
      this.dependencies.log?.(
        '[ClipOrbit Lifecycle] Startup is already in progress; waiting for completion.',
      );
      return false;
    }

    this.isStartupInProgress = true;

    // Step 1: Initialize the local SQLite database
    try {
      this.dependencies.log?.('[ClipOrbit Lifecycle] Initializing local SQLite database...');
      await this.dependencies.initializeDatabase();
      this.isDatabaseReady = true;
      this.dependencies.log?.('[ClipOrbit Lifecycle] Runtime database initialized successfully.');
    } catch (dbError) {
      const sanitized = sanitizeErrorMessage(dbError);
      this.dependencies.logError?.(
        '[ClipOrbit Lifecycle] Fatal: Runtime database initialization failed:',
        sanitized,
      );

      await this.cleanupResources();
      this.dependencies.showErrorBox(
        'ClipOrbit — Database Initialization Error',
        `Failed to initialize or migrate the local database.\n\n${sanitized}\n\nThe application will now quit.`,
      );
      this.dependencies.quitApp();
      this.isStartupInProgress = false;
      return false;
    }

    // Step 2: Initialize local payload encryption service
    try {
      this.dependencies.log?.(
        '[ClipOrbit Lifecycle] Initializing authenticated encryption service...',
      );
      await this.dependencies.initializeEncryption();
      this.isEncryptionReady = true;
      this.dependencies.log?.(
        '[ClipOrbit Lifecycle] Authenticated encryption service initialized successfully.',
      );
    } catch (cryptoError) {
      const sanitized = sanitizeErrorMessage(cryptoError);
      this.dependencies.logError?.(
        '[ClipOrbit Lifecycle] Fatal: Encryption service initialization failed:',
        sanitized,
      );

      // Disconnect database client and dispose any partial encryption resources
      await this.cleanupResources();

      this.dependencies.showErrorBox(
        'ClipOrbit — Encryption Initialization Error',
        `The application could not safely initialize local payload encryption.\n\n` +
          `ClipOrbit requires secure OS-backed storage (such as macOS Keychain, Windows DPAPI, or Linux Secret Service/KWallet) ` +
          `to protect clipboard data. Plaintext fallback is not permitted.\n\n` +
          `Details: ${sanitized}\n\nThe application will now quit.`,
      );
      this.dependencies.quitApp();
      this.isStartupInProgress = false;
      return false;
    }

    // Step 3: Verify both services are operational before creating window
    if (!this.isDatabaseReady || !this.isEncryptionReady) {
      this.dependencies.logError?.(
        '[ClipOrbit Lifecycle] Readiness verification failed before window creation.',
      );
      await this.cleanupResources();
      this.dependencies.quitApp();
      this.isStartupInProgress = false;
      return false;
    }

    // Step 4: Create the BrowserWindow
    this.dependencies.log?.('[ClipOrbit Lifecycle] Creating main BrowserWindow...');
    this.dependencies.createWindow();

    this.isStartupInProgress = false;
    return true;
  }

  /**
   * Executes orderly application shutdown:
   *
   * ORDERING RATIONALE:
   * 1. Set `isShutdownInProgress = true` to immediately reject new encryption or database requests.
   * 2. Dispose encryption service first (`disposeEncryption`). This wipes the in-memory AES master key
   *    (`buffer.fill(0)`), ensuring no new encryption or decryption can occur during teardown.
   * 3. Disconnect runtime database (`closeDatabase`). Once all cryptographic work has ceased,
   *    the Prisma client disconnects cleanly and releases all SQLite database file locks.
   * 4. Mark `isShutdownCompleted = true`.
   *
   * Idempotent: repeated shutdown calls are safely ignored without recursive loops.
   */
  public async shutdown(): Promise<void> {
    if (this.shutdownCompleted) {
      return;
    }

    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.dependencies.log?.('[ClipOrbit Lifecycle] Shutdown initiated. Disposing resources...');

    // 1. Dispose clipboard capture service first to cease polling and clear in-memory history
    if (this.dependencies.disposeClipboard) {
      try {
        this.dependencies.disposeClipboard();
        this.dependencies.log?.(
          '[ClipOrbit Lifecycle] Clipboard capture service disposed cleanly.',
        );
      } catch (err) {
        this.dependencies.logError?.(
          '[ClipOrbit Lifecycle] Error disposing clipboard capture service:',
          err,
        );
      }
    }

    // 2. Dispose encryption service to clear secret material from memory
    try {
      this.dependencies.disposeEncryption();
      this.isEncryptionReady = false;
      this.dependencies.log?.('[ClipOrbit Lifecycle] Encryption service disposed cleanly.');
    } catch (err) {
      this.dependencies.logError?.(
        '[ClipOrbit Lifecycle] Error disposing encryption service:',
        err,
      );
    }

    // 3. Disconnect runtime database
    try {
      await this.dependencies.closeDatabase();
      this.isDatabaseReady = false;
      this.dependencies.log?.('[ClipOrbit Lifecycle] Database disconnected cleanly.');
    } catch (err) {
      this.dependencies.logError?.('[ClipOrbit Lifecycle] Error disconnecting database:', err);
    }

    this.shutdownCompleted = true;
    this.dependencies.log?.('[ClipOrbit Lifecycle] Shutdown cleanup complete.');
  }

  /**
   * Internal helper to clean up resources during startup failure.
   */
  private async cleanupResources(): Promise<void> {
    if (this.dependencies.disposeClipboard) {
      try {
        this.dependencies.disposeClipboard();
      } catch {
        // Best-effort cleanup
      }
    }

    try {
      this.dependencies.disposeEncryption();
      this.isEncryptionReady = false;
    } catch {
      // Best-effort cleanup
    }

    try {
      await this.dependencies.closeDatabase();
      this.isDatabaseReady = false;
    } catch {
      // Best-effort cleanup
    }
  }
}
