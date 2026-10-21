import type { FC } from 'react';
import type { NavigationTab } from '../../features/history/types';
import { SearchBar } from '../ui/SearchBar';
import { ShieldIcon } from '../common/Icons';

export interface HeaderProps {
  activeTab: NavigationTab;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onSearchClear: () => void;
}

export const Header: FC<HeaderProps> = ({
  activeTab,
  searchQuery,
  onSearchChange,
  onSearchClear,
}) => {
  const getHeaderDetails = (): { title: string; subtitle: string; showSearch: boolean } => {
    switch (activeTab) {
      case 'history':
        return {
          title: 'Clipboard History',
          subtitle: 'In-memory live clipboard session',
          showSearch: true,
        };
      case 'pinned':
        return {
          title: 'Pinned Clips',
          subtitle: 'Quick access to your saved and prioritized clips',
          showSearch: true,
        };
      case 'snippets':
        return {
          title: 'Snippets Library',
          subtitle: 'Reusable templates and command boilerplate',
          showSearch: false,
        };
      case 'settings':
        return {
          title: 'Settings & Security',
          subtitle: 'Configure retention rules, shortcuts, and privacy filters',
          showSearch: false,
        };
    }
  };

  const { title, subtitle, showSearch } = getHeaderDetails();

  return (
    <header className="app-header">
      <div className="header-titles">
        <h1 className="header-title">{title}</h1>
        <p className="header-subtitle">{subtitle}</p>
      </div>

      <div className="header-controls">
        {showSearch && (
          <SearchBar
            value={searchQuery}
            onChange={onSearchChange}
            onClear={onSearchClear}
            placeholder={`Search ${activeTab === 'pinned' ? 'pinned ' : ''}clips...`}
            shortcutHint="⌘K"
          />
        )}

        <div className="header-security-badge" title="No external telemetry or cloud connection">
          <ShieldIcon size={12} />
          <span>Local-First</span>
        </div>
      </div>
    </header>
  );
};
