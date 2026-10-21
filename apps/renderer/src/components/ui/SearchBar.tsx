import type { FC, ChangeEvent } from 'react';
import { SearchIcon, ClearIcon } from '../common/Icons';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  placeholder?: string;
  shortcutHint?: string;
}

export const SearchBar: FC<SearchBarProps> = ({
  value,
  onChange,
  onClear,
  placeholder = 'Search clipboard clips...',
  shortcutHint = '⌘K',
}) => {
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className="search-bar-wrapper">
      <span className="search-bar-icon">
        <SearchIcon size={14} />
      </span>
      <input
        type="search"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className="search-bar-input"
        aria-label="Search clipboard history"
        autoComplete="off"
        spellCheck="false"
      />
      {value.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          className="search-bar-clear-btn"
          aria-label="Clear search input"
        >
          <ClearIcon size={12} />
        </button>
      ) : (
        <kbd className="search-bar-shortcut">{shortcutHint}</kbd>
      )}
    </div>
  );
};
