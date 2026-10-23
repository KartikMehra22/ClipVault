/**
 * ClipOrbit — Secure Clipboard IPC Handlers
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 *
 * Implements narrowly scoped, sender-validated IPC handlers for clipboard operations.
 * Protects against unauthorized frames, child frames, and post-shutdown invocation.
 */

import { ipcMain, clipboard, type IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  type ClipboardStatusDto,
  type CapturedClipDto,
  type PersistedClipDto,
  type PersistedClipsResult,
  type ClearHistoryResult,
} from '@cliporbit/contracts';
import {
  getClipboardCaptureService,
  type ClipboardCaptureService,
  type ClipboardCaptureStatus,
  type CapturedTextItem,
  getEncryptedClipboardPersistenceService,
  type EncryptedClipboardPersistenceService,
  type DecryptedClipRecord,
  classifyText,
} from '../services/clipboard';

export interface ClipboardIpcOptions {
  captureService?: ClipboardCaptureService;
  persistenceService?: EncryptedClipboardPersistenceService;
  isAuthorized?: (event: IpcMainInvokeEvent) => boolean;
  isShutdown?: () => boolean;
  clipboardWriter?: (text: string) => void;
  clipboardImageWriter?: (dataUrl: string) => void;
}

/**
 * Serializes internal in-memory capture status into a safe DTO for renderer transport.
 * Strictly redacts internal fingerprints, buffers, and system handles.
 */
export function serializeClipboardStatus(status: ClipboardCaptureStatus): ClipboardStatusDto {
  return {
    isRunning: Boolean(status.isRunning),
    isPaused: Boolean(status.isPaused),
    itemCount: Number(status.itemCount),
    totalByteLength: Number(status.totalByteLength),
    skippedOversizedCount: Number(status.skippedOversizedCount),
    skippedSensitiveCount: Number(status.skippedSensitiveCount),
    lastDetectedAt: status.lastDetectedAt ? status.lastDetectedAt.toISOString() : null,
  };
}

/**
 * Serializes internal captured items into safe DTOs for renderer transport.
 * Strictly redacts internal fingerprints, buffers, and system handles.
 */
export function serializeCapturedClips(items: CapturedTextItem[]): CapturedClipDto[] {
  return items.map((item) => ({
    id: String(item.id),
    text: String(item.text),
    detectedAt:
      item.detectedAt instanceof Date
        ? item.detectedAt.toISOString()
        : new Date(item.detectedAt).toISOString(),
    byteLength: Number(item.byteLength),
    category: item.category,
  }));
}

/**
 * Serializes internal decrypted persisted records into safe DTOs for renderer transport.
 * Strictly omits database entities, raw ciphertext, nonces, authentication tags, and encryption keys.
 */
export function serializePersistedClips(clips: DecryptedClipRecord[]): PersistedClipDto[] {
  return clips.map((clip) => ({
    id: String(clip.id),
    text: String(clip.text),
    createdAt:
      clip.createdAt instanceof Date
        ? clip.createdAt.toISOString()
        : new Date(clip.createdAt).toISOString(),
    byteLength: Number(clip.byteLength),
    category:
      clip.contentType.startsWith('image/') || clip.text.startsWith('data:image/')
        ? 'image'
        : classifyText(clip.text),
    isPinned: Boolean(clip.isPinned),
    sourceApp: clip.sourceApp ?? null,
  }));
}

/**
 * Creates pure handler functions for clipboard IPC operations.
 * Allows deterministic unit testing with mock events and fake services.
 */
