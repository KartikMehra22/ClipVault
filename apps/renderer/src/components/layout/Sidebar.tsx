import type { FC } from 'react';
import type { DesktopInfo } from '@cliporbit/contracts';
import type { NavigationTab } from '../../features/history/types';
import {
  LogoIcon,
  HistoryIcon,
  PinIcon,
  SnippetIcon,
  SettingsIcon,
  ShieldIcon,
} from '../common/Icons';

export interface SidebarProps {
  activeTab: NavigationTab;
  onSelectTab: (tab: NavigationTab) => void;
  counts: {
    history: number;
    pinned: number;
    snippets: number;
  };
  desktopInfo: DesktopInfo | null;
  bridgeStatus: 'connecting' | 'connected' | 'error';
}

const NAV_ITEMS: Array<{
  id: NavigationTab;
  label: string;
  icon: typeof HistoryIcon;
  countKey?: 'history' | 'pinned' | 'snippets';
}> = [
  { id: 'history', label: 'History', icon: HistoryIcon, countKey: 'history' },
  { id: 'pinned', label: 'Pinned', icon: PinIcon, countKey: 'pinned' },
  { id: 'snippets', label: 'Snippets', icon: SnippetIcon, countKey: 'snippets' },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

export const Sidebar: FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  counts,
  desktopInfo,
  bridgeStatus,
}) => {
  return (
    <aside className="app-sidebar" aria-label="ClipOrbit Main Navigation">
      {/* Brand Header */}
      <div className="sidebar-brand">
        <div className="sidebar-logo-container">
          <LogoIcon size={22} />
        </div>
        <div className="sidebar-brand-text">
          <span className="sidebar-brand-title">ClipOrbit</span>
          <span className="sidebar-brand-tag">v0.1.0</span>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, icon: IconComponent, countKey }) => {
          const isActive = activeTab === id;
          const count = countKey ? counts[countKey] : undefined;

          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelectTab(id)}
              className={`sidebar-nav-btn ${isActive ? 'sidebar-nav-btn-active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <span className="sidebar-nav-icon">
                <IconComponent size={15} />
              </span>
              <span className="sidebar-nav-label">{label}</span>
              {typeof count === 'number' && (
                <span className={`sidebar-nav-badge ${isActive ? 'sidebar-nav-badge-active' : ''}`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Sidebar Footer with Local-First and Desktop Status */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-status">
          <span
            className={`status-dot ${
              bridgeStatus === 'connected' ? 'status-dot-online' : 'status-dot-offline'
            }`}
            aria-hidden="true"
          />
          <span className="sidebar-footer-label">
            {bridgeStatus === 'connected'
              ? `${desktopInfo?.appName || 'ClipOrbit'} Desktop`
              : 'Local Sandbox Mode'}
          </span>
        </div>
        <div className="sidebar-footer-sub">
          <ShieldIcon size={12} />
          <span>Local Storage Only</span>
        </div>
      </div>
    </aside>
  );
};
