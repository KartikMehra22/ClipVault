/**
 * ClipOrbit — Master Key Lifecycle Manager
 * Phase 4.5: Encryption and Decryption Service
 *
 * Manages the persistence, protection, loading, and memory lifecycle
 * of the 256-bit AES master key at `<userData>/crypto/master-key.enc`.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AES_256_KEY_LENGTH_BYTES, type IKeyProtector, KeyManagementError } from './types';
import { generateMasterKey } from './cipher';
import { ElectronSafeStorageProtector } from './safeStorageAdapter';

export interface CryptoPaths {
  /** Root Electron userData directory. */
  userDataDir: string;
  /** Dedicated directory for cryptographic keys (<userData>/crypto). */
  cryptoDir: string;
  /** Encrypted master key file path (<userData>/crypto/master-key.enc). */
  masterKeyPath: string;
}

/**
 * Safely retrieves the Electron `app` object if available.
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
 * Resolves the cryptographic file paths based on Electron's userData directory.
 *
 * Structure:
 *   <userData>/crypto/master-key.enc
 */
export function resolveCryptoPaths(userDataPath?: string): CryptoPaths {
  let resolvedUserData = userDataPath;

  if (!resolvedUserData) {
    const electronApp = getElectronApp();
    if (electronApp && typeof electronApp.getPath === 'function') {
      resolvedUserData = electronApp.getPath('userData');
    }
  }

  if (!resolvedUserData || typeof resolvedUserData !== 'string' || resolvedUserData.trim() === '') {
    throw new KeyManagementError(
      'Unable to resolve userData directory. Provide explicit userDataPath when running outside an active Electron runtime.',
    );
  }

  const normalizedUserData = path.resolve(resolvedUserData);
  const cryptoDir = path.join(normalizedUserData, 'crypto');
  const masterKeyPath = path.join(cryptoDir, 'master-key.enc');

  return {
    userDataDir: normalizedUserData,
    cryptoDir,
    masterKeyPath,
  };
}

/**
 * Safely applies restrictive permissions (mode) to a directory or file where supported.
 */
function applyRestrictivePermissions(targetPath: string, mode: number): void {
  try {
    if (process.platform !== 'win32') {
      fs.chmodSync(targetPath, mode);
    }
  } catch {
    // Ignore permissions errors on platforms or filesystems that do not support POSIX modes
  }
}

/**
 * Atomically writes data to a target path using a temporary file in the same directory.
 * Sets restrictive file permissions (0o600).
 */
