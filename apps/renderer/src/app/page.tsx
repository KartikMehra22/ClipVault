'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  mergeHistoryClips,
  type DesktopInfo,
  type ClipboardStatusDto,
  type CapturedClipDto,
  type PersistedClipDto,
  type MergedClipDto,
  type PersistedClipsResult,
} from '@cliporbit/contracts';
import type {
  ClipboardItem,
  ClipboardContentType,
  CategoryFilterType,
  NavigationTab,
} from '../features/history/types';
import { AppShell } from '../components/layout/AppShell';
import { CategoryFilter } from '../components/ui/CategoryFilter';
import { HistoryList } from '../features/history/HistoryList';
import { CaptureControlBar } from '../features/history/CaptureControlBar';
import { SnippetsView } from '../features/snippets/SnippetsView';

import { SettingsView } from '../features/settings/SettingsView';
import { ShieldIcon, TrashIcon } from '../components/common/Icons';

/**
 * Calculates a human-readable relative timestamp from an ISO 8601 string or Date.
 */
function formatCopiedAt(timestamp: string | Date): string {
  const detected = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - detected.getTime()) / 1000));
  if (diffSec < 60) {
    return 'Just now';
  } else if (diffSec < 3600) {
    return `${Math.floor(diffSec / 60)}m ago`;
  } else if (diffSec < 86400) {
    return `${Math.floor(diffSec / 3600)}h ago`;
  }
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Maps a merged clip DTO to the internal renderer UI model.
 * Strictly avoids displaying raw ciphertext or cryptographic fields.
 */
export function mapMergedClipDtoToItem(dto: MergedClipDto): ClipboardItem {
  const isImage = dto.category === 'image' || dto.text.startsWith('data:image/');
  const type: ClipboardContentType = isImage ? 'image' : dto.category === 'url' ? 'link' : dto.category;

  let domain: string | undefined;
  if (dto.category === 'url') {
    try {
      domain = new URL(dto.text).hostname;
    } catch {
      domain = undefined;
    }
  }

  const charCount = isImage ? undefined : dto.text.length;
  const wordCount = isImage ? undefined : dto.text.trim().split(/\s+/).filter(Boolean).length;
  const copiedAt = formatCopiedAt(dto.createdAt);

  let previewTitle: string | undefined;
  if (dto.category === 'url') {
    previewTitle = domain || 'Web Link';
  } else if (isImage) {
    previewTitle = 'Image';
  } else {
    const firstLine = dto.text.split('\n')[0].trim();
    if (firstLine.length > 0) {
      previewTitle = firstLine.length > 40 ? `${firstLine.slice(0, 40)}...` : firstLine;
    }
  }

  let dimensions: string | undefined;
  if (isImage) {
    const kb = Math.round(dto.byteLength / 1024);
    dimensions = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
  }

  return {
    id: dto.id,
    type,
    content: dto.text,
    previewTitle,
    sourceApp: dto.sourceApp || 'System Clipboard',
    copiedAt,
    isPinned: dto.isPinned,
    metadata: {
      charCount,
      wordCount,
      domain,
      dimensions,
      isSensitive: false,
    },
  };
}

