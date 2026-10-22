/**
 * ClipOrbit — Encryption and Decryption Service
 * Phase 4.5: Encryption and Decryption Service
 *
 * Exposes a narrow, typed internal cryptographic service API for AES-256-GCM
 * payload encryption and decryption, backed by OS-protected master key storage.
 */

import {
  type EncryptedPayload,
  type DecryptPayloadInput,
  type EncryptionServiceInitOptions,
  type EncryptionServiceStatus,
  CryptoError,
} from './types';
import { encryptPayloadWithKey, decryptPayloadWithKey } from './cipher';
import { MasterKeyManager } from './keyManager';

/**
 * Encapsulated Encryption Service instance.
 * Allows independent instantiation for testing or multi-tenancy.
 */
export class EncryptionService {
  private keyManager: MasterKeyManager | null = null;
  private isInitialized = false;

  /**
   * Initializes the encryption service, resolving or creating the master key.
   */
  public async initialize(
    options?: EncryptionServiceInitOptions,
  ): Promise<EncryptionServiceStatus> {
    if (this.isInitialized && this.keyManager && this.keyManager.isKeyLoaded()) {
      return {
        isInitialized: true,
        masterKeyPath: this.keyManager.getMasterKeyPath(),
      };
    }

    const keyManager = new MasterKeyManager({
      userDataPath: options?.userDataPath,
      keyProtector: options?.keyProtector,
    });

    await keyManager.loadOrCreateKey();

    this.keyManager = keyManager;
    this.isInitialized = true;

    return {
      isInitialized: true,
      masterKeyPath: keyManager.getMasterKeyPath(),
    };
  }

  /**
   * Checks if the service is actively initialized and ready for operations.
   */
  public isReady(): boolean {
    return this.isInitialized && this.keyManager !== null && this.keyManager.isKeyLoaded();
  }

  /**
   * Encrypts arbitrary binary payload bytes using the active master key.
   *
   * @throws CryptoError if service is not initialized or has been disposed.
   */
  public encrypt(plaintext: Buffer | Uint8Array): EncryptedPayload {
    if (!this.isReady() || !this.keyManager) {
      throw new CryptoError('Encryption service is not initialized or has been disposed.');
    }
    const key = this.keyManager.getActiveKey();
    return encryptPayloadWithKey(plaintext, key);
  }

  /**
   * Authenticates and decrypts an encrypted payload using the active master key.
   *
   * @throws CryptoError if service is not initialized or payload fails authentication.
   */
  public decrypt(input: DecryptPayloadInput): Buffer {
    if (!this.isReady() || !this.keyManager) {
      throw new CryptoError('Encryption service is not initialized or has been disposed.');
    }
    const key = this.keyManager.getActiveKey();
    return decryptPayloadWithKey(input, key);
  }

  /**
   * Disposes the encryption service, clearing the in-memory master key buffer.
   */
  public dispose(): void {
    if (this.keyManager) {
      this.keyManager.dispose();
      this.keyManager = null;
    }
    this.isInitialized = false;
  }
}

// ---------------------------------------------------------------------------
// Singleton Service and Facade Functions
// ---------------------------------------------------------------------------

let defaultService: EncryptionService | null = null;

/**
 * Initializes the default application encryption service singleton.
 * Must be awaited before encryption or decryption operations.
 */
export async function initializeEncryptionService(
  options?: EncryptionServiceInitOptions,
): Promise<EncryptionServiceStatus> {
  if (!defaultService) {
    defaultService = new EncryptionService();
  }
  return defaultService.initialize(options);
}

/**
 * Returns whether the default encryption service singleton is initialized.
 */
export function isEncryptionServiceInitialized(): boolean {
  return defaultService !== null && defaultService.isReady();
}

/**
 * Returns the default encryption service singleton, or null if uninitialized.
 */
export function getEncryptionService(): EncryptionService | null {
  return defaultService;
}

/**
 * Encrypts an arbitrary binary payload using the default service master key.
 *
 * @throws CryptoError if the service has not been initialized.
 */
export function encryptPayload(plaintext: Buffer | Uint8Array): EncryptedPayload {
  if (!defaultService || !defaultService.isReady()) {
    throw new CryptoError(
      'Encryption service is not initialized. Call initializeEncryptionService() before performing encryption.',
    );
  }
  return defaultService.encrypt(plaintext);
}

/**
 * Authenticates and decrypts an encrypted payload using the default service master key.
 *
 * @throws CryptoError if the service is not initialized or payload authentication fails.
 */
export function decryptPayload(input: DecryptPayloadInput): Buffer {
  if (!defaultService || !defaultService.isReady()) {
    throw new CryptoError(
      'Encryption service is not initialized. Call initializeEncryptionService() before performing decryption.',
    );
  }
  return defaultService.decrypt(input);
}

/**
 * Clears in-memory keys and shuts down the default encryption service.
 */
export function disposeEncryptionService(): void {
  if (defaultService) {
    defaultService.dispose();
    defaultService = null;
  }
}
