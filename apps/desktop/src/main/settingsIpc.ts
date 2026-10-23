/**
 * ClipOrbit — Secure Settings IPC Handlers
 * Phase 6.3.2 & Release Settings: Application Preferences, Persistence, and Retention
 *
 * Implements narrowly scoped, sender-validated IPC handlers for reading and updating
 * local settings, persistence consent, startup configuration, and retention limits.
 * Protects against unauthorized frames, child frames, and post-shutdown invocation.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  IPC_CHANNELS,
  SETTING_KEYS,
  type SettingKey,
  type AppSettingsDto,
} from '@cliporbit/contracts';
import {
  getClipboardPersistencePolicy,
  getEncryptedClipboardPersistenceService,
  type ClipboardPersistencePolicy,
} from '../services/clipboard';
import { getDatabaseClient } from '../services/database';
import { createAppSettingRepository, type AppSettingRepository } from '@cliporbit/database';

function getElectronApp(): typeof import('electron').app | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null && 'app' in electron) {
      return electron.app;
    }
    return null;
  } catch {
    return null;
  }
}

export interface SettingsIpcOptions {
  policy?: ClipboardPersistencePolicy;
  repo?: AppSettingRepository;
  app?: typeof import('electron').app;
  isAuthorized?: (event: IpcMainInvokeEvent) => boolean;
  isShutdown?: () => boolean;
}

const VALID_SETTING_KEYS = new Set<string>(Object.values(SETTING_KEYS));

/**
 * Creates pure handler functions for settings IPC operations.
 * Enables deterministic testing with mock events and fake policies.
 */
