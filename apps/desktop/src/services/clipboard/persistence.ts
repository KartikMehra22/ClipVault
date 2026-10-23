/**
 * ClipOrbit — Encrypted Clipboard Persistence Service
 * Phase 6.3.1: Encrypted Clipboard Persistence Service
 *
 * Provides safe, authenticated persistence and retrieval of clipboard text entries
 * using AES-256-GCM payload encryption and SQLite database storage.
 *
 * PRIVACY AND SECURITY GUARANTEES:
 * 1. Plaintext clipboard content is NEVER stored in the database.
 * 2. Payloads are strictly encrypted at the application service boundary using AES-256-GCM.
 * 3. Persistence requires an explicit, supplied consent policy; disabled by default.
 * 4. Text items are strictly validated against MAX_SAFE_ITEM_BYTE_LENGTH (64 KiB UTF-8).
 * 5. Sensitive-content detection is enforced both before saving and before returning retrieved content.
 * 6. Corrupted records fail closed and are excluded from history retrieval.
 * 7. Repeated saves of identical text content create separate records with unique UUIDs,
 *    distinct cryptographic nonces, and independent timestamps, preserving chronological integrity.
 * 8. No secrets, keys, plaintext values, or ciphertext dumps are leaked in error messages or logs.
 */

import { Buffer } from 'node:buffer';
import {
  type Clip,
  type CreateClipInput,
  type FindRecentClipsOptions,
  createClipRepository,
} from '@cliporbit/database';
import {
  toClipEncryptionFields,
  fromClipRecord,
  type EncryptedPayload,
  type DecryptPayloadInput,
  CryptoError,
  getEncryptionService,
} from '../crypto';
import { getDatabaseClient } from '../database';
import { MAX_SAFE_ITEM_BYTE_LENGTH, MAX_SAFE_IMAGE_BYTE_LENGTH } from './types';
import { detectSensitiveContent, type SensitiveDetectionResult } from './sensitiveContentDetector';
import { getClipboardPersistencePolicy } from './consent';

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

export class PersistenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceError';
  }
}

export class PersistenceDisabledError extends PersistenceError {
  constructor(message = 'Clipboard persistence is currently disabled by policy.') {
    super(message);
    this.name = 'PersistenceDisabledError';
  }
}

export class PersistenceValidationError extends PersistenceError {
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceValidationError';
  }
}

export class PersistenceSensitiveContentError extends PersistenceError {
  constructor(
    message = 'Candidate clipboard text was flagged as sensitive and cannot be persisted.',
  ) {
    super(message);
    this.name = 'PersistenceSensitiveContentError';
  }
}

export class PersistenceEncryptionError extends PersistenceError {
  constructor(message = 'Failed to encrypt clipboard payload.') {
    super(message);
    this.name = 'PersistenceEncryptionError';
  }
}

export class PersistenceDatabaseError extends PersistenceError {
  constructor(message = 'Database operation failed during clipboard persistence.') {
    super(message);
    this.name = 'PersistenceDatabaseError';
  }
}

export class PersistenceRecordCorruptedError extends PersistenceError {
  constructor(message = 'Persisted record payload is corrupted or failed authentication.') {
    super(message);
    this.name = 'PersistenceRecordCorruptedError';
  }
}

// ---------------------------------------------------------------------------
// Interfaces & Contracts
// ---------------------------------------------------------------------------

export interface IPersistencePolicy {
  isPersistenceEnabled(): boolean | Promise<boolean>;
  coordinateSave?<T>(saveFn: () => Promise<T>): Promise<T>;
}

export type PersistencePolicyFn = () => boolean | Promise<boolean>;

export interface IClipRepository {
  create(input: CreateClipInput): Promise<Clip>;
  findById(id: string): Promise<Clip | null>;
  findRecent(options?: FindRecentClipsOptions): Promise<Clip[]>;
  pin(id: string, pinnedAt?: Date): Promise<Clip | null>;
  unpin(id: string): Promise<Clip | null>;
  delete(id: string): Promise<boolean>;
  deleteExpired(referenceDate?: Date): Promise<number>;
  deleteAll?(options?: { unpinnedOnly?: boolean }): Promise<number>;
}

