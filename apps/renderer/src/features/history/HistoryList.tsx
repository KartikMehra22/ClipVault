import type { FC } from 'react';
import type { ClipboardItem, CategoryFilterType } from './types';
import { HistoryItemCard } from './HistoryItemCard';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  HistoryIcon,
  SearchIcon,
  PinIcon,
  ShieldIcon,
  PlayIcon,
} from '../../components/common/Icons';

export interface HistoryListProps {
  items: ClipboardItem[];
  activeFilter: CategoryFilterType;
  searchQuery: string;
  isPinnedOnly?: boolean;
  isCaptureRunning?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onStartCapture?: () => void;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onClearSearch: () => void;
}

export const HistoryList: FC<HistoryListProps> = ({
  items,
  activeFilter,
  searchQuery,
  isPinnedOnly = false,
  isCaptureRunning = false,
  loadError,
  onRetry,
  onStartCapture,
  onTogglePin,
  onDelete,
  onClearSearch,
}) => {
  if (items.length === 0) {
    if (searchQuery.trim().length > 0) {
      return (
        <EmptyState
          icon={<SearchIcon size={28} />}
          title="No matching clips found"
          description={`No results matching "${searchQuery}". Check your spelling or try clearing the search query.`}
          action={{
            label: 'Clear Search',
            onClick: onClearSearch,
          }}
        />
      );
    }

    if (isPinnedOnly) {
      return (
        <EmptyState
          icon={<PinIcon size={28} />}
          title="No pinned clips yet"
          description="Pin your frequently used text excerpts or URLs in History to keep them readily accessible here for your session."
        />
      );
    }

    if (activeFilter !== 'all') {
      return (
        <EmptyState
          icon={<HistoryIcon size={28} />}
          title={`No ${activeFilter} clips found`}
          description={`There are currently no clipboard clips matching the "${activeFilter}" category in memory.`}
        />
      );
    }

    if (loadError) {
      return (
        <EmptyState
          icon={<ShieldIcon size={28} />}
          title="Saved history could not be loaded"
          description={loadError}
          action={
            onRetry
              ? {
                  label: 'Retry Loading History',
                  onClick: onRetry,
                }
              : undefined
          }
        />
      );
    }

    // Inactive capture state
    if (!isCaptureRunning) {
      return (
        <div className="capture-inactive-banner">
          <div className="capture-inactive-icon">
            <HistoryIcon size={24} />
          </div>

          <h2 className="capture-inactive-title">Clipboard Capture is Inactive</h2>
          <p className="capture-inactive-desc">
            Clipboard monitoring is stopped by default. ClipOrbit will not observe or record your
            clipboard until you explicitly enable capture.
          </p>

          <div className="capture-notice-box">
            <ShieldIcon size={16} />
            <div className="capture-notice-text">
              <div className="capture-notice-title">Privacy & Protection</div>
              <div>
                When active, eligible copied text is held in process memory and automatically
                scanned to filter out detected credentials. Encrypted local history saving can be
                configured in Settings.
              </div>
            </div>
          </div>

          {onStartCapture && (
            <button
              type="button"
              onClick={onStartCapture}
              className="capture-btn capture-btn-primary"
              style={{ padding: '0.5rem 1rem', fontSize: '0.8125rem' }}
            >
              <PlayIcon size={14} />
              <span>Start Capture</span>
            </button>
          )}
        </div>
      );
    }

    // Active capture state with zero clips detected yet
    return (
      <EmptyState
        icon={<HistoryIcon size={28} />}
        title="Waiting for clipboard changes..."
        description="Capture is actively running. Any text copied to your clipboard will appear here in process memory."
      />
    );
  }

  return (
    <div className="clip-list-container" role="feed" aria-label="Clipboard history clips">
      {items.map((item) => (
        <HistoryItemCard key={item.id} item={item} onTogglePin={onTogglePin} onDelete={onDelete} />
      ))}
    </div>
  );
};
