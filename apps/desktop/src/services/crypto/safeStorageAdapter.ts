/**
 * ClipOrbit — safeStorage Adapter and Fake Protector
 * Phase 4.5: Encryption and Decryption Service
 *
 * Implements OS-backed safeStorage integration with Linux security validation
 * and provides an injectable fake protector for isolated automated testing.
 */

import crypto from 'node:crypto';
import { type IKeyProtector, InsecureStorageError, KeyManagementError } from './types';

/**
 * Dynamically resolves Electron's `safeStorage` module if available,
 * returning null in non-Electron or pure Node test environments.
 * Does not invoke keychain operations at import time.
 */
function getElectronSafeStorage(): typeof import('electron').safeStorage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null && 'safeStorage' in electron) {
      return electron.safeStorage;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Production safeStorage adapter wrapping Electron's OS-backed secure store.
 */
export class ElectronSafeStorageProtector implements IKeyProtector {
  private readonly customSafeStorage?: typeof import('electron').safeStorage | null;

  constructor(customSafeStorage?: typeof import('electron').safeStorage | null) {
    this.customSafeStorage = customSafeStorage;
  }

  private getStorage(): typeof import('electron').safeStorage | null {
    if (this.customSafeStorage !== undefined) {
      return this.customSafeStorage;
    }
    return getElectronSafeStorage();
  }

  public isAvailable(): boolean {
    const storage = this.getStorage();
    if (!storage || typeof storage.isEncryptionAvailable !== 'function') {
      return false;
    }
    try {
      return storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  public checkBackendSecurity(): void {
    const storage = this.getStorage();
    if (!storage || !this.isAvailable()) {
      throw new InsecureStorageError(
        'Operating system secure storage (Electron safeStorage) is not available.',
      );
    }

    if (process.platform === 'linux' && typeof storage.getSelectedStorageBackend === 'function') {
      const backend = storage.getSelectedStorageBackend();
      if (backend === 'basic_text') {
        throw new InsecureStorageError(
          'Insecure storage backend (basic_text) detected on Linux. An OS-backed secret store (e.g. GNOME Keyring / libsecret or KWallet) is required to securely store the encryption master key.',
        );
      }
    }
  }

  public async protectKey(plainTextKeyHex: string): Promise<Buffer> {
    this.checkBackendSecurity();
    const storage = this.getStorage()!;

    try {
      if (typeof storage.encryptStringAsync === 'function') {
        return await storage.encryptStringAsync(plainTextKeyHex);
      }
      return storage.encryptString(plainTextKeyHex);
    } catch (err) {
      throw new KeyManagementError(
        `Failed to protect master key using OS secure storage: ${err instanceof Error ? err.message : 'Unknown encryption failure'}`,
      );
    }
  }

  public async unprotectKey(
    protectedData: Buffer,
  ): Promise<{ keyHex: string; shouldReEncrypt?: boolean }> {
    this.checkBackendSecurity();
    const storage = this.getStorage()!;

    try {
      if (typeof storage.decryptStringAsync === 'function') {
        const decrypted = await storage.decryptStringAsync(protectedData);
        if (typeof decrypted === 'object' && decrypted !== null && 'result' in decrypted) {
          return {
            keyHex: decrypted.result,
            shouldReEncrypt: Boolean(decrypted.shouldReEncrypt),
          };
        }
        if (typeof decrypted === 'string') {
          return { keyHex: decrypted, shouldReEncrypt: false };
        }
      }

      // Synchronous fallback
      const result = storage.decryptString(protectedData);
      return { keyHex: result, shouldReEncrypt: false };
    } catch (err) {
      throw new KeyManagementError(
        `Failed to decrypt master key from OS secure storage: ${err instanceof Error ? err.message : 'Decryption failure'}`,
      );
    }
  }
}

export interface FakeKeyProtectorOptions {
  isAvailable?: boolean;
  backend?: string;
  hmacSecret?: string;
  shouldReEncryptOnDecrypt?: boolean;
}

/**
 * Injectable mock key protector for isolated unit and integration testing.
 * Does not require access to macOS Keychain or OS secret store.
 * Cryptographically wraps the key with HMAC verification to detect file corruption.
 */
export class FakeKeyProtector implements IKeyProtector {
  public isAvailableFlag: boolean;
  public backend: string;
  private readonly hmacSecret: string;
  public shouldReEncryptOnDecrypt: boolean;
  public protectCallCount = 0;
  public unprotectCallCount = 0;

  constructor(options?: FakeKeyProtectorOptions) {
    this.isAvailableFlag = options?.isAvailable ?? true;
    this.backend =
      options?.backend ?? (process.platform === 'linux' ? 'gnome_libsecret' : 'mock_os_store');
    this.hmacSecret = options?.hmacSecret ?? 'mock-keychain-hmac-secret';
    this.shouldReEncryptOnDecrypt = options?.shouldReEncryptOnDecrypt ?? false;
  }

  public isAvailable(): boolean {
    return this.isAvailableFlag;
  }

  public checkBackendSecurity(): void {
    if (!this.isAvailableFlag) {
      throw new InsecureStorageError('Operating system secure storage is not available.');
    }
    if (this.backend === 'basic_text') {
      throw new InsecureStorageError(
        'Insecure storage backend (basic_text) detected on Linux. An OS-backed secret store is required.',
      );
    }
  }

  public async protectKey(plainTextKeyHex: string): Promise<Buffer> {
    this.checkBackendSecurity();
    this.protectCallCount += 1;

    const hmac = crypto.createHmac('sha256', this.hmacSecret).update(plainTextKeyHex).digest('hex');

    const envelope = {
      format: 'fake-safe-storage-envelope',
      sig: hmac,
      payload: Buffer.from(plainTextKeyHex, 'utf8').toString('base64'),
    };

    return Buffer.from(JSON.stringify(envelope), 'utf8');
  }

  public async unprotectKey(
    protectedData: Buffer,
  ): Promise<{ keyHex: string; shouldReEncrypt?: boolean }> {
    this.checkBackendSecurity();
    this.unprotectCallCount += 1;

    try {
      const parsed = JSON.parse(protectedData.toString('utf8'));
      if (
        !parsed ||
        parsed.format !== 'fake-safe-storage-envelope' ||
        !parsed.sig ||
        !parsed.payload
      ) {
        throw new Error('Invalid envelope structure.');
      }

      const rawHex = Buffer.from(parsed.payload, 'base64').toString('utf8');
      const expectedHmac = crypto
        .createHmac('sha256', this.hmacSecret)
        .update(rawHex)
        .digest('hex');

      if (parsed.sig !== expectedHmac) {
        throw new Error('Signature verification failed: corrupted or tampered key data.');
      }

      return {
        keyHex: rawHex,
        shouldReEncrypt: this.shouldReEncryptOnDecrypt,
      };
    } catch (err) {
      throw new KeyManagementError(
        `Failed to decrypt master key from secure storage: ${err instanceof Error ? err.message : 'Corrupt payload'}`,
      );
    }
  }
}
