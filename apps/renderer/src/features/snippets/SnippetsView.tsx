import { useState, useEffect, useCallback, useMemo, type FC, type FormEvent } from 'react';
import type { SnippetDto } from '@cliporbit/contracts';
import { Badge } from '../../components/common/Badge';
import { EmptyState } from '../../components/ui/EmptyState';
import {
  SnippetIcon,
  CopyIcon,
  CheckIcon,
  EditIcon,
  TrashIcon,
  SearchIcon,
  ClearIcon,
  ShieldIcon,
  PlusIcon,
} from '../../components/common/Icons';

export interface SnippetsViewProps {
  onSnippetCountChange?: (count: number) => void;
}

const SUPPORTED_LANGUAGES = [
  { value: 'text', label: 'Plain Text' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash / Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML / CSS' },
];

export const SnippetsView: FC<SnippetsViewProps> = ({ onSnippetCountChange }) => {
  const [snippets, setSnippets] = useState<SnippetDto[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search and filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [languageFilter, setLanguageFilter] = useState<string>('all');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [modalMode, setModalMode] = useState<'create' | 'edit'>('create');
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);

  // Form fields
  const [title, setTitle] = useState<string>('');
  const [content, setContent] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [language, setLanguage] = useState<string>('text');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Deletion dialog
  const [deletingSnippet, setDeletingSnippet] = useState<SnippetDto | null>(null);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);

  // Copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Core loader
  const loadSnippets = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);

    try {
      if (typeof window !== 'undefined' && window.clipOrbit?.getSnippets) {
        const result = await window.clipOrbit.getSnippets();
        if (result.success && Array.isArray(result.snippets)) {
          setSnippets(result.snippets);
          onSnippetCountChange?.(result.snippets.length);
        } else {
          setLoadError(result.error || 'Failed to load snippets from local storage.');
        }
      } else {
        // Non-Electron preview fallback
        setSnippets([]);
      }
    } catch (err) {
      console.error('[ClipOrbit Snippets] Failed to load snippets:', err);
      setLoadError('An unexpected error occurred while loading snippets.');
    } finally {
      setIsLoading(false);
    }
  }, [onSnippetCountChange]);

  useEffect(() => {
    void loadSnippets();
  }, [loadSnippets]);

  // Global ESC key listener to dismiss open modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isModalOpen && !isSubmitting) {
          setIsModalOpen(false);
        }
        if (deletingSnippet && !isDeleting) {
          setDeletingSnippet(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isSubmitting, deletingSnippet, isDeleting]);

  // Handlers for modal creation/editing
  const openCreateModal = () => {
    setModalMode('create');
    setEditingSnippetId(null);
    setTitle('');
    setContent('');
    setDescription('');
    setLanguage('text');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (snippet: SnippetDto) => {
    setModalMode('edit');
    setEditingSnippetId(snippet.id);
    setTitle(snippet.title);
    setContent(snippet.content);
    setDescription(snippet.description || '');
    setLanguage(snippet.language || 'text');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleCopySnippet = async (snippet: SnippetDto) => {
    if (typeof window !== 'undefined' && window.clipOrbit?.writeClipboardText) {
      try {
        const success = await window.clipOrbit.writeClipboardText(snippet.content);
        if (success) {
          setCopiedId(snippet.id);
          setTimeout(() => setCopiedId(null), 1500);
        }
      } catch (err) {
        console.error('[ClipOrbit Snippets] Failed to write snippet to clipboard:', err);
      }
    }
  };

  const handleFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanTitle = title.trim();
    const cleanContent = content;

    if (!cleanTitle) {
      setFormError('Snippet title is required.');
      return;
    }
    if (!cleanContent) {
      setFormError('Snippet content is required.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (modalMode === 'create') {
        if (!window.clipOrbit?.createSnippet) {
          throw new Error('Desktop bridge is not available.');
        }

        const result = await window.clipOrbit.createSnippet({
          title: cleanTitle,
          content: cleanContent,
          description: description.trim() || null,
          language: language || null,
        });

        if (result.success && result.snippet) {
          const next = [result.snippet, ...snippets];
          setSnippets(next);
          onSnippetCountChange?.(next.length);
          setIsModalOpen(false);
        } else {
          setFormError(result.error || 'Failed to create snippet.');
        }
      } else {
        if (!window.clipOrbit?.updateSnippet || !editingSnippetId) {
          throw new Error('Desktop bridge is not available.');
        }

        const result = await window.clipOrbit.updateSnippet({
          id: editingSnippetId,
          title: cleanTitle,
          content: cleanContent,
          description: description.trim() || null,
          language: language || null,
        });

        if (result.success && result.snippet) {
          const updated = result.snippet;
          const next = snippets.map((s) => (s.id === updated.id ? updated : s));
          setSnippets(next);
          setIsModalOpen(false);
        } else {
          setFormError(result.error || 'Failed to update snippet.');
        }
      }
    } catch (err) {
      console.error('[ClipOrbit Snippets] Error during snippet submission:', err);
      setFormError(err instanceof Error ? err.message : 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingSnippet || !window.clipOrbit?.deleteSnippet) {
      setDeletingSnippet(null);
      return;
    }

    setIsDeleting(true);

    try {
      const success = await window.clipOrbit.deleteSnippet(deletingSnippet.id);
      if (success) {
        const next = snippets.filter((s) => s.id !== deletingSnippet.id);
        setSnippets(next);
        onSnippetCountChange?.(next.length);
        setDeletingSnippet(null);
      } else {
        setLoadError('Failed to delete snippet from local storage.');
      }
    } catch (err) {
      console.error('[ClipOrbit Snippets] Error deleting snippet:', err);
      setLoadError('An unexpected error occurred while deleting the snippet.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Filtered snippets
  const filteredSnippets = useMemo(() => {
    let result = snippets;

    if (languageFilter !== 'all') {
      result = result.filter((s) => s.language?.toLowerCase() === languageFilter.toLowerCase());
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter((s) => {
        const titleMatch = s.title.toLowerCase().includes(query);
        const descMatch = s.description?.toLowerCase().includes(query);
        const contentMatch = s.content.toLowerCase().includes(query);
        const langMatch = s.language?.toLowerCase().includes(query);
        return Boolean(titleMatch || descMatch || contentMatch || langMatch);
      });
    }

    return result;
  }, [snippets, languageFilter, searchQuery]);

  return (
    <div className="snippets-view-wrapper">
      {/* Notice Banner */}
      <div className="placeholder-banner">
        <SnippetIcon size={16} />
        <div className="placeholder-banner-text">
          <strong>Encrypted Snippet Vault</strong> — Reusable text templates and code blocks are
          stored locally with AES-256-GCM encryption. Snippets are preserved independently of
          clipboard history.
        </div>
      </div>

      {/* Header Row: Filter & New Snippet Button */}
      <div className="snippets-header-row">
        <div className="snippets-header-info">
          <span className="snippets-count">
            {snippets.length} {snippets.length === 1 ? 'snippet' : 'snippets'} stored
          </span>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="snippets-new-btn"
          aria-label="Create new snippet"
        >
          <PlusIcon size={14} />
          <span>New Snippet</span>
        </button>
      </div>

      {/* Search and Language Filter */}
      {snippets.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: '0.65rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div
            style={{
              position: 'relative',
              flex: '1',
              minWidth: '200px',
            }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search snippets by title, tags, or content..."
              className="snippet-form-input"
              style={{ width: '100%', paddingLeft: '2rem' }}
              aria-label="Search snippets"
            />
            <span
              style={{
                position: 'absolute',
                left: '0.65rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                display: 'flex',
              }}
            >
              <SearchIcon size={14} />
            </span>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '0.65rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  display: 'flex',
                }}
                aria-label="Clear search"
              >
                <ClearIcon size={14} />
              </button>
            )}
          </div>

          <select
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            className="snippet-form-select"
            aria-label="Filter snippets by programming language"
          >
            <option value="all">All Languages</option>
            {SUPPORTED_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Error Banner if any */}
      {loadError && (
        <div className="history-status-banner error" role="alert">
          <div className="history-status-banner-content">
            <ShieldIcon size={16} />
            <span>{loadError}</span>
          </div>
          <button type="button" className="history-retry-btn" onClick={() => void loadSnippets()}>
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-muted)' }}>
          Loading encrypted snippets...
        </div>
      ) : snippets.length === 0 ? (
        <EmptyState
          icon={<SnippetIcon size={28} />}
          title="No snippets saved yet"
          description="Create your first reusable text template or code snippet to quickly paste it anytime."
          action={{
            label: '+ Create Snippet',
            onClick: openCreateModal,
          }}
        />
      ) : filteredSnippets.length === 0 ? (
        <EmptyState
          icon={<SearchIcon size={28} />}
          title="No matching snippets found"
          description={`No snippets match "${searchQuery || languageFilter}". Try adjusting your query.`}
          action={{
            label: 'Clear Filters',
            onClick: () => {
              setSearchQuery('');
              setLanguageFilter('all');
            },
          }}
        />
      ) : (
        <div className="snippets-grid" role="list" aria-label="Encrypted snippets list">
          {filteredSnippets.map((snippet) => {
            const isCopied = copiedId === snippet.id;

            return (
              <article key={snippet.id} className="snippet-card" role="listitem">
                <div className="snippet-card-header">
                  <div className="snippet-card-title-group">
                    <h3 className="snippet-card-title">{snippet.title}</h3>
                    {snippet.language && (
                      <Badge variant="accent" size="sm">
                        {snippet.language}
                      </Badge>
                    )}
                  </div>

                  <div className="clip-card-actions">
                    {/* Copy Button */}
                    <button
                      type="button"
                      onClick={() => void handleCopySnippet(snippet)}
                      className={`clip-action-btn ${isCopied ? 'clip-action-copied' : ''}`}
                      title={isCopied ? 'Copied!' : 'Copy to clipboard'}
                      aria-label={`Copy snippet ${snippet.title}`}
                    >
                      {isCopied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                    </button>

                    {/* Edit Button */}
                    <button
                      type="button"
                      onClick={() => openEditModal(snippet)}
                      className="clip-action-btn"
                      title="Edit snippet"
                      aria-label={`Edit snippet ${snippet.title}`}
                    >
                      <EditIcon size={13} />
                    </button>

                    {/* Delete Button */}
                    <button
                      type="button"
                      onClick={() => setDeletingSnippet(snippet)}
                      className="clip-action-btn clip-action-delete"
                      title="Delete snippet"
                      aria-label={`Delete snippet ${snippet.title}`}
                    >
                      <TrashIcon size={13} />
                    </button>
                  </div>
                </div>

                {snippet.description && <p className="snippet-card-desc">{snippet.description}</p>}

                <pre className="snippet-code-box">
                  <code>{snippet.content}</code>
                </pre>
              </article>
            );
          })}
        </div>
      )}

      {/* Snippet Create / Edit Modal Dialog */}
      {isModalOpen && (
        <div
          className="confirm-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="snippet-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) {
              setIsModalOpen(false);
            }
          }}
        >
          <div className="snippet-modal-box">
            <div className="confirm-modal-header">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-primary)',
                  flexShrink: 0,
                }}
              >
                <SnippetIcon size={18} />
              </div>
              <h2 id="snippet-modal-title" className="confirm-modal-title">
                {modalMode === 'create' ? 'Create New Snippet' : 'Edit Snippet'}
              </h2>
            </div>

            <form onSubmit={handleFormSubmit} className="snippet-form">
              {formError && (
                <div className="snippet-form-error" role="alert">
                  {formError}
                </div>
              )}

              <div className="snippet-form-group">
                <label htmlFor="snippet-title" className="snippet-form-label">
                  <span>
                    Title <span className="required">*</span>
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    {title.length}/256
                  </span>
                </label>
                <input
                  id="snippet-title"
                  type="text"
                  required
                  maxLength={256}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Next.js Dockerfile, Git Rebase Command"
                  className="snippet-form-input"
                  autoFocus
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <div className="snippet-form-group">
                  <label htmlFor="snippet-language" className="snippet-form-label">
                    <span>Language / Type</span>
                  </label>
                  <select
                    id="snippet-language"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="snippet-form-select"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="snippet-form-group">
                  <label htmlFor="snippet-desc" className="snippet-form-label">
                    <span>Description (Optional)</span>
                  </label>
                  <input
                    id="snippet-desc"
                    type="text"
                    maxLength={1024}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Short description..."
                    className="snippet-form-input"
                  />
                </div>
              </div>

              <div className="snippet-form-group">
                <label htmlFor="snippet-content" className="snippet-form-label">
                  <span>
                    Content <span className="required">*</span>
                  </span>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>
                    AES-256-GCM Encrypted
                  </span>
                </label>
                <textarea
                  id="snippet-content"
                  required
                  rows={6}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Enter snippet code, text, or template..."
                  className="snippet-form-textarea"
                />
              </div>

              <div className="confirm-modal-actions">
                <button
                  type="button"
                  className="confirm-modal-btn-cancel"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="snippet-modal-btn-primary"
                  disabled={isSubmitting || !title.trim() || !content}
                >
                  {isSubmitting
                    ? 'Saving...'
                    : modalMode === 'create'
                      ? 'Save Snippet'
                      : 'Update Snippet'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal Dialog */}
      {deletingSnippet && (
        <div
          className="confirm-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-snippet-title"
          onClick={(e) => {
            if (e.target === e.currentTarget && !isDeleting) {
              setDeletingSnippet(null);
            }
          }}
        >
          <div className="confirm-modal-box">
            <div className="confirm-modal-header">
              <div className="confirm-modal-icon-danger">
                <TrashIcon size={18} />
              </div>
              <h2 id="delete-snippet-title" className="confirm-modal-title">
                Delete Snippet
              </h2>
            </div>
            <p className="confirm-modal-body">
              Are you sure you want to delete <strong>{deletingSnippet.title}</strong>? This will
              permanently remove the encrypted snippet from local storage. This action cannot be
              undone.
            </p>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="confirm-modal-btn-cancel"
                onClick={() => setDeletingSnippet(null)}
                disabled={isDeleting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="confirm-modal-btn-danger"
                onClick={() => void handleConfirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting...' : 'Delete Snippet'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
