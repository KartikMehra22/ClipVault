import { contextBridge, ipcRenderer } from 'electron';
import type {
  DesktopBridge,
  DesktopInfo,
  ClipboardStatusDto,
  CapturedClipDto,
  PersistedClipsResult,
  ClearHistoryResult,
} from '@cliporbit/contracts';

// In sandboxed preload, keep imports type-only to avoid runtime node_modules resolution
const CHANNELS = {
  DESKTOP_INFO: 'app:get-desktop-info',
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
  GET_CLIPBOARD_PERSISTENCE: 'settings:get-clipboard-persistence',
  SET_CLIPBOARD_PERSISTENCE: 'settings:set-clipboard-persistence',
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
};

contextBridge.exposeInMainWorld('clipOrbit', desktopBridge);
