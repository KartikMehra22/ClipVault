/**
 * ClipOrbit — Snippet Service Types and Errors
 * Local MVP Functional Completeness
 */

export interface DecryptedSnippetRecord {
  id: string;
  title: string;
  description: string | null;
  language: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSnippetOptions {
  title: string;
  content: string;
  description?: string | null;
  language?: string | null;
}

export interface UpdateSnippetOptions {
  id: string;
  title?: string;
  content?: string;
  description?: string | null;
  language?: string | null;
}

export interface ListSnippetsOptions {
  limit?: number;
  offset?: number;
  language?: string;
}

export class SnippetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnippetError';
  }
}

export class SnippetValidationError extends SnippetError {
  constructor(message: string) {
    super(message);
    this.name = 'SnippetValidationError';
  }
}

export class SnippetEncryptionError extends SnippetError {
  constructor(message = 'Failed to encrypt snippet content.') {
    super(message);
    this.name = 'SnippetEncryptionError';
  }
}

export class SnippetDecryptionError extends SnippetError {
  constructor(message = 'Failed to decrypt snippet content.') {
    super(message);
    this.name = 'SnippetDecryptionError';
  }
}
