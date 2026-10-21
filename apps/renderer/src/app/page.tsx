'use client';

import { useEffect, useState, useMemo } from 'react';
import type { DesktopInfo } from '@cliporbit/contracts';
import type { ClipboardItem, CategoryFilterType, NavigationTab } from '../features/history/types';
import { INITIAL_MOCK_ITEMS } from '../features/history/mockData';
import { DEMO_SNIPPETS } from '../features/snippets/mockSnippets';
import { AppShell } from '../components/layout/AppShell';
import { CategoryFilter } from '../components/ui/CategoryFilter';
import { HistoryList } from '../features/history/HistoryList';
import { SnippetsView } from '../features/snippets/SnippetsView';
import { SettingsView } from '../features/settings/SettingsView';

export default function HomePage() {
  const [items, setItems] = useState<ClipboardItem[]>(INITIAL_MOCK_ITEMS);
  const [activeTab, setActiveTab] = useState<NavigationTab>('history');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<CategoryFilterType>('all');
  const [desktopInfo, setDesktopInfo] = useState<DesktopInfo | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<'connecting' | 'connected' | 'error'>(
    'connecting',
  );

  // Connect to the Electron preload IPC bridge to maintain verified desktop info
  useEffect(() => {
    let isMounted = true;

    async function loadDesktopInfo() {
      if (typeof window === 'undefined' || !window.clipOrbit?.getDesktopInfo) {
        if (isMounted) {
          setBridgeStatus('error');
        }
        return;
      }

      try {
        const info = await window.clipOrbit.getDesktopInfo();
        if (isMounted) {
          setDesktopInfo(info);
          setBridgeStatus('connected');
        }
      } catch {
        if (isMounted) {
          setBridgeStatus('error');
        }
      }
    }

    loadDesktopInfo();

    return () => {
      isMounted = false;
    };
  }, []);

  // Keyboard shortcut listener: Cmd/Ctrl+K to focus search input
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

  const handleTogglePin = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isPinned: !item.isPinned } : item)),
    );
  };

  const handleDelete = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleClearSearch = () => {
    setSearchQuery('');
  };

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
