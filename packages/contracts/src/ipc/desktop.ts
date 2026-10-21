/**
 * Desktop IPC contract definitions for ClipOrbit
 */

export interface DesktopInfo {
  appName: string;
  appVersion: string;
  platform: string;
}

export interface DesktopBridge {
  getDesktopInfo(): Promise<DesktopInfo>;
}

export const IPC_CHANNELS = {
  APP_GET_DESKTOP_INFO: 'app:get-desktop-info',
} as const;