export default function HomePage() {
  const [items, setItems] = useState<ClipboardItem[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [, setPersistedIds] = useState<Set<string>>(new Set());
  const [snippetsCount, setSnippetsCount] = useState<number>(0);
  const [isConfirmingClear, setIsConfirmingClear] = useState<boolean>(false);
  const [captureStatus, setCaptureStatus] = useState<ClipboardStatusDto | null>(null);
  const [isLoadingAction, setIsLoadingAction] = useState<boolean>(false);
  const [persistedLoadError, setPersistedLoadError] = useState<string | null>(null);
  const [isPersistedStale, setIsPersistedStale] = useState<boolean>(false);
  const [maskDetectedSecrets, setMaskDetectedSecrets] = useState<boolean>(true);

  const [activeTab, setActiveTab] = useState<NavigationTab>('history');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<CategoryFilterType>('all');
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const pinnedIdsRef = useRef(pinnedIds);
  pinnedIdsRef.current = pinnedIds;

  const persistedIdsRef = useRef<Set<string>>(new Set());

  const captureStatusRef = useRef(captureStatus);
  captureStatusRef.current = captureStatus;

  const lastKnownPersistedClipsRef = useRef<PersistedClipDto[] | null>(null);
  const requestIdRef = useRef<number>(0);

  // Core loader: Fetches and merges live + persisted history with race condition prevention
  const loadClips = useCallback(async (isMountedCheck?: () => boolean) => {
    if (typeof window === 'undefined' || !window.clipOrbit) {
      return;
    }

    const currentReqId = ++requestIdRef.current;

    try {
      const [liveClipsResult, persistedClipsResult] = await Promise.allSettled([
        window.clipOrbit.getRecentClips
          ? window.clipOrbit.getRecentClips()
          : Promise.resolve([] as CapturedClipDto[]),
        window.clipOrbit.getPersistedClips
          ? window.clipOrbit.getPersistedClips(100)
          : Promise.resolve({ success: true, clips: [] } as PersistedClipsResult),
      ]);

      if (isMountedCheck && !isMountedCheck()) return;
      if (currentReqId !== requestIdRef.current) return;

      const liveClips = liveClipsResult.status === 'fulfilled' ? liveClipsResult.value : [];

      let persistedClips: PersistedClipDto[] = [];
      let isSuccess = false;

      if (persistedClipsResult.status === 'fulfilled') {
        const res = persistedClipsResult.value;
        if (res && typeof res === 'object' && 'success' in res) {
          if (res.success) {
            isSuccess = true;
            persistedClips = res.clips;
          } else {
            isSuccess = false;
          }
        } else if (Array.isArray(res)) {
          isSuccess = true;
          persistedClips = res;
        }
      }

      if (isSuccess) {
        lastKnownPersistedClipsRef.current = persistedClips;
        setPersistedLoadError(null);
        setIsPersistedStale(false);
      } else {
        // Failed to retrieve persisted history
        if (lastKnownPersistedClipsRef.current !== null) {
          // Retain last known persisted clips as stale data
          persistedClips = lastKnownPersistedClipsRef.current;
          setIsPersistedStale(true);
          setPersistedLoadError(
            'Unable to refresh saved history. Showing previously loaded clips.',
          );
        } else {
          // Initial retrieval failure: do not treat as successful empty history
          persistedClips = [];
          setIsPersistedStale(false);
          setPersistedLoadError('Saved history could not be loaded from local storage.');
        }
      }

      const {
        clips: mergedClips,
        persistedIds: nextPersistedIds,
        allPinnedIds: nextPinnedIds,
      } = mergeHistoryClips(liveClips, persistedClips, pinnedIdsRef.current, 100);

      setItems(mergedClips.map(mapMergedClipDtoToItem));
      setPersistedIds(nextPersistedIds);
      persistedIdsRef.current = nextPersistedIds;
      setPinnedIds(nextPinnedIds);
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to load clipboard history:', err);
    }
  }, []);

  // 1. Connect to Electron IPC bridge, fetch initial status, and load saved history
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
        }

        // Load saved history regardless of whether capture is running
        await loadClips(() => isMounted);

        // Load initial snippet count
        if (window.clipOrbit.getSnippets) {
          try {
            const snips = await window.clipOrbit.getSnippets();
            if (snips.success && Array.isArray(snips.snippets) && isMounted) {
              setSnippetsCount(snips.snippets.length);
            }
          } catch {
            // Ignore snippet count load error during startup
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
  }, [loadClips]);

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

        const hasChanged =
          !current ||
          latestStatus.itemCount !== current.itemCount ||
          latestStatus.skippedSensitiveCount !== current.skippedSensitiveCount ||
          latestStatus.skippedOversizedCount !== current.skippedOversizedCount ||
          latestStatus.lastDetectedAt !== current.lastDetectedAt ||
          latestStatus.isRunning !== current.isRunning ||
          latestStatus.isPaused !== current.isPaused;

        if (hasChanged) {
          setCaptureStatus(latestStatus);
          if (
            !current ||
            latestStatus.itemCount !== current.itemCount ||
            latestStatus.lastDetectedAt !== current.lastDetectedAt
          ) {
            await loadClips();
          }
        }
      } catch {
        // Suppress polling error during transitions or teardown
      }
    }, 800);

    return () => {
      clearInterval(interval);
    };
  }, [captureStatus?.isRunning, captureStatus?.isPaused, loadClips]);

  // 3. Load initial view preference and security settings
  useEffect(() => {
    let isMounted = true;
    async function loadInitialPreferences() {
      if (typeof window !== 'undefined' && window.clipOrbit?.getAllSettings) {
        try {
          const settings = await window.clipOrbit.getAllSettings();
          if (isMounted) {
            if (
              settings.defaultView &&
              ['history', 'pinned', 'snippets', 'settings'].includes(settings.defaultView)
            ) {
              setActiveTab(settings.defaultView as NavigationTab);
            }
            if (typeof settings.maskDetectedSecrets === 'boolean') {
              setMaskDetectedSecrets(settings.maskDetectedSecrets);
            }
          }
        } catch {
          // Fall back safely to defaults
        }
      }
    }
    void loadInitialPreferences();
    return () => {
      isMounted = false;
    };
  }, []);

  // 4. Capture Lifecycle and History Actions
  const handleStartCapture = useCallback(async () => {
    if (!window.clipOrbit?.startCapture) return;
    setIsLoadingAction(true);
    try {
      const newStatus = await window.clipOrbit.startCapture();
      setCaptureStatus(newStatus);
      await loadClips();
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to start capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, [loadClips]);

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
      await loadClips();
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to stop capture:', err);
    } finally {
      setIsLoadingAction(false);
    }
  }, [loadClips]);

  const handleTogglePin = useCallback(async (id: string) => {
    const isCurrentlyPinned = pinnedIdsRef.current.has(id);
    const nextPinned = !isCurrentlyPinned;

    // Optimistically update renderer state
    setPinnedIds((prev) => {
      const next = new Set(prev);
      if (nextPinned) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isPinned: nextPinned } : item)),
    );

    // Only invoke persistent pin through IPC if the clip actually exists in persistent storage
    const isPersisted = persistedIdsRef.current.has(id);
    if (isPersisted && window.clipOrbit?.pinClip) {
      try {
        const persisted = await window.clipOrbit.pinClip(id, nextPinned);
        if (!persisted) {
          throw new Error('Database pin operation returned false.');
        }
      } catch (err) {
        console.error('[ClipOrbit Renderer] Failed to persist clip pin status:', err);
        // Rollback optimistic update on database failure
        setPinnedIds((prev) => {
          const next = new Set(prev);
          if (isCurrentlyPinned) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return next;
        });
        setItems((prev) =>
          prev.map((item) => (item.id === id ? { ...item, isPinned: isCurrentlyPinned } : item)),
        );
      }
    }
    // For in-memory unsaved clips, pin status remains preserved purely in active session memory
  }, []);

  // 4b. Keyboard shortcut listener: Cmd/Ctrl+K to focus search, Cmd/Ctrl+P to pin/unpin, Escape to dismiss dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('.search-bar-input');
        searchInput?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const activeEl = document.activeElement;
        const card = activeEl?.closest('.clip-card');
        const clipId = card?.getAttribute('data-clip-id');
        if (clipId) {
          void handleTogglePin(clipId);
        } else if (itemsRef.current.length > 0) {
          void handleTogglePin(itemsRef.current[0].id);
        }
      } else if (e.key === 'Escape') {
        setIsConfirmingClear(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleTogglePin]);

  const handleDelete = useCallback(async (id: string) => {
    const itemToDelete = itemsRef.current.find((item) => item.id === id);
    const wasPinned = pinnedIdsRef.current.has(id);
    const wasPersisted = persistedIdsRef.current.has(id);

    // Optimistically remove from UI
    setItems((prev) => prev.filter((item) => item.id !== id));
    setPinnedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    persistedIdsRef.current.delete(id);
    if (lastKnownPersistedClipsRef.current) {
      lastKnownPersistedClipsRef.current = lastKnownPersistedClipsRef.current.filter(
        (c) => c.id !== id,
      );
    }

    if (window.clipOrbit?.deleteClip) {
      try {
        await window.clipOrbit.deleteClip(id);
      } catch (err) {
        console.error('[ClipOrbit Renderer] Failed to delete clip:', err);
        // Rollback optimistic removal on deletion failure
        if (itemToDelete) {
          setItems((prev) => [itemToDelete, ...prev]);
          if (wasPinned) {
            setPinnedIds((prev) => new Set(prev).add(id));
          }
          if (wasPersisted) {
            persistedIdsRef.current.add(id);
          }
        }
      }
    }
  }, []);

  const handleConfirmClearHistory = useCallback(async () => {
    if (!window.clipOrbit?.clearHistory) {
      setIsConfirmingClear(false);
      return;
    }

    setIsLoadingAction(true);
    try {
      const result = await window.clipOrbit.clearHistory();
      if (result.success) {
        // Clear all history and pinned items from state
        setItems([]);
        setPinnedIds(new Set());
        setPersistedIds(new Set());
        persistedIdsRef.current = new Set();
        pinnedIdsRef.current = new Set();
        itemsRef.current = [];
        lastKnownPersistedClipsRef.current = [];
        setPersistedLoadError(null);
        setIsPersistedStale(false);
        setIsConfirmingClear(false);
      } else {
        // Do not clear local UI state or pretend history was cleared if DB deletion failed
        setPersistedLoadError(result.error || 'Failed to clear saved clipboard history.');
        setIsConfirmingClear(false);
      }
    } catch (err) {
      console.error('[ClipOrbit Renderer] Failed to execute clear history:', err);
      setPersistedLoadError('An unexpected error occurred while clearing clipboard history.');
      setIsConfirmingClear(false);
    } finally {
      setIsLoadingAction(false);
    }
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
      snippets: snippetsCount,
    }),
    [items, snippetsCount],
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
              hasItems={items.length > 0}
              onStart={handleStartCapture}
              onPause={handlePauseCapture}
              onResume={handleResumeCapture}
              onStop={handleStopCapture}
              onClearHistory={() => setIsConfirmingClear(true)}
            />
          )}

          {persistedLoadError && items.length > 0 && (
            <div className="history-status-banner error" role="alert">
              <div className="history-status-banner-content">
                <ShieldIcon size={16} />
                <span>
                  {persistedLoadError}
                  {isPersistedStale ? ' (stale)' : ''}
                </span>
              </div>
              <button type="button" className="history-retry-btn" onClick={() => void loadClips()}>
                Retry
              </button>
            </div>
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
            loadError={persistedLoadError}
            maskSecrets={maskDetectedSecrets}
            onRetry={() => void loadClips()}
            onStartCapture={handleStartCapture}
            onTogglePin={handleTogglePin}
            onDelete={handleDelete}
            onClearSearch={handleClearSearch}
          />
        </div>
      )}

      {activeTab === 'snippets' && <SnippetsView onSnippetCountChange={setSnippetsCount} />}

      {activeTab === 'settings' && <SettingsView />}

      {isConfirmingClear && (
        <div
          className="confirm-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-history-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isLoadingAction) {
              setIsConfirmingClear(false);
            }
          }}
        >
          <div className="confirm-modal-box">
            <div className="confirm-modal-header">
              <div className="confirm-modal-icon-danger">
                <TrashIcon size={18} />
              </div>
              <h2 id="clear-history-title" className="confirm-modal-title">
                Clear Clipboard History
              </h2>
            </div>
            <p className="confirm-modal-body">
              Are you sure you want to clear your clipboard history? This will permanently delete
              all saved clips from local storage and remove all active session clips. Pinned clips
              will also be removed. This action cannot be undone.
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-btn-cancel"
                onClick={() => setIsConfirmingClear(false)}
                disabled={isLoadingAction}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-modal-btn-danger"
                onClick={() => void handleConfirmClearHistory()}
                disabled={isLoadingAction}
              >
                {isLoadingAction ? 'Clearing...' : 'Clear All History'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