export function createSettingsIpcHandlers(options?: SettingsIpcOptions) {
  const getPolicy = () => options?.policy ?? getClipboardPersistencePolicy();
  const getApp = () => options?.app ?? getElectronApp();

  const getRepo = (): AppSettingRepository | null => {
    if (options?.repo) {
      return options.repo;
    }
    const db = getDatabaseClient();
    if (!db) {
      return null;
    }
    return createAppSettingRepository(db);
  };

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

    handleGetLaunchAtLogin: async (event: IpcMainInvokeEvent): Promise<boolean> => {
      validateRequest(event);
      const app = getApp();
      if (app && typeof app.getLoginItemSettings === 'function') {
        try {
          return Boolean(app.getLoginItemSettings().openAtLogin);
        } catch {
          // Fall through to database repository check
        }
      }
      const repo = getRepo();
      if (repo) {
        const val = await repo.get(SETTING_KEYS.LAUNCH_AT_LOGIN);
        return val === 'true';
      }
      return false;
    },

    handleSetLaunchAtLogin: async (
      event: IpcMainInvokeEvent,
      enabled: unknown,
    ): Promise<boolean> => {
      validateRequest(event);
      if (typeof enabled !== 'boolean') {
        throw new Error('Invalid input: launch at login must be a boolean.');
      }

      const app = getApp();
      if (app && typeof app.setLoginItemSettings === 'function') {
        try {
          app.setLoginItemSettings({
            openAtLogin: enabled,
          });
        } catch (err) {
          console.warn('[ClipOrbit Main] Failed to set native login item settings:', err);
        }
      }

      const repo = getRepo();
      if (repo) {
        await repo.set(SETTING_KEYS.LAUNCH_AT_LOGIN, enabled ? 'true' : 'false');
      }
      return enabled;
    },

    handleGetAllSettings: async (event: IpcMainInvokeEvent): Promise<AppSettingsDto> => {
      validateRequest(event);
      const policy = getPolicy();
      const persistenceEnabled = await policy.isPersistenceEnabled();

      const app = getApp();
      let launchAtLogin = false;
      if (app && typeof app.getLoginItemSettings === 'function') {
        try {
          launchAtLogin = Boolean(app.getLoginItemSettings().openAtLogin);
        } catch {
          launchAtLogin = false;
        }
      }

      const repo = getRepo();
      if (!repo) {
        return {
          clipboardPersistenceEnabled: persistenceEnabled,
          launchAtLogin,
          defaultView: 'history',
          excludePasswordManagers: true,
          maskDetectedSecrets: true,
          clearOnExit: false,
          maxHistorySize: 1000,
          retentionPeriod: '30',
        };
      }

      try {
        const [
          storedLaunch,
          storedDefaultView,
          storedExcludeVaults,
          storedMaskSecrets,
          storedClearOnExit,
          storedMaxSize,
          storedRetention,
        ] = await Promise.all([
          repo.get(SETTING_KEYS.LAUNCH_AT_LOGIN),
          repo.get(SETTING_KEYS.DEFAULT_VIEW),
          repo.get(SETTING_KEYS.EXCLUDE_PASSWORD_MANAGERS),
          repo.get(SETTING_KEYS.MASK_DETECTED_SECRETS),
          repo.get(SETTING_KEYS.CLEAR_ON_EXIT),
          repo.get(SETTING_KEYS.MAX_HISTORY_SIZE),
          repo.get(SETTING_KEYS.RETENTION_PERIOD),
        ]);

        if (storedLaunch !== null) {
          launchAtLogin = storedLaunch === 'true';
        }

        const validViews = ['history', 'pinned', 'snippets', 'settings'] as const;
        const defaultView = validViews.includes(storedDefaultView as (typeof validViews)[number])
          ? (storedDefaultView as (typeof validViews)[number])
          : 'history';

        const excludePasswordManagers = storedExcludeVaults !== 'false';
        const maskDetectedSecrets = storedMaskSecrets !== 'false';
        const clearOnExit = storedClearOnExit === 'true';

        const parsedMaxSize = storedMaxSize ? parseInt(storedMaxSize, 10) : 1000;
        const maxHistorySize = Number.isFinite(parsedMaxSize) && parsedMaxSize > 0 ? parsedMaxSize : 1000;

        const retentionPeriod = storedRetention || '30';

        return {
          clipboardPersistenceEnabled: persistenceEnabled,
          launchAtLogin,
          defaultView,
          excludePasswordManagers,
          maskDetectedSecrets,
          clearOnExit,
          maxHistorySize,
          retentionPeriod,
        };
      } catch (err) {
        console.error('[ClipOrbit Main] Error loading settings:', err);
        return {
          clipboardPersistenceEnabled: persistenceEnabled,
          launchAtLogin,
          defaultView: 'history',
          excludePasswordManagers: true,
          maskDetectedSecrets: true,
          clearOnExit: false,
          maxHistorySize: 1000,
          retentionPeriod: '30',
        };
      }
    },

    handleSetSetting: async (
      event: IpcMainInvokeEvent,
      key: unknown,
      value: unknown,
    ): Promise<boolean> => {
      validateRequest(event);

      if (typeof key !== 'string' || !VALID_SETTING_KEYS.has(key)) {
        throw new Error(`Invalid setting key: "${String(key)}"`);
      }

      if (typeof value !== 'string') {
        throw new Error('Setting value must be a string.');
      }

      if (value.length > 1024) {
        throw new Error('Setting value exceeds maximum allowed length.');
      }

      const validKey = key as SettingKey;

      // Handle specific side effects
      if (validKey === SETTING_KEYS.CLIPBOARD_PERSISTENCE_ENABLED) {
        const policy = getPolicy();
        await policy.setPersistenceEnabled(value === 'true');
        return true;
      }

      if (validKey === SETTING_KEYS.LAUNCH_AT_LOGIN) {
        const app = getApp();
        if (app && typeof app.setLoginItemSettings === 'function') {
          try {
            app.setLoginItemSettings({
              openAtLogin: value === 'true',
            });
          } catch (err) {
            console.warn('[ClipOrbit Main] Failed to set native login item settings:', err);
          }
        }
      }

      const repo = getRepo();
      if (!repo) {
        throw new Error('Database repository is unavailable.');
      }

      await repo.set(validKey, value);

      // Perform maintenance if retention limits changed
      if (validKey === SETTING_KEYS.MAX_HISTORY_SIZE) {
        const size = parseInt(value, 10);
        if (Number.isFinite(size) && size > 0) {
          const persistence = getEncryptedClipboardPersistenceService();
          if (persistence) {
            void persistence.trimExcessClips(size);
          }
        }
      } else if (validKey === SETTING_KEYS.RETENTION_PERIOD && value !== 'never') {
        const days = parseInt(value, 10);
        if (Number.isFinite(days) && days > 0) {
          const persistence = getEncryptedClipboardPersistenceService();
          if (persistence) {
            void persistence.purgeOlderThan(days);
          }
        }
      }

      return true;
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
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_ALL, handlers.handleGetAllSettings);
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_VALUE,
    (event, key, value) => handlers.handleSetSetting(event, key, value),
  );
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_GET_LAUNCH_AT_LOGIN,
    handlers.handleGetLaunchAtLogin,
  );
  ipcMain.handle(
    IPC_CHANNELS.SETTINGS_SET_LAUNCH_AT_LOGIN,
    (event, enabled) => handlers.handleSetLaunchAtLogin(event, enabled),
  );

  console.log('[ClipOrbit Main] Registered secure settings IPC handlers.');
}