export function createClipboardIpcHandlers(options?: ClipboardIpcOptions) {
  const getService = () => options?.captureService ?? getClipboardCaptureService();
  const getPersistence = () =>
    options?.persistenceService ?? getEncryptedClipboardPersistenceService();

  function validateRequest(event: IpcMainInvokeEvent): void {
    if (options?.isShutdown && options.isShutdown()) {
      throw new Error('Application is shutting down; clipboard operation rejected.');
    }

    if (options?.isAuthorized && !options.isAuthorized(event)) {
      console.warn(
        '[ClipOrbit Main] Security Warning: Rejected unauthorized clipboard IPC request from:',
        event.senderFrame?.url || '<unknown>',
      );
      throw new Error('Unauthorized IPC sender origin or frame.');
    }
  }

  return {
    handleStartCapture: async (event: IpcMainInvokeEvent): Promise<ClipboardStatusDto> => {
      validateRequest(event);
      const service = getService();
      await service.start();
      return serializeClipboardStatus(service.getStatus());
    },

    handlePauseCapture: (event: IpcMainInvokeEvent): ClipboardStatusDto => {
      validateRequest(event);
      const service = getService();
      service.pause();
      return serializeClipboardStatus(service.getStatus());
    },

    handleResumeCapture: async (event: IpcMainInvokeEvent): Promise<ClipboardStatusDto> => {
      validateRequest(event);
      const service = getService();
      await service.resume();
      return serializeClipboardStatus(service.getStatus());
    },

    handleStopCapture: (event: IpcMainInvokeEvent): ClipboardStatusDto => {
      validateRequest(event);
      const service = getService();
      service.stop();
      return serializeClipboardStatus(service.getStatus());
    },

    handleGetCaptureStatus: (event: IpcMainInvokeEvent): ClipboardStatusDto => {
      validateRequest(event);
      const service = getService();
      return serializeClipboardStatus(service.getStatus());
    },

    handleGetRecentClips: (event: IpcMainInvokeEvent): CapturedClipDto[] => {
      validateRequest(event);
      const service = getService();
      return serializeCapturedClips(service.getRecentItems());
    },

    handleGetPersistedClips: async (
      event: IpcMainInvokeEvent,
      limit?: unknown,
    ): Promise<PersistedClipsResult> => {
      validateRequest(event);

      let validatedLimit = 50;
      if (limit !== undefined && limit !== null) {
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) {
          throw new Error('Limit must be an integer between 1 and 100.');
        }
        validatedLimit = limit;
      }

      const persistence = getPersistence();
      if (!persistence) {
        return {
          success: false,
          error: 'Encrypted persistence service is unavailable.',
        };
      }

      try {
        const result = await persistence.getRecentClips({ limit: validatedLimit });
        return {
          success: true,
          clips: serializePersistedClips(result.clips),
        };
      } catch {
        console.error('[ClipOrbit Main] Failed to query persisted clips from database.');
        return {
          success: false,
          error: 'Failed to retrieve saved clipboard history from local storage.',
        };
      }
    },

    handlePinClip: async (
      event: IpcMainInvokeEvent,
      id: unknown,
      isPinned: unknown,
    ): Promise<boolean> => {
      validateRequest(event);

      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('ID must be a non-empty string.');
      }
      if (typeof isPinned !== 'boolean') {
        throw new Error('isPinned must be a boolean.');
      }

      const persistence = getPersistence();
      if (!persistence) {
        return false;
      }

      try {
        if (isPinned) {
          return await persistence.pinClip(id.trim());
        } else {
          return await persistence.unpinClip(id.trim());
        }
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Database pin operation failed.');
      }
    },

    handleDeleteClip: async (event: IpcMainInvokeEvent, id: unknown): Promise<boolean> => {
      validateRequest(event);

      if (typeof id !== 'string' || id.trim().length === 0) {
        throw new Error('ID must be a non-empty string.');
      }

      const cleanId = id.trim();

      // Remove from database first if persistence service is available
      const persistence = getPersistence();
      let removedFromDb = false;
      if (persistence) {
        try {
          removedFromDb = await persistence.deleteClip(cleanId);
        } catch (error) {
          throw new Error(
            error instanceof Error ? error.message : 'Database delete operation failed.',
          );
        }
      }

      // Remove from active in-memory session if present
      const service = getService();
      const removedFromMemory = service.removeItem(cleanId);

      return removedFromMemory || removedFromDb;
    },

    handleClearHistory: async (event: IpcMainInvokeEvent): Promise<ClearHistoryResult> => {
      validateRequest(event);

      const persistence = getPersistence();
      if (!persistence) {
        return {
          success: false,
          error: 'Local database storage is unavailable; cannot clear persisted history.',
        };
      }

      let clearedCount = 0;
      try {
        clearedCount = await persistence.clearAllClips();
      } catch {
        console.error('[ClipOrbit Main] Failed to clear persisted clips from database.');
        return {
          success: false,
          error: 'Failed to clear saved clipboard history from local storage.',
        };
      }

      // Clear in-memory session history
      const service = getService();
      service.clearHistory();

      return {
        success: true,
        clearedCount,
      };
    },

    handleWriteClipboardText: (event: IpcMainInvokeEvent, text: unknown): boolean => {
      validateRequest(event);

      if (typeof text !== 'string') {
        throw new Error('Clipboard text must be a string.');
      }

      if (options?.clipboardWriter) {
        options.clipboardWriter(text);
        return true;
      }

      if (clipboard && typeof clipboard.writeText === 'function') {
        clipboard.writeText(text);
        return true;
      }

      throw new Error('Clipboard writer is unavailable in this environment.');
    },

    handleWriteClipboardImage: async (event: IpcMainInvokeEvent, dataUrl: unknown): Promise<boolean> => {
      validateRequest(event);

      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        throw new Error('Clipboard image must be a valid data URL.');
      }

      if (options?.clipboardImageWriter) {
        options.clipboardImageWriter(dataUrl);
        return true;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cb = clipboard as any;
      if (cb) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const electron = require('electron');

          // Method A: Modern Electron 44 W3C Clipboard API (cb.write([item]))
          if (typeof cb.write === 'function' && electron.ClipboardItem) {
            const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              const mimeType = match[1];
              const buffer = Buffer.from(match[2], 'base64');
              const blob = new Blob([buffer], { type: mimeType });
              const item = new electron.ClipboardItem({ [mimeType]: blob });
              await cb.write([item]);
              return true;
            }
          }

          // Method B: Legacy Electron NativeImage API (cb.writeImage(img))
          if (typeof cb.writeImage === 'function' && electron.nativeImage) {
            const img = electron.nativeImage.createFromDataURL(dataUrl);
            if (!img.isEmpty()) {
              cb.writeImage(img);
              return true;
            }
          }
        } catch {
          return false;
        }
      }

      throw new Error('Clipboard image writer is unavailable in this environment.');
    },
  };
}

