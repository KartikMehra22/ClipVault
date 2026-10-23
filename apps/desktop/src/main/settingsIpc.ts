/**
 * ClipOrbit — Secure Settings IPC Handlers
 * Phase 6.3.2: Explicit Consent for Encrypted Clipboard Persistence
 *
 * Implements narrowly scoped, sender-validated IPC handlers for reading and updating
 * the local encrypted clipboard persistence consent setting.
 * Protects against unauthorized frames, child frames, and post-shutdown invocation.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS } from '@cliporbit/contracts';
import {
  getClipboardPersistencePolicy,
  type ClipboardPersistencePolicy,
} from '../services/clipboard';

export interface SettingsIpcOptions {
  policy?: ClipboardPersistencePolicy;
  isAuthorized?: (event: IpcMainInvokeEvent) => boolean;
  isShutdown?: () => boolean;
}

/**
 * Creates pure handler functions for settings IPC operations.
 * Enables deterministic testing with mock events and fake policies.
 */
export function createSettingsIpcHandlers(options?: SettingsIpcOptions) {
  const getPolicy = () => options?.policy ?? getClipboardPersistencePolicy();

  function validateRequest(event: IpcMainInvokeEvent): void {
    if (options?.isShutdown && options.isShutdown()) {
      throw new Error('Application is shutting down; settings operation rejected.');
    }

    if (options?.isAuthorized && !options.isAuthorized(event)) {
      console.warn(
        '[ClipOrbit Main] Security Warning: Rejected unauthorized settings IPC request from:',
        event.senderFrame?.url || '<unknown>',
      );
      throw new Error('Unauthorized IPC sender origin or frame.');
    }
  }

  return {
    handleGetClipboardPersistence: async (event: IpcMainInvokeEvent): Promise<boolean> => {
      validateRequest(event);
      const policy = getPolicy();
      return await policy.isPersistenceEnabled();
    },

    handleSetClipboardPersistence: async (
      event: IpcMainInvokeEvent,
      enabled: unknown,
    ): Promise<boolean> => {
      validateRequest(event);
      const policy = getPolicy();
      if (typeof enabled !== 'boolean') {
        try {
          await policy.setPersistenceEnabled(enabled as boolean);
        } catch {
          // Trigger in-memory fail-closed override on invalid mutation attempt
        }
        throw new Error('Invalid input: persistence preference must be a boolean.');
      }
      return await policy.setPersistenceEnabled(enabled);
    },
  };
}

/**
 * Registers settings IPC handlers with Electron's ipcMain.
 */
export function registerSettingsIpcHandlers(options?: SettingsIpcOptions): void {
  const handlers = createSettingsIpcHandlers(options);

  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET_CLIPBOARD_PERSISTENCE,
    handlers.handleGetClipboardPersistence,
  );
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_CLIPBOARD_PERSISTENCE,
    handlers.handleSetClipboardPersistence,
  );

  console.log('[ClipOrbit Main] Registered secure settings IPC handlers.');
}
