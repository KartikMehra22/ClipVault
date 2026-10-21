export type ClipboardContentType = 'text' | 'link' | 'code' | 'command' | 'email' | 'image';

export type CategoryFilterType = 'all' | 'text' | 'link' | 'code' | 'image';

export type NavigationTab = 'history' | 'pinned' | 'snippets' | 'settings';

export interface ClipboardItemMetadata {
  language?: string;
  domain?: string;
  charCount?: number;
  wordCount?: number;
  isSensitive?: boolean;
  sensitiveReason?: string;
  dimensions?: string;
}

export interface ClipboardItem {
  id: string;
  type: ClipboardContentType;
  content: string;
  previewTitle?: string;
  sourceApp: string;
  copiedAt: string;
  isPinned: boolean;
  metadata?: ClipboardItemMetadata;
}
