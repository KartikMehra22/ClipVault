import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopBridge, DesktopInfo } from '@cliporbit/contracts';

// In sandboxed preload, keep imports type-only to avoid runtime node_modules resolution
const DESKTOP_INFO_CHANNEL = 'app:get-desktop-info';

const desktopBridge: DesktopBridge = {
  getDesktopInfo: async (): Promise<DesktopInfo> => {
    try {
      const info = (await ipcRenderer.invoke(DESKTOP_INFO_CHANNEL)) as DesktopInfo;
      return info;
    } catch (err) {
      console.error('[ClipOrbit Preload] Failed to retrieve desktop info from main process:', err);
      throw err;
    }
  },
};

contextBridge.exposeInMainWorld('clipOrbit', desktopBridge);
