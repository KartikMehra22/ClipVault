/**
 * ClipOrbit — Snippet IPC Contract Definitions
 * Local MVP Functional Completeness
 */

export interface SnippetDto {
  id: string;
  title: string;
  description: string | null;
  language: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSnippetInputDto {
  title: string;
  content: string;
  description?: string | null;
  language?: string | null;
}

export interface UpdateSnippetInputDto {
  id: string;
  title?: string;
  content?: string;
  description?: string | null;
  language?: string | null;
}

export interface SnippetsResult {
  success: boolean;
  snippets?: SnippetDto[];
  error?: string;
}

export interface SnippetMutationResult {
  success: boolean;
  snippet?: SnippetDto;
  error?: string;
}
