import { Prisma, PrismaClient, type Clip } from '@prisma/client';
import { DatabaseValidationError, isRecordNotFoundError } from '../errors';

export interface CreateClipInput {
  /** Optional custom ID; if omitted, Prisma generates a UUID. */
  id?: string;

  /** MIME or semantic content type, e.g. "text/plain", "image/png". */
  contentType: string;

  /**
   * Encrypted binary payload.
   *
   * Plaintext clip content MUST NEVER be passed here. Must be binary data
   * encrypted at the application service boundary.
   */
  encryptedPayload: Buffer | Uint8Array;

  /** Cryptographic nonce/IV used during payload encryption. */
  encryptionNonce: Buffer | Uint8Array;

  /** Optional authentication tag (e.g. for AES-GCM or Poly1305). */
  encryptionAuthTag?: Buffer | Uint8Array | null;

  /** Encryption algorithm/key scheme version (defaults to 1). */
  encryptionVersion?: number;

  /**
   * Unencrypted or payload byte length for storage quota calculation
   * without requiring decryption. Must be a non-negative integer.
   */
  payloadByteLength: number;

  /** Optional originating application identifier, e.g. "com.apple.Safari". */
  sourceApp?: string | null;

  /** Flag indicating whether the source content was marked sensitive by system/password manager. */
  isSensitive?: boolean;

  /** Optional pinned timestamp. If set, clip is considered pinned. */
  pinnedAt?: Date | null;

  /** Optional expiration timestamp. When reached, clip is eligible for expiration purge. */
  expiresAt?: Date | null;

  /** Optional creation timestamp (useful for deterministic tests). Defaults to now. */
  createdAt?: Date;
}

export interface FindRecentClipsOptions {
  /** Maximum number of records to return. Must be between 1 and 100 (defaults to 50). */
  limit?: number;

  /** Number of records to skip for offset pagination. Must be a non-negative integer. */
  offset?: number;

  /** Optional filter by content type. */
  contentType?: string;
}

export interface ListPinnedClipsOptions {
  /** Maximum number of records to return. Must be between 1 and 100 (defaults to 50). */
  limit?: number;

  /** Number of records to skip for offset pagination. Must be a non-negative integer. */
  offset?: number;

  /** Optional filter by content type. */
  contentType?: string;
}

function toBinary(val: unknown, fieldName: string): Uint8Array<ArrayBuffer> {
  if (Buffer.isBuffer(val)) {
    if (val.length === 0) {
      throw new DatabaseValidationError(`${fieldName} cannot be empty.`);
    }
    return Uint8Array.from(val) as Uint8Array<ArrayBuffer>;
  }
  if (val instanceof Uint8Array) {
    if (val.byteLength === 0) {
      throw new DatabaseValidationError(`${fieldName} cannot be empty.`);
    }
    return Uint8Array.from(val) as Uint8Array<ArrayBuffer>;
  }
  throw new DatabaseValidationError(
    `${fieldName} must be binary data (Buffer or Uint8Array). Plaintext strings or unencrypted payloads are strictly prohibited.`,
  );
}

function toOptionalBinary(val: unknown, fieldName: string): Uint8Array<ArrayBuffer> | null {
  if (val === undefined || val === null) {
    return null;
  }
  return toBinary(val, fieldName);
}

function validateId(id: unknown): string {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new DatabaseValidationError('ID must be a non-empty string.');
  }
  return id.trim();
}

function validateContentType(contentType: unknown): string {
  if (typeof contentType !== 'string' || contentType.trim().length === 0) {
    throw new DatabaseValidationError('Content type must be a non-empty string.');
  }
  const trimmed = contentType.trim();
  if (trimmed.length > 256) {
    throw new DatabaseValidationError('Content type must not exceed 256 characters.');
  }
  return trimmed;
}

function validateLimit(limit: unknown, defaultLimit: number = 50, maxLimit: number = 100): number {
  if (limit === undefined || limit === null) {
    return defaultLimit;
  }
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new DatabaseValidationError(
      `Limit must be an integer between 1 and ${maxLimit}. Received: ${String(limit)}`,
    );
  }
  return limit;
}

function validateOffset(offset: unknown): number | undefined {
  if (offset === undefined || offset === null) {
    return undefined;
  }
  if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
    throw new DatabaseValidationError(
      `Offset must be a non-negative integer. Received: ${String(offset)}`,
    );
  }
  return offset;
}

function validateDate(date: unknown, fieldName: string): Date {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    throw new DatabaseValidationError(`${fieldName} must be a valid Date object.`);
  }
  return date;
}

function validateOptionalDate(date: unknown, fieldName: string): Date | null {
  if (date === undefined || date === null) {
    return null;
  }
  return validateDate(date, fieldName);
}

function validatePayloadByteLength(length: unknown): number {
  if (typeof length !== 'number' || !Number.isInteger(length) || length < 0) {
    throw new DatabaseValidationError(
      `payloadByteLength must be a non-negative integer. Received: ${String(length)}`,
    );
  }
  return length;
}

function validateEncryptionVersion(version: unknown): number {
  if (version === undefined || version === null) {
    return 1;
  }
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new DatabaseValidationError(
      `encryptionVersion must be a positive integer (>= 1). Received: ${String(version)}`,
    );
  }
  return version;
}

