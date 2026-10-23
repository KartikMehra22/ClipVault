/**
 * Desktop IPC contract definitions for ClipOrbit
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 */

import type {
  ClipboardStatusDto,
  CapturedClipDto,
  PersistedClipsResult,
  ClearHistoryResult,
} from './clipboard';
import type {
  CreateSnippetInputDto,
  UpdateSnippetInputDto,
  SnippetsResult,
  SnippetMutationResult,
} from './snippets';

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
  getPersistedClips(limit?: number): Promise<PersistedClipsResult>;
  pinClip(id: string, isPinned: boolean): Promise<boolean>;
  deleteClip(id: string): Promise<boolean>;
  clearHistory(): Promise<ClearHistoryResult>;
  writeClipboardText(text: string): Promise<boolean>;
  getClipboardPersistenceEnabled(): Promise<boolean>;
  setClipboardPersistenceEnabled(enabled: boolean): Promise<boolean>;
  getSnippets(options?: { language?: string }): Promise<SnippetsResult>;
  createSnippet(input: CreateSnippetInputDto): Promise<SnippetMutationResult>;
  updateSnippet(input: UpdateSnippetInputDto): Promise<SnippetMutationResult>;
  deleteSnippet(id: string): Promise<boolean>;
}

export const IPC_CHANNELS = {
  APP_GET_DESKTOP_INFO: 'app:get-desktop-info',
  CLIPBOARD_START: 'clipboard:start',
  CLIPBOARD_PAUSE: 'clipboard:pause',
  CLIPBOARD_RESUME: 'clipboard:resume',
  CLIPBOARD_STOP: 'clipboard:stop',
  CLIPBOARD_GET_STATUS: 'clipboard:get-status',
  CLIPBOARD_GET_RECENT: 'clipboard:get-recent',
  CLIPBOARD_GET_PERSISTED: 'clipboard:get-persisted',
  CLIPBOARD_PIN: 'clipboard:pin',
  CLIPBOARD_DELETE: 'clipboard:delete',
  CLIPBOARD_CLEAR: 'clipboard:clear',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  SETTINGS_GET_CLIPBOARD_PERSISTENCE: 'settings:get-clipboard-persistence',
  SETTINGS_SET_CLIPBOARD_PERSISTENCE: 'settings:set-clipboard-persistence',
  SNIPPETS_LIST: 'snippets:list',
  SNIPPETS_CREATE: 'snippets:create',
  SNIPPETS_UPDATE: 'snippets:update',
  SNIPPETS_DELETE: 'snippets:delete',
} as const;

export type { ClearHistoryResult };
