import type { ClipboardItem } from './types';

export const INITIAL_MOCK_ITEMS: ClipboardItem[] = [
  {
    id: 'clip-1',
    type: 'link',
    content: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API',
    previewTitle: 'Clipboard API - Web APIs | MDN Web Docs',
    sourceApp: 'Safari',
    copiedAt: '2m ago',
    isPinned: false,
    metadata: {
      domain: 'developer.mozilla.org',
      charCount: 63,
    },
  },
  {
    id: 'clip-2',
    type: 'code',
    content: `export function sanitizeInput(raw: string): string {\n  if (!raw) return '';\n  return raw.trim().replace(/[<>]/g, '');\n}`,
    previewTitle: 'TypeScript sanitizeInput utility function',
    sourceApp: 'VS Code',
    copiedAt: '14m ago',
    isPinned: true,
    metadata: {
      language: 'TypeScript',
      charCount: 96,
      wordCount: 12,
    },
  },
  {
    id: 'clip-3',
    type: 'text',
    content:
      'Review Phase 4.1 UI deliverables and ensure keyboard shortcuts for search and navigation are accessible across all views.',
    previewTitle: 'Sprint Checklist Item',
    sourceApp: 'Notes',
    copiedAt: '35m ago',
    isPinned: false,
    metadata: {
      charCount: 122,
      wordCount: 18,
    },
  },
  {
    id: 'clip-4',
    type: 'command',
    content: 'pnpm --filter @cliporbit/desktop build && pnpm --filter @cliporbit/desktop test',
    previewTitle: 'Desktop package build and test command',
    sourceApp: 'Terminal',
    copiedAt: '1h ago',
    isPinned: false,
    metadata: {
      charCount: 78,
    },
  },
  {
    id: 'clip-5',
    type: 'email',
    content: 'security-team@cliporbit.local',
    previewTitle: 'ClipOrbit Security Contacts',
    sourceApp: 'Mail',
    copiedAt: '3h ago',
    isPinned: false,
    metadata: {
      charCount: 29,
    },
  },
  {
    id: 'clip-6',
    type: 'text',
    content:
      'Meeting Notes: 1. Finalize IPC security isolation. 2. Verify contextIsolation and sandbox flags. 3. Establish consistent dark slate design tokens. 4. Implement keyboard-driven search navigation.',
    previewTitle: 'Architecture Sync Notes',
    sourceApp: 'Slack',
    copiedAt: 'Yesterday',
    isPinned: true,
    metadata: {
      charCount: 194,
      wordCount: 27,
    },
  },
  {
    id: 'clip-7',
    type: 'text',
    content: 'MOCK_DEMO_API_KEY_sec_9942f7b8a1c3e0984a12',
    previewTitle: 'Fabricated Demonstration Token',
    sourceApp: 'Terminal',
    copiedAt: 'Yesterday',
    isPinned: false,
    metadata: {
      isSensitive: true,
      sensitiveReason: 'Potential API Key / Secret',
      charCount: 42,
    },
  },
  {
    id: 'clip-8',
    type: 'image',
    content: '[Mock Clipboard Image: 960x640 Screenshot - App Preview]',
    previewTitle: 'Desktop Shell Screenshot (PNG, 960x640)',
    sourceApp: 'CleanShot X',
    copiedAt: '2 days ago',
    isPinned: false,
    metadata: {
      dimensions: '960 × 640 px',
      charCount: 56,
    },
  },
];
