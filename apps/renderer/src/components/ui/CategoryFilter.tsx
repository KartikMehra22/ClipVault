import type { FC } from 'react';
import type { CategoryFilterType } from '../../features/history/types';
import { TextIcon, LinkIcon, CodeIcon, ImageIcon } from '../common/Icons';

export interface CategoryFilterProps {
  activeFilter: CategoryFilterType;
  onSelect: (filter: CategoryFilterType) => void;
  counts?: Partial<Record<CategoryFilterType, number>>;
}

const CATEGORIES: Array<{
  id: CategoryFilterType;
  label: string;
  icon?: typeof TextIcon;
}> = [
  { id: 'all', label: 'All' },
  { id: 'text', label: 'Text', icon: TextIcon },
  { id: 'link', label: 'Links', icon: LinkIcon },
  { id: 'code', label: 'Code', icon: CodeIcon },
  { id: 'image', label: 'Images', icon: ImageIcon },
];

export const CategoryFilter: FC<CategoryFilterProps> = ({ activeFilter, onSelect, counts }) => {
  return (
    <nav className="category-filter-bar" aria-label="Filter clips by type">
      {CATEGORIES.map(({ id, label, icon: IconComponent }) => {
        const isActive = activeFilter === id;
        const count = counts?.[id];

        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            className={`category-filter-btn ${isActive ? 'category-filter-btn-active' : ''}`}
            aria-pressed={isActive}
          >
            {IconComponent && (
              <span className="category-filter-icon">
                <IconComponent size={13} />
              </span>
            )}
            <span>{label}</span>
            {typeof count === 'number' && (
              <span
                className={`category-filter-count ${isActive ? 'category-filter-count-active' : ''}`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
