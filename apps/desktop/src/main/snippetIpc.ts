/**
 * ClipOrbit — Secure Snippet IPC Handlers
 * Local MVP Functional Completeness
 *
 * Implements sender-validated IPC handlers for encrypted snippet operations.
 * Protects against unauthorized frames, child frames, and post-shutdown invocation.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type SnippetDto,
  type SnippetsResult,
  type SnippetMutationResult,
} from '@cliporbit/contracts';
import {
  getEncryptedSnippetService,
  type EncryptedSnippetService,
  type DecryptedSnippetRecord,
  SnippetValidationError,
} from '../services/snippets';

export interface SnippetIpcOptions {
  snippetService?: EncryptedSnippetService;
  isAuthorized?: (event: IpcMainInvokeEvent) => boolean;
  isShutdown?: () => boolean;
}

/**
 * Serializes internal decrypted snippet records into safe DTOs for renderer transport.
 * Strictly omits database entities, raw ciphertext, nonces, and auth tags.
 */
export function serializeSnippet(snippet: DecryptedSnippetRecord): SnippetDto {
  return {
    id: String(snippet.id),
    title: String(snippet.title),
    description: snippet.description ?? null,
    language: snippet.language ?? null,
    content: String(snippet.content),
    createdAt:
      snippet.createdAt instanceof Date
        ? snippet.createdAt.toISOString()
        : new Date(snippet.createdAt).toISOString(),
    updatedAt:
      snippet.updatedAt instanceof Date
        ? snippet.updatedAt.toISOString()
        : new Date(snippet.updatedAt).toISOString(),
  };
}

/**
 * Creates pure handler functions for snippet IPC operations.
 * Allows deterministic unit testing with mock events and fake services.
 */
export function createSnippetIpcHandlers(options?: SnippetIpcOptions) {
  const getService = () => options?.snippetService ?? getEncryptedSnippetService();

  function validateRequest(event: IpcMainInvokeEvent): void {
    if (options?.isShutdown && options.isShutdown()) {
      throw new Error('Application is shutting down; snippet operation rejected.');
    }

    if (options?.isAuthorized && !options.isAuthorized(event)) {
      console.warn(
        '[ClipOrbit Main] Security Warning: Rejected unauthorized snippet IPC request from:',
        event.senderFrame?.url || '<unknown>',
      );
      throw new Error('Unauthorized IPC sender origin or frame.');
    }
  }

  return {
    handleListSnippets: async (
      event: IpcMainInvokeEvent,
      queryOptions?: unknown,
    ): Promise<SnippetsResult> => {
      validateRequest(event);

      const filterOptions: { language?: string; limit?: number; offset?: number } = {};
      if (queryOptions && typeof queryOptions === 'object') {
        const raw = queryOptions as Record<string, unknown>;
        if (typeof raw.language === 'string' && raw.language.trim().length > 0) {
          filterOptions.language = raw.language.trim();
        }
      }

      try {
        const service = getService();
        const snippets = await service.listSnippets(filterOptions);
        return {
          success: true,
          snippets: snippets.map(serializeSnippet),
        };
      } catch {
        console.error('[ClipOrbit Main] Failed to query snippets from local database.');
        return {
          success: false,
          error: 'Failed to retrieve snippets from local storage.',
        };
      }
    },

    handleCreateSnippet: async (
      event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<SnippetMutationResult> => {
      validateRequest(event);

      if (!input || typeof input !== 'object') {
        return {
          success: false,
          error: 'Invalid snippet input payload.',
        };
      }

      const raw = input as Record<string, unknown>;
      if (typeof raw.title !== 'string' || raw.title.trim().length === 0) {
        return {
          success: false,
          error: 'Snippet title is required and cannot be empty.',
        };
      }
      if (typeof raw.content !== 'string' || raw.content.length === 0) {
        return {
          success: false,
          error: 'Snippet content is required and cannot be empty.',
        };
      }

      try {
        const service = getService();
        const created = await service.createSnippet({
          title: raw.title.trim(),
          content: raw.content,
          description: typeof raw.description === 'string' ? raw.description : null,
          language: typeof raw.language === 'string' ? raw.language : null,
        });

        return {
          success: true,
          snippet: serializeSnippet(created),
        };
      } catch (err) {
        if (err instanceof SnippetValidationError) {
          return {
            success: false,
            error: err.message,
          };
        }
        console.error('[ClipOrbit Main] Failed to create snippet in local storage.');
        return {
          success: false,
          error: 'Failed to save snippet to local storage.',
        };
      }
    },

    handleUpdateSnippet: async (
      event: IpcMainInvokeEvent,
      input: unknown,
    ): Promise<SnippetMutationResult> => {
      validateRequest(event);

      if (!input || typeof input !== 'object') {
        return {
          success: false,
          error: 'Invalid snippet update payload.',
        };
      }

      const raw = input as Record<string, unknown>;
      if (typeof raw.id !== 'string' || raw.id.trim().length === 0) {
        return {
          success: false,
          error: 'Snippet ID is required.',
        };
      }

      try {
        const service = getService();
        const updated = await service.updateSnippet({
          id: raw.id.trim(),
          title: typeof raw.title === 'string' ? raw.title : undefined,
          content: typeof raw.content === 'string' ? raw.content : undefined,
          description: typeof raw.description === 'string' ? raw.description : undefined,
          language: typeof raw.language === 'string' ? raw.language : undefined,
        });

        if (!updated) {
          return {
            success: false,
            error: 'Snippet record not found.',
          };
        }

        return {
          success: true,
          snippet: serializeSnippet(updated),
        };
      } catch (err) {
        if (err instanceof SnippetValidationError) {
          return {
            success: false,
            error: err.message,
          };
        }
        console.error('[ClipOrbit Main] Failed to update snippet in local storage.');
        return {
          success: false,
          error: 'Failed to update snippet in local storage.',
        };
      }
    },

    handleDeleteSnippet: async (event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => {
      validateRequest(event);

      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('Snippet ID must be a non-empty string.');
      }

      try {
        const service = getService();
        return await service.deleteSnippet(id.trim());
      } catch {
        console.error('[ClipOrbit Main] Failed to delete snippet from local storage.');
        return false;
      }
    },
  };
}

/**
 * Registers snippet IPC handlers with Electron's ipcMain.
 */
export function registerSnippetIpcHandlers(options?: SnippetIpcOptions): void {
  const handlers = createSnippetIpcHandlers(options);

  ipcMain.handle(IPC_CHANNELS.SNIPPETS_LIST, (event, queryOptions) =>
    handlers.handleListSnippets(event, queryOptions),
  );
  ipcMain.handle(IPC_CHANNELS.SNIPPETS_CREATE, (event, input) =>
    handlers.handleCreateSnippet(event, input),
  );
  ipcMain.handle(IPC_CHANNELS.SNIPPETS_UPDATE, (event, input) =>
    handlers.handleUpdateSnippet(event, input),
  );
  ipcMain.handle(IPC_CHANNELS.SNIPPETS_DELETE, (event, id) =>
    handlers.handleDeleteSnippet(event, id),
  );

  console.log('[ClipOrbit Main] Registered secure snippet IPC handlers.');
}
