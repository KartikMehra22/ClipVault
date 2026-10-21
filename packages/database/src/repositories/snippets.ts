import { Prisma, PrismaClient, type Snippet } from '@prisma/client';
import { DatabaseValidationError, isRecordNotFoundError } from '../errors';

export interface CreateSnippetInput {
  /** Optional custom ID; if omitted, Prisma generates a UUID. */
  id?: string;

  /** Required human-readable snippet title. */
  title: string;

  /** Optional snippet description or usage notes. */
  description?: string | null;

  /** Optional programming or markup language identifier (e.g. "typescript", "markdown"). */
  language?: string | null;

  /**
   * Encrypted binary snippet content.
   *
   * Plaintext snippet bodies MUST NOT be written to disk. Must be binary data
   * encrypted at the application service boundary.
   */
  encryptedContent: Buffer | Uint8Array;

  /** Cryptographic nonce/IV used during content encryption. */
  encryptionNonce: Buffer | Uint8Array;

  /** Optional authentication tag (e.g. for AES-GCM or Poly1305). */
  encryptionAuthTag?: Buffer | Uint8Array | null;

  /** Encryption algorithm/key scheme version (defaults to 1). */
  encryptionVersion?: number;

  /** Optional creation timestamp (useful for deterministic tests). Defaults to now. */
  createdAt?: Date;
}

export interface UpdateSnippetInput {
  /** Updated snippet title. */
  title?: string;

  /** Updated description (or null to clear). */
  description?: string | null;

  /** Updated language identifier (or null to clear). */
  language?: string | null;

  /** Updated encrypted binary content. */
  encryptedContent?: Buffer | Uint8Array;

  /** Updated cryptographic nonce. */
  encryptionNonce?: Buffer | Uint8Array;

  /** Updated authentication tag (or null to clear). */
  encryptionAuthTag?: Buffer | Uint8Array | null;

  /** Updated encryption version. */
  encryptionVersion?: number;
}

export interface ListSnippetsOptions {
  /** Maximum number of records to return. Must be between 1 and 100 (defaults to 50). */
  limit?: number;

  /** Number of records to skip for offset pagination. Must be a non-negative integer. */
  offset?: number;

  /** Optional filter by programming or markup language. */
  language?: string;
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

function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new DatabaseValidationError('Snippet title must be a non-empty string.');
  }
  const trimmed = title.trim();
  if (trimmed.length > 256) {
    throw new DatabaseValidationError('Snippet title must not exceed 256 characters.');
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

export class SnippetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a new snippet with encrypted content.
   */
  async create(input: CreateSnippetInput): Promise<Snippet> {
    if (!input || typeof input !== 'object') {
      throw new DatabaseValidationError('CreateSnippetInput must be an object.');
    }

    const title = validateTitle(input.title);
    const encryptedContent = toBinary(input.encryptedContent, 'encryptedContent');
    const encryptionNonce = toBinary(input.encryptionNonce, 'encryptionNonce');
    const encryptionAuthTag = toOptionalBinary(input.encryptionAuthTag, 'encryptionAuthTag');
    const encryptionVersion = validateEncryptionVersion(input.encryptionVersion);

    const description =
      typeof input.description === 'string' && input.description.trim().length > 0
        ? input.description.trim().slice(0, 1024)
        : null;

    const language =
      typeof input.language === 'string' && input.language.trim().length > 0
        ? input.language.trim().slice(0, 128)
        : null;

    const createdAt =
      input.createdAt instanceof Date && !isNaN(input.createdAt.getTime())
        ? input.createdAt
        : undefined;

    const data: Prisma.SnippetCreateInput = {
      title,
      description,
      language,
      encryptedContent,
      encryptionNonce,
      encryptionAuthTag,
      encryptionVersion,
      ...(createdAt ? { createdAt } : {}),
    };

    if (input.id !== undefined) {
      data.id = validateId(input.id);
    }

    return this.prisma.snippet.create({ data });
  }

  /**
   * Fetches a single snippet by its ID.
   *
   * Returns the Snippet if found, or null if not found.
   */
  async findById(id: string): Promise<Snippet | null> {
    const validId = validateId(id);
    return this.prisma.snippet.findUnique({
      where: { id: validId },
    });
  }

  /**
   * Lists snippets with pagination and optional language filtering.
   *
   * Results are ordered stably by createdAt DESC, then id DESC.
   */
  async list(options?: ListSnippetsOptions): Promise<Snippet[]> {
    const limit = validateLimit(options?.limit);
    const offset = validateOffset(options?.offset);

    const where: Prisma.SnippetWhereInput = {};
    if (options?.language !== undefined && options.language.trim().length > 0) {
      where.language = options.language.trim();
    }

    return this.prisma.snippet.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  /**
   * Updates permitted metadata and encrypted content for an existing snippet.
   *
   * Returns the updated Snippet if found.
   * Returns null if no record exists with the specified ID (does not silently succeed).
   */
  async update(id: string, input: UpdateSnippetInput): Promise<Snippet | null> {
    const validId = validateId(id);

    if (!input || typeof input !== 'object') {
      throw new DatabaseValidationError('UpdateSnippetInput must be an object.');
    }

    const data: Prisma.SnippetUpdateInput = {};
    let hasUpdate = false;

    if (input.title !== undefined) {
      data.title = validateTitle(input.title);
      hasUpdate = true;
    }

    if (input.description !== undefined) {
      data.description =
        input.description === null || input.description.trim().length === 0
          ? null
          : input.description.trim().slice(0, 1024);
      hasUpdate = true;
    }

    if (input.language !== undefined) {
      data.language =
        input.language === null || input.language.trim().length === 0
          ? null
          : input.language.trim().slice(0, 128);
      hasUpdate = true;
    }

    if (input.encryptedContent !== undefined) {
      data.encryptedContent = toBinary(input.encryptedContent, 'encryptedContent');
      hasUpdate = true;
    }

    if (input.encryptionNonce !== undefined) {
      data.encryptionNonce = toBinary(input.encryptionNonce, 'encryptionNonce');
      hasUpdate = true;
    }

    if (input.encryptionAuthTag !== undefined) {
      data.encryptionAuthTag = toOptionalBinary(input.encryptionAuthTag, 'encryptionAuthTag');
      hasUpdate = true;
    }

    if (input.encryptionVersion !== undefined) {
      data.encryptionVersion = validateEncryptionVersion(input.encryptionVersion);
      hasUpdate = true;
    }

    if (!hasUpdate) {
      throw new DatabaseValidationError('At least one field must be supplied to update a snippet.');
    }

    try {
      return await this.prisma.snippet.update({
        where: { id: validId },
        data,
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Deletes a snippet record by ID.
   *
   * Returns true if found and deleted, or false if not found.
   */
  async delete(id: string): Promise<boolean> {
    const validId = validateId(id);

    try {
      await this.prisma.snippet.delete({
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
}

export function createSnippetRepository(prisma: PrismaClient): SnippetRepository {
  return new SnippetRepository(prisma);
}