/**
 * Registers clipboard IPC handlers with Electron's ipcMain.
 */
export function registerClipboardIpcHandlers(options?: ClipboardIpcOptions): void {
  const handlers = createClipboardIpcHandlers(options);

  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_START, handlers.handleStartCapture);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_PAUSE, handlers.handlePauseCapture);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_RESUME, handlers.handleResumeCapture);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_STOP, handlers.handleStopCapture);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_GET_STATUS, handlers.handleGetCaptureStatus);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_GET_RECENT, handlers.handleGetRecentClips);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_GET_PERSISTED, (event, limit) =>
    handlers.handleGetPersistedClips(event, limit),
  );
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_PIN, (event, id, isPinned) =>
    handlers.handlePinClip(event, id, isPinned),
  );
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_DELETE, (event, id) =>
    handlers.handleDeleteClip(event, id),
  );
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_CLEAR, handlers.handleClearHistory);
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_TEXT, (event, text) =>
    handlers.handleWriteClipboardText(event, text),
  );
  ipcMain.handle(IPC_CHANNELS.CLIPBOARD_WRITE_IMAGE, (event, dataUrl) =>
    handlers.handleWriteClipboardImage(event, dataUrl),
  );

  console.log('[ClipOrbit Main] Registered secure clipboard IPC handlers.');
}
