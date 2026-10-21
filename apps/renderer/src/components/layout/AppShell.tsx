import type { FC, ReactNode } from 'react';
import type { DesktopInfo } from '@cliporbit/contracts';
import type { NavigationTab } from '../../features/history/types';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export interface AppShellProps {
  children: ReactNode;
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
  counts: {
    history: number;
    pinned: number;
    snippets: number;
  };
  desktopInfo: DesktopInfo | null;
  bridgeStatus: 'connecting' | 'connected' | 'error';
}

export const AppShell: FC<AppShellProps> = ({
  children,
  activeTab,
  onSelectTab,
  searchQuery,
  onSearchChange,
  onSearchClear,
  counts,
  desktopInfo,
  bridgeStatus,
}) => {
  return (
    <div className="app-shell">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={onSelectTab}
        counts={counts}
        desktopInfo={desktopInfo}
        bridgeStatus={bridgeStatus}
      />

      <div className="app-main">
        <Header
          activeTab={activeTab}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClear={onSearchClear}
        />

        <main className="app-content" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
};
