'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import type { DesktopInfo, ClipboardStatusDto, CapturedClipDto } from '@cliporbit/contracts';
import type {
  ClipboardItem,
  ClipboardContentType,
  CategoryFilterType,
  NavigationTab,
} from '../features/history/types';
import { DEMO_SNIPPETS } from '../features/snippets/mockSnippets';
import { AppShell } from '../components/layout/AppShell';
import { CategoryFilter } from '../components/ui/CategoryFilter';
import { HistoryList } from '../features/history/HistoryList';
import { CaptureControlBar } from '../features/history/CaptureControlBar';
import { SnippetsView } from '../features/snippets/SnippetsView';
import { SettingsView } from '../features/settings/SettingsView';

/**
 * Maps a captured clip DTO to the internal renderer UI model.
 * Assigns sensible non-fabricated metadata and computes relative timestamps.
 */
function mapClipDtoToItem(dto: CapturedClipDto, isPinned: boolean): ClipboardItem {
  const type: ClipboardContentType = dto.category === 'url' ? 'link' : dto.category;

  let domain: string | undefined;
  if (dto.category === 'url') {
    try {
      domain = new URL(dto.text).hostname;
    } catch {
      domain = undefined;
    }
  }

  const charCount = dto.text.length;
  const wordCount = dto.text.trim().split(/\s+/).filter(Boolean).length;

  const detected = new Date(dto.detectedAt);
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - detected.getTime()) / 1000));
  let copiedAt = 'Just now';
  if (diffSec >= 60 && diffSec < 3600) {
    copiedAt = `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec >= 3600 && diffSec < 86400) {
    copiedAt = `${Math.floor(diffSec / 3600)}h ago`;
  } else if (diffSec >= 86400) {
    copiedAt = `${Math.floor(diffSec / 86400)}d ago`;
  }

  let previewTitle: string | undefined;
  if (dto.category === 'url') {
    previewTitle = domain || 'Web Link';
  } else {
    const firstLine = dto.text.split('\n')[0].trim();
    if (firstLine.length > 0) {
      previewTitle = firstLine.length > 40 ? `${firstLine.slice(0, 40)}...` : firstLine;
    }
  }

  return {
    id: dto.id,
    type,
    content: dto.text,
    previewTitle,
    sourceApp: 'System Clipboard',
    copiedAt,
    isPinned,
    metadata: {
      charCount,
      wordCount,
      domain,
      isSensitive: false,
    },
  };
}

export default function HomePage() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [captureStatus, setCaptureStatus] = useState<ClipboardStatusDto | null>(null);
  const [isLoadingAction, setIsLoadingAction] = useState<boolean>(false);

  const [activeTab, setActiveTab] = useState<NavigationTab>('history');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<CategoryFilterType>('all');
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );

  const pinnedIdsRef = useRef(pinnedIds);
  pinnedIdsRef.current = pinnedIds;

  const captureStatusRef = useRef(captureStatus);
  captureStatusRef.current = captureStatus;

  // 1. Connect to Electron IPC bridge and fetch initial status
  useEffect(() => {
    let isMounted = true;

    async function initializeBridge() {
      if (typeof window === 'undefined' || !window.clipOrbit?.getDesktopInfo) {
        if (isMounted) {
          setBridgeStatus('error');
        }
        return;
      }

      try {
        const info = await window.clipOrbit.getDesktopInfo();
        const initialStatus = await window.clipOrbit.getCaptureStatus();

        if (isMounted) {
          setDesktopInfo(info);
          setCaptureStatus(initialStatus);
          setBridgeStatus('connected');

          if (initialStatus.isRunning && initialStatus.itemCount > 0) {
            const initialClips = await window.clipOrbit.getRecentClips();
            if (isMounted) {
              setItems(
                initialClips.map((c) => mapClipDtoToItem(c, pinnedIdsRef.current.has(c.id))),
              );
            }
          }
        }
      } catch {
        if (isMounted) {
          setBridgeStatus('error');
        }
      }
    }

    void initializeBridge();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Synchronize history efficiently while capture is active
  useEffect(() => {
    if (!captureStatus?.isRunning || captureStatus?.isPaused) {
      return;
    }

    const interval = setInterval(async () => {
      if (typeof window === 'undefined' || !window.clipOrbit?.getCaptureStatus) {
        return;
      }

      try {
        const latestStatus = await window.clipOrbit.getCaptureStatus();
        const current = captureStatusRef.current;

        // Check if history counts, timestamps, or state changed before fetching full clips
        const hasChanged =
          !current ||
          latestStatus.itemCount !== current.itemCount ||
          latestStatus.lastDetectedAt !== current.lastDetectedAt ||
          latestStatus.isRunning !== current.isRunning ||
          latestStatus.isPaused !== current.isPaused;

        if (hasChanged) {
          setCaptureStatus(latestStatus);
          const clips = await window.clipOrbit.getRecentClips();
          setItems(clips.map((c) => mapClipDtoToItem(c, pinnedIdsRef.current.has(c.id))));
        }
      } catch {
        // Suppress polling error during transitions or teardown
      }
    }, 800);

    return () => {
      clearInterval(interval);
    };
  }, [captureStatus?.isRunning, captureStatus?.isPaused]);

  // 3. Keyboard shortcut listener: Cmd/Ctrl+K to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('.search-bar-input');
        searchInput?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 4. Capture Lifecycle Actions
  const handleStartCapture = useCallback(async () => {
    if (!window.clipOrbit?.startCapture) return;
    setIsLoadingAction(true);
    try {
      const newStatus = await window.clipOrbit.startCapture();
      setCaptureStatus(newStatus);
      const clips = await window.clipOrbit.getRecentClips();
      setItems(clips.map((c) => mapClipDtoToItem(c, pinnedIdsRef.current.has(c.id))));
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to start capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, []);

  const handlePauseCapture = useCallback(async () => {
    if (!window.clipOrbit?.pauseCapture) return;
    setIsLoadingAction(true);
    try {
      const newStatus = await window.clipOrbit.pauseCapture();
      setCaptureStatus(newStatus);
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to pause capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, []);

  const handleResumeCapture = useCallback(async () => {
    if (!window.clipOrbit?.resumeCapture) return;
    setIsLoadingAction(true);
    try {
      const newStatus = await window.clipOrbit.resumeCapture();
      setCaptureStatus(newStatus);
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to resume capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, []);

  const handleStopCapture = useCallback(async () => {
    if (!window.clipOrbit?.stopCapture) return;
    setIsLoadingAction(true);
    try {
      const newStatus = await window.clipOrbit.stopCapture();
      setCaptureStatus(newStatus);
      setItems([]);
      setPinnedIds(new Set());
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to stop capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isPinned: !item.isPinned } : item)),
    );
  }, []);

  const handleDelete = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
  }, []);

  // Base list of items according to active navigation tab
  const baseTabItems = useMemo(() => {
    if (activeTab === 'pinned') {
      return items.filter((item) => item.isPinned);
    }
    return items;
  }, [items, activeTab]);

  // Compute category counts based on current tab's items
  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryFilterType, number> = {
      all: baseTabItems.length,
      text: 0,
      link: 0,
      code: 0,
      image: 0,
    };

    for (const item of baseTabItems) {
      if (item.type === 'text' || item.type === 'command' || item.type === 'email') {
        counts.text += 1;
      } else if (item.type === 'link') {
        counts.link += 1;
      } else if (item.type === 'code') {
        counts.code += 1;
      } else if (item.type === 'image') {
        counts.image += 1;
      }
    }

    return counts;
  }, [baseTabItems]);

  // Filtered items based on category tabs and search query
  const filteredItems = useMemo(() => {
    let result = baseTabItems;

    // Apply category filter
    if (typeFilter !== 'all') {
      result = result.filter((item) => {
        if (typeFilter === 'text') {
          return item.type === 'text' || item.type === 'command' || item.type === 'email';
        }
        if (typeFilter === 'link') {
          return item.type === 'link';
        }
        if (typeFilter === 'code') {
          return item.type === 'code';
        }
        if (typeFilter === 'image') {
          return item.type === 'image';
        }
        return true;
      });
    }

    // Apply search query filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((item) => {
        const contentMatch = item.content.toLowerCase().includes(query);
        const sourceMatch = item.sourceApp.toLowerCase().includes(query);
        const titleMatch = item.previewTitle?.toLowerCase().includes(query);
        const langMatch = item.metadata?.language?.toLowerCase().includes(query);
        const domainMatch = item.metadata?.domain?.toLowerCase().includes(query);

        return Boolean(contentMatch || sourceMatch || titleMatch || langMatch || domainMatch);
      });
    }

    return result;
  }, [baseTabItems, typeFilter, searchQuery]);

  const sidebarCounts = useMemo(
    () => ({
      history: items.length,
      pinned: items.filter((i) => i.isPinned).length,
      snippets: DEMO_SNIPPETS.length,
    }),
    [items],
  );

  const isCaptureRunning = Boolean(captureStatus?.isRunning);

  return (
    <AppShell
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      onSearchClear={handleClearSearch}
      counts={sidebarCounts}
      desktopInfo={desktopInfo}
      bridgeStatus={bridgeStatus}
    >
      {(activeTab === 'history' || activeTab === 'pinned') && (
        <div className="view-container">
          {activeTab === 'history' && (
            <CaptureControlBar
              status={captureStatus}
              isLoading={isLoadingAction}
              onStart={handleStartCapture}
              onPause={handlePauseCapture}
              onResume={handleResumeCapture}
              onStop={handleStopCapture}
            />
          )}

          <CategoryFilter
            activeFilter={typeFilter}
            onSelect={setTypeFilter}
            counts={categoryCounts}
          />

          <HistoryList
            items={filteredItems}
            activeFilter={typeFilter}
            searchQuery={searchQuery}
            isPinnedOnly={activeTab === 'pinned'}
            isCaptureRunning={isCaptureRunning}
            onStartCapture={handleStartCapture}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            onClearSearch={handleClearSearch}
          />
        </div>
      )}

      {activeTab === 'snippets' && <SnippetsView />}

      {activeTab === 'settings' && <SettingsView />}
    </AppShell>
  );
}
