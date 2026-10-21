import type { FC } from 'react';
import { DEMO_SNIPPETS } from './mockSnippets';
import { Badge } from '../../components/common/Badge';
import { SnippetIcon, CopyIcon, InfoIcon } from '../../components/common/Icons';

export const SnippetsView: FC = () => {
  return (
    <div className="snippets-view-wrapper">
      {/* Notice Banner */}
      <div className="placeholder-banner">
        <InfoIcon size={16} />
        <div className="placeholder-banner-text">
          <strong>Demonstration Snippets (Read-Only)</strong> — These reusable text templates
          illustrate snippet organization. Full creation, editing, and tag filtering will be
          integrated in Phase 5.
        </div>
      </div>

      <div className="snippets-header-row">
        <div className="snippets-header-info">
          <span className="snippets-count">{DEMO_SNIPPETS.length} templates available</span>
        </div>
        <button
          type="button"
          disabled
          className="snippets-new-btn-disabled"
          title="Snippet creation will be enabled in Phase 5"
        >
          <SnippetIcon size={13} />
          <span>+ New Snippet (Phase 5)</span>
        </button>
      </div>

      <div className="snippets-grid" role="list" aria-label="Demonstration snippets list">
        {DEMO_SNIPPETS.map((snippet) => (
          <article key={snippet.id} className="snippet-card" role="listitem">
            <div className="snippet-card-header">
              <div className="snippet-card-title-group">
                <h3 className="snippet-card-title">{snippet.title}</h3>
                <Badge variant="accent" size="sm">
                  {snippet.category}
                </Badge>
              </div>
              <button
                type="button"
                disabled
                className="clip-action-btn clip-action-disabled"
                title="Clipboard write disabled in demo mode"
                aria-label="Copy snippet (Disabled in demo)"
              >
                <CopyIcon size={13} />
              </button>
            </div>

            <p className="snippet-card-desc">{snippet.description}</p>

            <pre className="snippet-code-box">
              <code>{snippet.content}</code>
            </pre>

            <div className="snippet-tags-row">
              {snippet.tags.map((tag) => (
                <span key={tag} className="snippet-tag">
                  #{tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};