export interface IEncryptionService {
  encrypt(plaintext: Buffer | Uint8Array): EncryptedPayload;
  decrypt(input: DecryptPayloadInput): Buffer;
}

export type SensitiveDetectorFn = (text: string) => SensitiveDetectionResult;

export interface EncryptedClipboardPersistenceOptions {
  repository: IClipRepository;
  encryptionService: IEncryptionService;
  sensitiveDetector?: SensitiveDetectorFn;
  policy: IPersistencePolicy | PersistencePolicyFn;
}

export interface SaveTextClipInput {
  text: string;
  sourceApp?: string | null;
  pinnedAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date;
  id?: string;
  contentType?: string;
}

export interface SavedClipResult {
  id: string;
  byteLength: number;
  contentType: string;
  createdAt: Date;
  isPinned: boolean;
}

export interface DecryptedClipRecord {
  id: string;
  text: string;
  contentType: string;
  byteLength: number;
  sourceApp: string | null;
  isPinned: boolean;
  pinnedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GetPersistedClipsOptions {
  limit?: number;
  offset?: number;
  contentType?: string;
}

export interface GetPersistedClipsResult {
  clips: DecryptedClipRecord[];
  totalRetrieved: number;
  skippedCorruptCount: number;
  skippedSensitiveCount: number;
}

// ---------------------------------------------------------------------------
// Encrypted Clipboard Persistence Service Implementation
// ---------------------------------------------------------------------------

export class EncryptedClipboardPersistenceService {
  private readonly repository: IClipRepository;
  private readonly encryptionService: IEncryptionService;
  private readonly sensitiveDetector: SensitiveDetectorFn;
  private readonly policy: IPersistencePolicy | PersistencePolicyFn;
  private lastExpiryCleanupTime = 0;
  private static readonly EXPIRY_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(options: EncryptedClipboardPersistenceOptions) {
    if (!options || typeof options !== 'object') {
      throw new PersistenceValidationError('Options must be provided to persistence service.');
    }
    if (!options.repository) {
      throw new PersistenceValidationError('A valid Clip repository must be supplied.');
    }
    if (!options.encryptionService) {
      throw new PersistenceValidationError('A valid Encryption service must be supplied.');
    }
    if (!options.policy) {
      throw new PersistenceValidationError('A valid persistence policy must be supplied.');
    }

    this.repository = options.repository;
    this.encryptionService = options.encryptionService;
    this.sensitiveDetector = options.sensitiveDetector ?? detectSensitiveContent;
    this.policy = options.policy;
  }

  /**
   * Checks whether persistence is actively enabled by the injected policy.
   * Fails closed (returns false) on any policy read error or unhandled rejection.
   */
  public isPersistenceEnabled(): boolean | Promise<boolean> {
    try {
      let result: boolean | Promise<boolean>;
      if (typeof this.policy === 'function') {
        result = this.policy();
      } else if (
        typeof this.policy === 'object' &&
        this.policy !== null &&
        typeof this.policy.isPersistenceEnabled === 'function'
      ) {
        result = this.policy.isPersistenceEnabled();
      } else {
        return false;
      }

      if (
        result instanceof Promise ||
        (typeof result === 'object' && result !== null && 'then' in result)
      ) {
        return (async () => {
          try {
            return Boolean(await result);
          } catch {
            return false;
          }
        })();
      }
      return Boolean(result);
    } catch {
      return false;
    }
  }