export class ClipRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new encrypted clip record.
   *
   * Validates required payload fields, ensuring payloads are provided strictly as
   * binary Buffers and bounded lengths.
   */
  async create(input: CreateClipInput): Promise<Clip> {
    if (!input || typeof input !== 'object') {
      throw new DatabaseValidationError('CreateClipInput must be an object.');
    }

    const contentType = validateContentType(input.contentType);
    const encryptedPayload = toBinary(input.encryptedPayload, 'encryptedPayload');
    const encryptionNonce = toBinary(input.encryptionNonce, 'encryptionNonce');
    const encryptionAuthTag = toOptionalBinary(input.encryptionAuthTag, 'encryptionAuthTag');
    const encryptionVersion = validateEncryptionVersion(input.encryptionVersion);
    const payloadByteLength = validatePayloadByteLength(input.payloadByteLength);

    const sourceApp =
      typeof input.sourceApp === 'string' && input.sourceApp.trim().length > 0
        ? input.sourceApp.trim().slice(0, 256)
        : null;

    const pinnedAt = validateOptionalDate(input.pinnedAt, 'pinnedAt');
    const expiresAt = validateOptionalDate(input.expiresAt, 'expiresAt');
    const createdAt = input.createdAt ? validateDate(input.createdAt, 'createdAt') : undefined;

    const data: Prisma.ClipCreateInput = {
      contentType,
      encryptedPayload,
      encryptionNonce,
      encryptionAuthTag,
      encryptionVersion,
      payloadByteLength,
      sourceApp,
      isSensitive: Boolean(input.isSensitive),
      pinnedAt,
      expiresAt,
      ...(createdAt ? { createdAt } : {}),
    };

    if (input.id !== undefined) {
      data.id = validateId(input.id);
    }

    return this.prisma.clip.create({ data });
  }

  /**
   * Fetches an individual clip by its unique ID.
   *
   * Returns the Clip if found, or null if no record exists with that ID.
   */
  async findById(id: string): Promise<Clip | null> {
    const validId = validateId(id);
    return this.prisma.clip.findUnique({
      where: { id: validId },
    });
  }

  /**
   * Fetches the most recent clips with a bounded page size.
   *
   * Results are ordered stably by createdAt DESC, then id DESC to guarantee
   * deterministic order when timestamps are identical.
   */
  async findRecent(options?: FindRecentClipsOptions): Promise<Clip[]> {
    const limit = validateLimit(options?.limit);
    const offset = validateOffset(options?.offset);

    const where: Prisma.ClipWhereInput = {};
    if (options?.contentType !== undefined) {
      where.contentType = validateContentType(options.contentType);
    }

    return this.prisma.clip.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Convenience helper to fetch recent clips filtered by content type.
   */
  async findByContentType(
    contentType: string,
    options?: Omit<FindRecentClipsOptions, 'contentType'>,
  ): Promise<Clip[]> {
    return this.findRecent({
      ...options,
      contentType: validateContentType(contentType),
    });
  }

  /**
   * Lists pinned clips, stably sorted by pinnedAt DESC, createdAt DESC, id DESC.
   */
  async listPinned(options?: ListPinnedClipsOptions): Promise<Clip[]> {
    const limit = validateLimit(options?.limit);
    const offset = validateOffset(options?.offset);

    const where: Prisma.ClipWhereInput = {
      pinnedAt: { not: null },
    };

    if (options?.contentType !== undefined) {
      where.contentType = validateContentType(options.contentType);
    }

    return this.prisma.clip.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Pins a clip by setting its pinnedAt timestamp.
   *
   * Returns the updated Clip if found.
   * Returns null if no record exists with the specified ID (does not silently succeed).
   */
  async pin(id: string, pinnedAt: Date = new Date()): Promise<Clip | null> {
    const validId = validateId(id);
    const validPinnedAt = validateDate(pinnedAt, 'pinnedAt');

    try {
      return await this.prisma.clip.update({
        where: { id: validId },
        data: { pinnedAt: validPinnedAt },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Unpins a clip by clearing its pinnedAt timestamp.
   *
   * Returns the updated Clip if found.
   * Returns null if no record exists with the specified ID (does not silently succeed).
   */
  async unpin(id: string): Promise<Clip | null> {
    const validId = validateId(id);

    try {
      return await this.prisma.clip.update({
        where: { id: validId },
        data: { pinnedAt: null },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Deletes a clip record by ID.
   *
   * Returns true if the clip was found and deleted.
   * Returns false if no record exists with the specified ID (does not silently report success).
   */
  async delete(id: string): Promise<boolean> {
    const validId = validateId(id);

    try {
      await this.prisma.clip.delete({
        where: { id: validId },
      });
      return true;
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Deletes expired clips where expiresAt <= referenceDate.
   *
   * Unexpired clips (expiresAt > referenceDate or expiresAt IS NULL) and
   * pinned clips (pinnedAt IS NOT NULL) are preserved.
   *
   * Returns the count of deleted records.
   */
  async deleteExpired(referenceDate: Date = new Date()): Promise<number> {
    const validDate = validateDate(referenceDate, 'referenceDate');

    const result = await this.prisma.clip.deleteMany({
      where: {
        expiresAt: {
          not: null,
          lte: validDate,
        },
        pinnedAt: null,
      },
    });

    return result.count;
  }

  /**
   * Deletes all clips or all unpinned clips from the database.
   *
   * Only deletes records from the Clip table. Snippets and AppSettings are untouched.
   * Returns the count of deleted records.
   */
  async deleteAll(options?: { unpinnedOnly?: boolean }): Promise<number> {
    const where: Prisma.ClipWhereInput = {};
    if (options?.unpinnedOnly) {
      where.pinnedAt = null;
    }

    const result = await this.prisma.clip.deleteMany({ where });
    return result.count;
  }
}

export function createClipRepository(prisma: PrismaClient): ClipRepository {
  return new ClipRepository(prisma);
}
