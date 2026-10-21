/**
 * ClipOrbit — Cryptographic Service Contracts and Types
 * Phase 4.5: Encryption and Decryption Service
 *
 * Defines contracts for AES-256-GCM authenticated payload encryption,
 * key lifecycle management, and database schema compatibility mapping.
 */

export const ENCRYPTION_VERSION_1 = 1 as const;
export const CURRENT_ENCRYPTION_VERSION = ENCRYPTION_VERSION_1;
export type SupportedEncryptionVersion = typeof ENCRYPTION_VERSION_1;

export const AES_GCM_ALGORITHM = 'aes-256-gcm' as const;
export const AES_256_KEY_LENGTH_BYTES = 32; // 256 bits
export const AES_GCM_NONCE_LENGTH_BYTES = 12; // 96 bits standard GCM nonce
export const AES_GCM_AUTH_TAG_LENGTH_BYTES = 16; // 128 bits standard GCM auth tag

/**
 * Output of a successful payload encryption operation.
 * All binary buffers are retained as Buffers without lossy string encoding.
 */
export interface EncryptedPayload {
  /** The AES-256-GCM ciphertext buffer. */
  ciphertext: Buffer;
  /** Cryptographically random 12-byte initialization vector / nonce. */
  nonce: Buffer;
  /** 16-byte GCM authentication tag. */
  authTag: Buffer;
  /** Supported encryption format version (currently 1). */
  version: number;
}

/**
 * Input required to authenticate and decrypt an encrypted payload.
 */
export interface DecryptPayloadInput {
  /** The encrypted ciphertext bytes. */
  ciphertext: Buffer | Uint8Array;
  /** The 12-byte cryptographic nonce used during encryption. */
  nonce: Buffer | Uint8Array;
  /** The 16-byte authentication tag produced during encryption. */
  authTag: Buffer | Uint8Array;
  /**
   * The encryption format version.
   * If omitted, defaults to CURRENT_ENCRYPTION_VERSION (1).
   */
  version?: number;
}

/**
 * Mapping contract for persisting encrypted clipboard entries to the Clip repository.
 */
export interface EncryptedClipFields {
  encryptedPayload: Buffer;
  encryptionNonce: Buffer;
  encryptionAuthTag: Buffer;
  encryptionVersion: number;
  payloadByteLength: number;
}

/**
 * Mapping contract for persisting encrypted snippets to the Snippet repository.
 */
export interface EncryptedSnippetFields {
  encryptedContent: Buffer;
  encryptionNonce: Buffer;
  encryptionAuthTag: Buffer;
  encryptionVersion: number;
}

/**
 * Abstract key protector interface for OS-backed secure storage.
 *
 * Implemented by ElectronSafeStorageProtector for production
 * and FakeKeyProtector for isolated unit testing.
 */
export interface IKeyProtector {
  /**
   * Checks whether the underlying OS secure store is available.
   */
  isAvailable(): boolean;

  /**
   * Validates backend safety (e.g. rejecting Linux `basic_text`).
   * Throws InsecureStorageError if the backend is deemed insecure.
   */
  checkBackendSecurity?(): void;

  /**
   * Encrypts the raw key (represented as a 64-character hex string)
   * into an OS-protected binary representation.
   */
  protectKey(plainTextKeyHex: string): Promise<Buffer>;

  /**
   * Decrypts the OS-protected binary representation back into a 64-character hex string.
   */
  unprotectKey(protectedData: Buffer): Promise<{ keyHex: string; shouldReEncrypt?: boolean }>;
}

/**
 * Options for configuring and initializing the encryption service.
 */
export interface EncryptionServiceInitOptions {
  /**
   * Optional custom userData path override.
   * Useful for unit tests running against isolated temporary directories.
   * If omitted, Electron's `app.getPath('userData')` is resolved.
   */
  userDataPath?: string;

  /**
   * Optional custom key protector adapter.
   * If omitted, the default Electron safeStorage adapter is instantiated.
   */
  keyProtector?: IKeyProtector;
}

/**
 * Status information returned upon encryption service initialization.
 */
export interface EncryptionServiceStatus {
  isInitialized: boolean;
  masterKeyPath: string;
}

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

/**
 * Base class for all cryptographic service errors.
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Thrown when parameters fail length, type, or contract validation.
 */
export class CryptoValidationError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoValidationError';
  }
}

/**
 * Thrown when an encrypted payload fails GCM authentication tag verification
 * or cannot be decrypted. Does not leak plaintext or internal key details.
 */
export class PayloadAuthenticationError extends CryptoError {
  constructor(message = 'Failed to authenticate or decrypt payload.') {
    super(message);
    this.name = 'PayloadAuthenticationError';
  }
}

/**
 * Thrown when master key generation, reading, atomic writing, or loading fails.
 */
export class KeyManagementError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'KeyManagementError';
  }
}

/**
 * Thrown when safeStorage is unavailable or an insecure backend (like Linux basic_text) is detected.
 */
export class InsecureStorageError extends CryptoError {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureStorageError';
  }
}

/**
 * Thrown when an unsupported encryption version is encountered.
 */
export class UnsupportedEncryptionVersionError extends CryptoError {
  public readonly unsupportedVersion: number;

  constructor(version: number) {
    super(
      `Unsupported encryption version: ${version}. Supported version: ${CURRENT_ENCRYPTION_VERSION}.`,
    );
    this.name = 'UnsupportedEncryptionVersionError';
    this.unsupportedVersion = version;
  }
}
