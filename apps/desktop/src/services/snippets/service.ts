/**
 * ClipOrbit — Encrypted Snippet Persistence Service
 * Local MVP Functional Completeness
 *
 * Provides safe, authenticated persistence and retrieval of reusable snippets
 * using AES-256-GCM payload encryption and SQLite database storage.
 *
 * PRIVACY AND SECURITY GUARANTEES:
 * 1. Plaintext snippet content is NEVER stored in the database.
 * 2. Payloads are strictly encrypted at the application service boundary using AES-256-GCM.
 * 3. Text content is strictly validated against a 64 KiB UTF-8 maximum length bound.
 * 4. Corrupted records fail closed and are excluded from snippet listing.
 * 5. Snippets are stored independently of clipboard history; clipboard history clearing
 *    never deletes or modifies snippet records.
 * 6. No keys, raw ciphertext dumps, or sensitive internal values are leaked in logs.
 */

import { type SnippetRepository, createSnippetRepository } from '@cliporbit/database';

import {
  toSnippetEncryptionFields,
  fromSnippetRecord,
  type EncryptedPayload,
  type DecryptPayloadInput,
  CryptoError,
  getEncryptionService,
} from '../crypto';
import { getDatabaseClient } from '../database';
import {
  type DecryptedSnippetRecord,
  type CreateSnippetOptions,
  type UpdateSnippetOptions,
  type ListSnippetsOptions,
  SnippetError,
  SnippetValidationError,
  SnippetEncryptionError,
} from './types';

export const MAX_SNIPPET_CONTENT_BYTES = 64 * 1024; // 64 KiB

export interface EncryptedSnippetServiceDependencies {
  snippetRepository?: SnippetRepository;
  encrypt?: (plaintext: Buffer) => EncryptedPayload;
  decrypt?: (input: DecryptPayloadInput) => Buffer;
}

export class EncryptedSnippetService {
  private repository: SnippetRepository | null = null;
  private readonly customEncrypt?: (plaintext: Buffer) => EncryptedPayload;
  private readonly customDecrypt?: (input: DecryptPayloadInput) => Buffer;

  constructor(dependencies?: EncryptedSnippetServiceDependencies) {
    if (dependencies?.snippetRepository) {
      this.repository = dependencies.snippetRepository;
    }
    this.customEncrypt = dependencies?.encrypt;
    this.customDecrypt = dependencies?.decrypt;
  }

  private getRepository(): SnippetRepository {
    if (this.repository) {
      return this.repository;
    }
    const client = getDatabaseClient();
    if (!client) {
      throw new SnippetError('Database client is not initialized.');
    }
    this.repository = createSnippetRepository(client);
    return this.repository;
  }

  private performEncryption(plaintext: Buffer): EncryptedPayload {
    if (this.customEncrypt) {
      return this.customEncrypt(plaintext);
    }
    const encryptionService = getEncryptionService();
    if (!encryptionService || !encryptionService.isReady()) {
      throw new SnippetEncryptionError('Encryption service is not initialized or ready.');
    }
    try {
      return encryptionService.encrypt(plaintext);
    } catch (err) {
      if (err instanceof CryptoError) {
        throw new SnippetEncryptionError(err.message);
      }
      throw new SnippetEncryptionError();
    }
  }

  private performDecryption(input: DecryptPayloadInput): Buffer {
    if (this.customDecrypt) {
      return this.customDecrypt(input);
    }
    const encryptionService = getEncryptionService();
    if (!encryptionService || !encryptionService.isReady()) {
      throw new SnippetError('Encryption service is not initialized or ready.');
    }
    return encryptionService.decrypt(input);
  }

  /**
   * Creates a new snippet with encrypted content payload.
   */
  async createSnippet(options: CreateSnippetOptions): Promise<DecryptedSnippetRecord> {
    if (!options || typeof options !== 'object') {
      throw new SnippetValidationError('Options must be an object.');
    }

    if (typeof options.title !== 'string' || options.title.trim().length === 0) {
      throw new SnippetValidationError('Snippet title is required and cannot be empty.');
    }
    const cleanTitle = options.title.trim();
    if (cleanTitle.length > 256) {
      throw new SnippetValidationError('Snippet title must not exceed 256 characters.');
    }

    if (typeof options.content !== 'string' || options.content.length === 0) {
      throw new SnippetValidationError('Snippet content is required and cannot be empty.');
    }

    const contentBuffer = Buffer.from(options.content, 'utf-8');
    if (contentBuffer.byteLength > MAX_SNIPPET_CONTENT_BYTES) {
      throw new SnippetValidationError(
        `Snippet content exceeds maximum allowed size of ${MAX_SNIPPET_CONTENT_BYTES} bytes.`,
      );
    }

    const cleanDescription =
      typeof options.description === 'string' && options.description.trim().length > 0
        ? options.description.trim().slice(0, 1024)
        : null;

    const cleanLanguage =
      typeof options.language === 'string' && options.language.trim().length > 0
        ? options.language.trim().toLowerCase().slice(0, 128)
        : null;

    const encrypted = this.performEncryption(contentBuffer);
    const encryptionFields = toSnippetEncryptionFields(encrypted);

    const repo = this.getRepository();
    const created = await repo.create({
      title: cleanTitle,
      description: cleanDescription,
      language: cleanLanguage,
      ...encryptionFields,
    });

    return {
      id: created.id,
      title: created.title,
      description: created.description,
      language: created.language,
      content: options.content,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    };
  }

