/**
 * ClipOrbit — Secure Clipboard IPC Handlers
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 *
 * Implements narrowly scoped, sender-validated IPC handlers for clipboard operations.
 * Protects against unauthorized frames, child frames, and post-shutdown invocation.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type ClipboardStatusDto, type CapturedClipDto } from '@cliporbit/contracts';
import {
  getClipboardCaptureService,
  type ClipboardCaptureService,
  type ClipboardCaptureStatus,
  type CapturedTextItem,
} from '../services/clipboard';

export interface ClipboardIpcOptions {
  captureService?: ClipboardCaptureService;
  isAuthorized?: (event: IpcMainInvokeEvent) => boolean;
  isShutdown?: () => boolean;
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
 * Creates pure handler functions for clipboard IPC operations.
 * Allows deterministic unit testing with mock events and fake services.
 */
export function createClipboardIpcHandlers(options?: ClipboardIpcOptions) {
  const getService = () => options?.captureService ?? getClipboardCaptureService();

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

  console.log('[ClipOrbit Main] Registered secure clipboard IPC handlers.');
}
