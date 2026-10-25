import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridge,
  DesktopInfo,
  ClipboardStatusDto,
  CapturedClipDto,
  PersistedClipsResult,
  ClearHistoryResult,
  SnippetsResult,
  SnippetMutationResult,
  CreateSnippetInputDto,
  UpdateSnippetInputDto,
  SettingKey,
  AppSettingsDto,
} from '@cliporbit/contracts';

// In sandboxed preload, keep imports type-only to avoid runtime node_modules resolution
const CHANNELS = {
  DESKTOP_INFO: 'app:get-desktop-info',
  OPEN_EXTERNAL_URL: 'app:open-external-url',
  START_CAPTURE: 'clipboard:start',
  PAUSE_CAPTURE: 'clipboard:pause',
  RESUME_CAPTURE: 'clipboard:resume',
  STOP_CAPTURE: 'clipboard:stop',
  GET_STATUS: 'clipboard:get-status',
  GET_RECENT: 'clipboard:get-recent',
  GET_PERSISTED: 'clipboard:get-persisted',
  PIN_CLIP: 'clipboard:pin',
  DELETE_CLIP: 'clipboard:delete',
  CLEAR_HISTORY: 'clipboard:clear',
  WRITE_CLIPBOARD_TEXT: 'clipboard:write-text',
  WRITE_CLIPBOARD_IMAGE: 'clipboard:write-image',
  GET_CLIPBOARD_PERSISTENCE: 'settings:get-clipboard-persistence',
  SET_CLIPBOARD_PERSISTENCE: 'settings:set-clipboard-persistence',
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_SET_VALUE: 'settings:set-value',
  SETTINGS_GET_LAUNCH_AT_LOGIN: 'settings:get-launch-at-login',
  SETTINGS_SET_LAUNCH_AT_LOGIN: 'settings:set-launch-at-login',
  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_CREATE: 'snippets:create',
  SNIPPETS_UPDATE: 'snippets:update',
  SNIPPETS_DELETE: 'snippets:delete',
} as const;

const desktopBridge: DesktopBridge = {
  getDesktopInfo: async (): Promise<DesktopInfo> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.DESKTOP_INFO)) as DesktopInfo;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve desktop info from main process:', err);
      throw err;
    }
  },

  startCapture: async (): Promise<ClipboardStatusDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.START_CAPTURE)) as ClipboardStatusDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to start clipboard capture:', err);
      throw err;
    }
  },

  pauseCapture: async (): Promise<ClipboardStatusDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.PAUSE_CAPTURE)) as ClipboardStatusDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to pause clipboard capture:', err);
      throw err;
    }
  },

  resumeCapture: async (): Promise<ClipboardStatusDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.RESUME_CAPTURE)) as ClipboardStatusDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to resume clipboard capture:', err);
      throw err;
    }
  },

  stopCapture: async (): Promise<ClipboardStatusDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.STOP_CAPTURE)) as ClipboardStatusDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to stop clipboard capture:', err);
      throw err;
    }
  },

  getCaptureStatus: async (): Promise<ClipboardStatusDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.GET_STATUS)) as ClipboardStatusDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve clipboard capture status:', err);
      throw err;
    }
  },

  getRecentClips: async (): Promise<CapturedClipDto[]> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.GET_RECENT)) as CapturedClipDto[];
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve recent clips:', err);
      throw err;
    }
  },

  getPersistedClips: async (limit?: number): Promise<PersistedClipsResult> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.GET_PERSISTED, limit)) as PersistedClipsResult;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve persisted clips:', err);
      return {
        success: false,
        error: 'Failed to retrieve saved clipboard history from local storage.',
      };
    }
  },

  pinClip: async (id: string, isPinned: boolean): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.PIN_CLIP, id, isPinned)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to update clip pin status:', err);
      throw err;
    }
  },

  deleteClip: async (id: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.DELETE_CLIP, id)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to delete clip:', err);
      throw err;
    }
  },

  clearHistory: async (): Promise<ClearHistoryResult> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.CLEAR_HISTORY)) as ClearHistoryResult;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to clear clipboard history:', err);
      return {
        success: false,
        error: 'Failed to clear saved clipboard history from local storage.',
      };
    }
  },

  writeClipboardText: async (text: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.WRITE_CLIPBOARD_TEXT, text)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to write text to clipboard:', err);
      return false;
    }
  },

  writeClipboardImage: async (dataUrl: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.WRITE_CLIPBOARD_IMAGE, dataUrl)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to write image to clipboard:', err);
      return false;
    }
  },

  getClipboardPersistenceEnabled: async (): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.GET_CLIPBOARD_PERSISTENCE)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve clipboard persistence setting:', err);
      throw err;
    }
  },

  setClipboardPersistenceEnabled: async (enabled: boolean): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SET_CLIPBOARD_PERSISTENCE, enabled)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to update clipboard persistence setting:', err);
      throw err;
    }
  },

  getAllSettings: async (): Promise<AppSettingsDto> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SETTINGS_GET_ALL)) as AppSettingsDto;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve settings:', err);
      return {
        clipboardPersistenceEnabled: false,
        launchAtLogin: false,
        defaultView: 'history',
        excludePasswordManagers: true,
        maskDetectedSecrets: true,
        clearOnExit: false,
        maxHistorySize: 1000,
        retentionPeriod: '30',
      };
    }
  },

  setSetting: async (key: SettingKey, value: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SETTINGS_SET_VALUE, key, value)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to update setting:', err);
      throw err;
    }
  },

  getLaunchAtLogin: async (): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SETTINGS_GET_LAUNCH_AT_LOGIN)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve launch at login:', err);
      return false;
    }
  },

  setLaunchAtLogin: async (enabled: boolean): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SETTINGS_SET_LAUNCH_AT_LOGIN, enabled)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to update launch at login:', err);
      throw err;
    }
  },

  getSnippets: async (options?: { language?: string }): Promise<SnippetsResult> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SNIPPETS_LIST, options)) as SnippetsResult;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve snippets:', err);
      return {
        success: false,
        error: 'Failed to retrieve snippets from local storage.',
      };
    }
  },

  createSnippet: async (input: CreateSnippetInputDto): Promise<SnippetMutationResult> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SNIPPETS_CREATE, input)) as SnippetMutationResult;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to create snippet:', err);
      return {
        success: false,
        error: 'Failed to save snippet to local storage.',
      };
    }
  },

  updateSnippet: async (input: UpdateSnippetInputDto): Promise<SnippetMutationResult> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SNIPPETS_UPDATE, input)) as SnippetMutationResult;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to update snippet:', err);
      return {
        success: false,
        error: 'Failed to update snippet in local storage.',
      };
    }
  },

  deleteSnippet: async (id: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.SNIPPETS_DELETE, id)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to delete snippet:', err);
      return false;
    }
  },

  openExternalUrl: async (url: string): Promise<boolean> => {
    try {
      return (await ipcRenderer.invoke(CHANNELS.OPEN_EXTERNAL_URL, url)) as boolean;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to open external URL:', err);
      return false;
    }
  },
};

contextBridge.exposeInMainWorld('clipVault', desktopBridge);
contextBridge.exposeInMainWorld('clipOrbit', desktopBridge);