  /**
   * Lists snippets with optional filtering and pagination.
   * Corrupted records fail closed and are safely omitted from results.
   */
  async listSnippets(options?: ListSnippetsOptions): Promise<DecryptedSnippetRecord[]> {
    const repo = this.getRepository();
    const records = await repo.list(options);

    const decryptedList: DecryptedSnippetRecord[] = [];

    for (const record of records) {
      try {
        const decryptInput = fromSnippetRecord(record);
        const decryptedBuf = this.performDecryption(decryptInput);
        decryptedList.push({
          id: record.id,
          title: record.title,
          description: record.description,
          language: record.language,
          content: decryptedBuf.toString('utf-8'),
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        });
      } catch {
        // Safe fail-closed: omit corrupted snippet without leaking secrets or crashing
        console.warn(
          `[ClipOrbit Snippets] Failed to decrypt snippet with ID ${record.id}; omitting corrupted record.`,
        );
      }
    }

    return decryptedList;
  }

  /**
   * Updates an existing snippet's metadata or encrypted content.
   */
  async updateSnippet(options: UpdateSnippetOptions): Promise<DecryptedSnippetRecord | null> {
    if (!options || typeof options !== 'object') {
      throw new SnippetValidationError('Options must be an object.');
    }

    if (typeof options.id !== 'string' || options.id.trim().length === 0) {
      throw new SnippetValidationError('Snippet ID is required.');
    }
    const cleanId = options.id.trim();

    const repo = this.getRepository();
    const existing = await repo.findById(cleanId);
    if (!existing) {
      return null;
    }

    let updatedContent = options.content;
    let encryptionFields = {};

    if (options.content !== undefined) {
      if (typeof options.content !== 'string' || options.content.length === 0) {
        throw new SnippetValidationError('Snippet content cannot be empty if specified.');
      }
      const contentBuffer = Buffer.from(options.content, 'utf-8');
      if (contentBuffer.byteLength > MAX_SNIPPET_CONTENT_BYTES) {
        throw new SnippetValidationError(
          `Snippet content exceeds maximum allowed size of ${MAX_SNIPPET_CONTENT_BYTES} bytes.`,
        );
      }
      const encrypted = this.performEncryption(contentBuffer);
      encryptionFields = toSnippetEncryptionFields(encrypted);
    } else {
      // Content wasn't changed; decrypt existing content for return object
      const decryptInput = fromSnippetRecord(existing);
      updatedContent = this.performDecryption(decryptInput).toString('utf-8');
    }

    const updateInput: Parameters<SnippetRepository['update']>[1] = {
      ...encryptionFields,
    };

    if (options.title !== undefined) {
      if (typeof options.title !== 'string' || options.title.trim().length === 0) {
        throw new SnippetValidationError('Snippet title cannot be empty if specified.');
      }
      updateInput.title = options.title.trim().slice(0, 256);
    }

    if (options.description !== undefined) {
      updateInput.description =
        options.description === null || options.description.trim().length === 0
          ? null
          : options.description.trim().slice(0, 1024);
    }

    if (options.language !== undefined) {
      updateInput.language =
        options.language === null || options.language.trim().length === 0
          ? null
          : options.language.trim().toLowerCase().slice(0, 128);
    }

    const updated = await repo.update(cleanId, updateInput);
    if (!updated) {
      return null;
    }

    return {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      language: updated.language,
      content: updatedContent!,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }

  /**
   * Deletes a snippet by ID.
   */
  async deleteSnippet(id: string): Promise<boolean> {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new SnippetValidationError('Snippet ID must be a non-empty string.');
    }
    const repo = this.getRepository();
    return repo.delete(id.trim());
  }
}

// ---------------------------------------------------------------------------
// Singleton Instance Management
// ---------------------------------------------------------------------------

let defaultSnippetService: EncryptedSnippetService | null = null;

export function getEncryptedSnippetService(): EncryptedSnippetService {
  if (!defaultSnippetService) {
    defaultSnippetService = new EncryptedSnippetService();
  }
  return defaultSnippetService;
}

export function setEncryptedSnippetServiceForTesting(
  service: EncryptedSnippetService | null,
): void {
  defaultSnippetService = service;
}