  /**
   * Encrypts and saves a candidate text clip to the local database.
   *
   * Enforces:
   * 1. Persistence consent verification.
   * 2. UTF-8 byte length boundary (at most 64 KiB).
   * 3. Sensitive-content filtering prior to encryption and persistence.
   * 4. AES-256-GCM encryption with unique nonce generation.
   * 5. No plaintext fallback under any error condition.
   */
  public async saveTextClip(input: SaveTextClipInput): Promise<SavedClipResult> {
    const executeSave = async (): Promise<SavedClipResult> => {
      // 1. Consent policy check
      const isEnabled = await this.isPersistenceEnabled();
      if (!isEnabled) {
        throw new PersistenceDisabledError();
      }

      if (!input || typeof input !== 'object') {
        throw new PersistenceValidationError('SaveTextClipInput must be an object.');
      }

      if (typeof input.text !== 'string' || input.text.length === 0) {
        throw new PersistenceValidationError('Clip text must be a non-empty string.');
      }

      const isImage =
        (typeof input.contentType === 'string' && input.contentType.startsWith('image/')) ||
        input.text.startsWith('data:image/');
      const maxLimit = isImage ? MAX_SAFE_IMAGE_BYTE_LENGTH : MAX_SAFE_ITEM_BYTE_LENGTH;

      // 2. Validate UTF-8 byte length using safe limit
      const byteLength = Buffer.byteLength(input.text, 'utf8');
      if (byteLength > maxLimit) {
        throw new PersistenceValidationError(
          `Payload size (${byteLength} bytes) exceeds maximum safe limit of ${maxLimit} bytes.`,
        );
      }

      // 3. Sensitive content detection at the persistence boundary (text only)
      if (!isImage) {
        const detection = this.sensitiveDetector(input.text);
        if (detection.isSensitive || detection.exceededScanLimit) {
          throw new PersistenceSensitiveContentError();
        }
      }

      // 4. Encode safe text as UTF-8 bytes
      const payloadBytes = Buffer.from(input.text, 'utf8');

      // 5. Encrypt payload using authenticated AES-256-GCM
      let encrypted: EncryptedPayload;
      try {
        encrypted = this.encryptionService.encrypt(payloadBytes);
      } catch (error) {
        if (error instanceof CryptoError) {
          throw new PersistenceEncryptionError(error.message);
        }
        throw new PersistenceEncryptionError('Payload encryption failed unexpectedly.');
      }

      // 6. Map to database schema format
      const encryptionFields = toClipEncryptionFields(encrypted, byteLength);

      const sourceApp =
        typeof input.sourceApp === 'string' && input.sourceApp.trim().length > 0
          ? input.sourceApp.trim().slice(0, 256)
          : null;

      // 6.5. Pre-commit authorization re-check: ensure consent has not been revoked
      // or entered a fail-closed state while encryption or serialization was in-flight.
      const stillEnabled = await this.isPersistenceEnabled();
      if (!stillEnabled) {
        throw new PersistenceDisabledError();
      }

      // 7. Write strictly encrypted fields to the repository
      let savedClip: Clip;
      try {
        savedClip = await this.repository.create({
          ...(input.id ? { id: input.id } : {}),
          contentType: input.contentType ?? (isImage ? 'image/png' : 'text/plain'),
          encryptedPayload: encryptionFields.encryptedPayload,
          encryptionNonce: encryptionFields.encryptionNonce,
          encryptionAuthTag: encryptionFields.encryptionAuthTag,
          encryptionVersion: encryptionFields.encryptionVersion,
          payloadByteLength: encryptionFields.payloadByteLength,
          sourceApp,
          isSensitive: false, // Sensitive items are excluded, never marked sensitive and stored
          pinnedAt: input.pinnedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          createdAt: input.createdAt,
        });
      } catch (error) {
        throw new PersistenceDatabaseError(
          error instanceof Error ? error.message : 'Database write failed during clip persistence.',
        );
      }

      return {
        id: savedClip.id,
        byteLength: savedClip.payloadByteLength,
        contentType: savedClip.contentType,
        createdAt: savedClip.createdAt,
        isPinned: Boolean(savedClip.pinnedAt),
      };
    };

    if (
      typeof this.policy === 'object' &&
      this.policy !== null &&
      typeof this.policy.coordinateSave === 'function'
    ) {
      return this.policy.coordinateSave(executeSave);
    }

    return executeSave();
  }

  /**
   * Retrieves a bounded set of persisted clips, decrypts their payloads, and returns
   * validated internal records.
   *
   * Guarantees:
   * 1. Bounded pagination and deterministic ordering.
   * 2. Corrupted or unauthentic records are skipped without returning partial or plaintext data.
   * 3. Decrypted text is re-scanned for sensitive content before being exposed.
   * 4. Reports non-sensitive aggregate metrics for skipped records.
   */
  public async getRecentClips(
    options?: GetPersistedClipsOptions,
  ): Promise<GetPersistedClipsResult> {
    const limit = options?.limit ?? 50;
    const offset = options?.offset;

    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new PersistenceValidationError('Limit must be an integer between 1 and 100.');
    }
    if (
      offset !== undefined &&
      (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0)
    ) {
      throw new PersistenceValidationError('Offset must be a non-negative integer.');
    }

