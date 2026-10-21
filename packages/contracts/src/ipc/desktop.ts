/**
 * Desktop IPC contract definitions for ClipOrbit
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 */

import type { ClipboardStatusDto, CapturedClipDto } from './clipboard';

export interface DesktopInfo {
  appName: string;
  appVersion: string;
  platform: string;
}

export interface DesktopBridge {
  getDesktopInfo(): Promise<DesktopInfo>;
  startCapture(): Promise<ClipboardStatusDto>;
  pauseCapture(): Promise<ClipboardStatusDto>;
  resumeCapture(): Promise<ClipboardStatusDto>;
  stopCapture(): Promise<ClipboardStatusDto>;
  getCaptureStatus(): Promise<ClipboardStatusDto>;
  getRecentClips(): Promise<CapturedClipDto[]>;
}

export const IPC_CHANNELS = {
  APP_GET_DESKTOP_INFO: 'app:get-desktop-info',
  CLIPBOARD_START: 'clipboard:start',
  CLIPBOARD_PAUSE: 'clipboard:pause',
  CLIPBOARD_RESUME: 'clipboard:resume',
  CLIPBOARD_STOP: 'clipboard:stop',
  CLIPBOARD_GET_STATUS: 'clipboard:get-status',
  CLIPBOARD_GET_RECENT: 'clipboard:get-recent',
} as const;
