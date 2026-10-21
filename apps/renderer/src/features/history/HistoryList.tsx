import type { FC } from 'react';
import type { ClipboardItem, CategoryFilterType } from './types';
import { HistoryItemCard } from './HistoryItemCard';
import { EmptyState } from '../../components/ui/EmptyState';
import { HistoryIcon, SearchIcon, PinIcon } from '../../components/common/Icons';

export interface HistoryListProps {
  items: ClipboardItem[];
  activeFilter: CategoryFilterType;
  searchQuery: string;
  isPinnedOnly?: boolean;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onClearSearch: () => void;
}

export const HistoryList: FC<HistoryListProps> = ({
  items,
  activeFilter,
  searchQuery,
  isPinnedOnly = false,
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
          description="Pin your frequently used text excerpts, code snippets, or URLs in History to keep them readily accessible here."
        />
      );
    }

    if (activeFilter !== 'all') {
      return (
        <EmptyState
          icon={<HistoryIcon size={28} />}
          title={`No ${activeFilter} clips found`}
          description={`There are currently no clipboard clips matching the "${activeFilter}" category filter in the demonstration dataset.`}
        />
      );
    }

    return (
      <EmptyState
        icon={<HistoryIcon size={28} />}
        title="Clipboard history is empty"
        description="Demonstration clips have been removed. Reload the app to restore sample demonstration clips."
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