    // Opportunistically purge expired clips in background (throttled to at most once per hour)
    void this.maybePurgeExpiredClips();

    let records: Clip[];
    try {
      records = await this.repository.findRecent({
        limit,
        offset,
        contentType: options?.contentType,
      });
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database query failed during clip retrieval.',
      );
    }

    const clips: DecryptedClipRecord[] = [];
    let skippedCorruptCount = 0;
    let skippedSensitiveCount = 0;

    for (const record of records) {
      // 1. If stored record was marked sensitive, exclude immediately
      if (record.isSensitive) {
        skippedSensitiveCount++;
        continue;
      }

      // 2. Decrypt payload using authenticated cipher
      let decryptedBytes: Buffer;
      try {
        decryptedBytes = this.encryptionService.decrypt(fromClipRecord(record));
      } catch {
        // Authentication tag failure, corrupted ciphertext, or wrong key
        skippedCorruptCount++;
        continue;
      }

      // 3. Validate decrypted payload byte length against recorded metadata
      const isImage =
        record.contentType.startsWith('image/') ||
        record.contentType === 'image';
      const maxAllowedBytes = isImage ? MAX_SAFE_IMAGE_BYTE_LENGTH : MAX_SAFE_ITEM_BYTE_LENGTH;

      if (
        decryptedBytes.byteLength !== record.payloadByteLength ||
        decryptedBytes.byteLength > maxAllowedBytes
      ) {
        skippedCorruptCount++;
        continue;
      }

      // 4. Decode payload as UTF-8 string
      const decryptedText = decryptedBytes.toString('utf8');

      // 5. Re-run sensitive-content detector on decrypted text before exposing (for non-image items)
      const isDecryptedImage = isImage || decryptedText.startsWith('data:image/');
      if (!isDecryptedImage) {
        const detection = this.sensitiveDetector(decryptedText);
        if (detection.isSensitive || detection.exceededScanLimit) {
          skippedSensitiveCount++;
          continue;
        }
      }

      clips.push({
        id: record.id,
        text: decryptedText,
        contentType: record.contentType,
        byteLength: record.payloadByteLength,
        sourceApp: record.sourceApp,
        isPinned: Boolean(record.pinnedAt),
        pinnedAt: record.pinnedAt,
        expiresAt: record.expiresAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }

    return {
      clips,
      totalRetrieved: records.length,
      skippedCorruptCount,
      skippedSensitiveCount,
    };
  }

  /**
   * Retrieves a single persisted clip by ID and decrypts it.
   * Returns null if nonexistent or if flagged as sensitive.
   * Throws PersistenceRecordCorruptedError if authentication fails.
   */
  public async getClipById(id: string): Promise<DecryptedClipRecord | null> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PersistenceValidationError('ID must be a non-empty string.');
    }