export function atomicWriteProtectedFile(
  targetPath: string,
  data: Buffer,
  allowOverwrite = false,
): void {
  const dir = path.dirname(targetPath);
  let tmpPath: string | null = null;

  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      applyRestrictivePermissions(dir, 0o700);
    }

    if (!allowOverwrite && fs.existsSync(targetPath)) {
      throw new KeyManagementError(`Refusing to overwrite existing file at: ${targetPath}`);
    }

    const tmpFilename = `.master-key.enc.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
    tmpPath = path.join(dir, tmpFilename);

    fs.writeFileSync(tmpPath, data, { mode: 0o600 });
    applyRestrictivePermissions(tmpPath, 0o600);

    // Atomic replacement
    fs.renameSync(tmpPath, targetPath);
    applyRestrictivePermissions(targetPath, 0o600);
    tmpPath = null;
  } catch (err) {
    if (tmpPath && fs.existsSync(tmpPath)) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // Best-effort cleanup
      }
    }
    if (err instanceof KeyManagementError) {
      throw err;
    }
    throw new KeyManagementError(
      `Failed to write protected file atomically: ${err instanceof Error ? err.message : 'Unknown I/O error'}`,
    );
  }
}

/**
 * Validates a decrypted hex string, requiring exactly 64 hexadecimal characters
 * and returning a 32-byte key Buffer.
 */
function parseDecryptedKeyHex(keyHex: string): Buffer {
  if (typeof keyHex !== 'string') {
    throw new KeyManagementError('Decrypted master key is not a string.');
  }

  const trimmed = keyHex.trim();
  if (trimmed.length !== AES_256_KEY_LENGTH_BYTES * 2 || !/^[0-9a-fA-F]+$/.test(trimmed)) {
    throw new KeyManagementError(
      `Decrypted master key has invalid format: expected ${AES_256_KEY_LENGTH_BYTES * 2} hex characters.`,
    );
  }

  const keyBuffer = Buffer.from(trimmed, 'hex');
  if (keyBuffer.length !== AES_256_KEY_LENGTH_BYTES) {
    throw new KeyManagementError(
      `Decrypted master key has invalid length: expected ${AES_256_KEY_LENGTH_BYTES} bytes, got ${keyBuffer.length}.`,
    );
  }

  return keyBuffer;
}

/**
 * Manages loading, creation, and memory lifecycle of the 256-bit master encryption key.
 */
export class MasterKeyManager {
  private readonly paths: CryptoPaths;
  private readonly keyProtector: IKeyProtector;
  private activeKey: Buffer | null = null;
  private isDisposed = false;

  constructor(options?: { userDataPath?: string; keyProtector?: IKeyProtector }) {
    this.paths = resolveCryptoPaths(options?.userDataPath);
    this.keyProtector = options?.keyProtector ?? new ElectronSafeStorageProtector();
  }

  public getMasterKeyPath(): string {
    return this.paths.masterKeyPath;
  }

  public getCryptoDir(): string {
    return this.paths.cryptoDir;
  }

  /**
   * Loads the existing master key or creates a new one if no key file exists.
   *
   * CRITICAL FAIL-CLOSED BEHAVIOR:
   * If an existing key file exists but cannot be decrypted, is corrupt, or contains
   * an invalid key, this method throws KeyManagementError. It will NEVER overwrite
   * or regenerate an unusable existing key.
   */
  public async loadOrCreateKey(): Promise<Buffer> {
    if (this.isDisposed) {
      throw new KeyManagementError('MasterKeyManager has been disposed.');
    }

    if (this.activeKey) {
      return this.activeKey;
    }

    const { masterKeyPath, cryptoDir } = this.paths;

    // Check if master key file already exists
    if (fs.existsSync(masterKeyPath)) {
      let protectedData: Buffer;
      try {
        protectedData = fs.readFileSync(masterKeyPath);
      } catch (err) {
        throw new KeyManagementError(
          `Failed to read existing master key file: ${err instanceof Error ? err.message : 'I/O error'}. Cannot proceed.`,
        );
      }

      if (protectedData.length === 0) {
        throw new KeyManagementError(
          'Existing master key file is empty or corrupted. Refusing to regenerate key to avoid data loss.',
        );
      }

      let unprotectResult: { keyHex: string; shouldReEncrypt?: boolean };
      try {
        unprotectResult = await this.keyProtector.unprotectKey(protectedData);
      } catch (err) {
        // Fail closed — do NOT regenerate key!
        throw new KeyManagementError(
          `Failed to decrypt existing master key from secure storage: ${err instanceof Error ? err.message : 'Decryption error'}. Refusing to overwrite existing key.`,
        );
      }

      const keyBuffer = parseDecryptedKeyHex(unprotectResult.keyHex);

      // Handle key rotation if requested by safeStorage
      if (unprotectResult.shouldReEncrypt) {
        try {
          const reProtected = await this.keyProtector.protectKey(unprotectResult.keyHex);
          atomicWriteProtectedFile(masterKeyPath, reProtected, true);
        } catch {
          // Failure to update rotated key does not prevent using the currently decrypted key
        }
      }

      this.activeKey = keyBuffer;
      return this.activeKey;
    }

    // Key file does not exist: create new master key
    // Ensure directory exists with 0o700 permissions
    fs.mkdirSync(cryptoDir, { recursive: true, mode: 0o700 });
    applyRestrictivePermissions(cryptoDir, 0o700);

    const newRawKey = generateMasterKey();
    const keyHex = newRawKey.toString('hex');

    let protectedKeyBuffer: Buffer;
    try {
      protectedKeyBuffer = await this.keyProtector.protectKey(keyHex);
    } catch (err) {
      throw new KeyManagementError(
        `Failed to protect newly generated master key: ${err instanceof Error ? err.message : 'Encryption error'}`,
      );
    }

    // Atomic write without overwriting (guards against initialization races)
    atomicWriteProtectedFile(masterKeyPath, protectedKeyBuffer, false);

    this.activeKey = newRawKey;
    return this.activeKey;
  }

  /**
   * Returns the active master key buffer if loaded, or throws if not initialized or disposed.
   * Internal to service operations; never exposed to IPC or renderer.
   */
  public getActiveKey(): Buffer {
    if (this.isDisposed || !this.activeKey) {
      throw new KeyManagementError(
        'Master key is not loaded or the key manager has been disposed.',
      );
    }
    return this.activeKey;
  }

  /**
   * Safely clears the master key from memory by zeroing the buffer and clearing references.
   */
  public dispose(): void {
    if (this.activeKey) {
      try {
        this.activeKey.fill(0);
      } catch {
        // Best-effort memory zeroing
      }
      this.activeKey = null;
    }
    this.isDisposed = true;
  }

  public isKeyLoaded(): boolean {
    return this.activeKey !== null && !this.isDisposed;
  }
}