    let record: Clip | null;
    try {
      record = await this.repository.findById(id);
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database query failed during clip lookup.',
      );
    }

    if (!record) {
      return null;
    }

    if (record.isSensitive) {
      return null;
    }

    let decryptedBytes: Buffer;
    try {
      decryptedBytes = this.encryptionService.decrypt(fromClipRecord(record));
    } catch {
      throw new PersistenceRecordCorruptedError();
    }

    if (
      decryptedBytes.byteLength !== record.payloadByteLength ||
      decryptedBytes.byteLength > MAX_SAFE_ITEM_BYTE_LENGTH
    ) {
      throw new PersistenceRecordCorruptedError();
    }

    const decryptedText = decryptedBytes.toString('utf8');
    const detection = this.sensitiveDetector(decryptedText);
    if (detection.isSensitive || detection.exceededScanLimit) {
      return null;
    }

    return {
      id: record.id,
      text: decryptedText,
      contentType: record.contentType,
      byteLength: record.payloadByteLength,
      sourceApp: record.sourceApp,
      isPinned: Boolean(record.pinnedAt),
      pinnedAt: record.pinnedAt,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  /**
   * Pins a persisted clip. Returns true if updated, false if nonexistent.
   */
  public async pinClip(id: string, pinnedAt?: Date): Promise<boolean> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PersistenceValidationError('ID must be a non-empty string.');
    }
    try {
      const updated = await this.repository.pin(id, pinnedAt);
      return updated !== null;
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database pin operation failed.',
      );
    }
  }

  /**
   * Unpins a persisted clip. Returns true if updated, false if nonexistent.
   */
  public async unpinClip(id: string): Promise<boolean> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PersistenceValidationError('ID must be a non-empty string.');
    }
    try {
      const updated = await this.repository.unpin(id);
      return updated !== null;
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database unpin operation failed.',
      );
    }
  }

  /**
   * Deletes a persisted clip by ID. Returns true if deleted, false if nonexistent.
   */
  public async deleteClip(id: string): Promise<boolean> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new PersistenceValidationError('ID must be a non-empty string.');
    }
    try {
      return await this.repository.delete(id);
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database delete operation failed.',
      );
    }
  }

  /**
   * Purges expired clips. Returns the count of deleted records.
   */
  public async deleteExpiredClips(referenceDate?: Date): Promise<number> {
    try {
      return await this.repository.deleteExpired(referenceDate);
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database deleteExpired operation failed.',
      );
    }
  }

  /**
   * Opportunistically purges expired clips in the background if the cleanup interval has passed.
   * Keeps storage bounded without running expensive full-table deletes on every polling check.
   */
  public async maybePurgeExpiredClips(referenceDate?: Date): Promise<number | null> {
    const now = Date.now();
    if (
      now - this.lastExpiryCleanupTime <
      EncryptedClipboardPersistenceService.EXPIRY_CLEANUP_INTERVAL_MS
    ) {
      return null;
    }
    this.lastExpiryCleanupTime = now;
    try {
      return await this.deleteExpiredClips(referenceDate);
    } catch {
      // Opportunistic cleanup errors are contained safely without disrupting callers
      return null;
    }
  }

  /**
   * Clears persisted clips from the database.
   *
   * Bypasses consent check because user explicitly requested deletion/clearing of their data.
   * Only deletes records from the Clip table; snippets and settings are never touched.
   * Returns count of deleted records.
   */
  public async clearAllClips(options?: { unpinnedOnly?: boolean }): Promise<number> {
    try {
      if (typeof this.repository.deleteAll === 'function') {
        return await this.repository.deleteAll(options);
      }
      return 0;
    } catch (error) {
      throw new PersistenceDatabaseError(
        error instanceof Error ? error.message : 'Database deleteAll operation failed.',
      );
    }
  }
}

/**
 * Factory function to create an EncryptedClipboardPersistenceService instance.
 */
export function createEncryptedClipboardPersistenceService(
  options: EncryptedClipboardPersistenceOptions,
): EncryptedClipboardPersistenceService {
  return new EncryptedClipboardPersistenceService(options);
}

// ---------------------------------------------------------------------------
// Singleton Service and Facade Functions
// ---------------------------------------------------------------------------

let defaultPersistenceService: EncryptedClipboardPersistenceService | null = null;

/**
 * Returns the default singleton persistence service, or null if database or encryption is not ready.
 */
export function getEncryptedClipboardPersistenceService(): EncryptedClipboardPersistenceService | null {
  if (!defaultPersistenceService) {
    const client = getDatabaseClient();
    const encryption = getEncryptionService();
    if (!client || !encryption || !encryption.isReady()) {
      return null;
    }
    const repository = createClipRepository(client);
    const policy = getClipboardPersistencePolicy();
    defaultPersistenceService = new EncryptedClipboardPersistenceService({
      repository,
      encryptionService: encryption,
      policy,
      sensitiveDetector: detectSensitiveContent,
    });
  }
  return defaultPersistenceService;
}

/**
 * Resets the default singleton persistence service (useful in tests and shutdown).
 */
export function resetEncryptedClipboardPersistenceService(): void {
  defaultPersistenceService = null;
}
