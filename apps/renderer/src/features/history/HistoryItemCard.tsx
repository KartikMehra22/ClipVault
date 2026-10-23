import { useState, type FC } from 'react';
import type { ClipboardItem } from './types';
import { Badge } from '../../components/common/Badge';
import {
  PinIcon,
  TrashIcon,
  CopyIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LinkIcon,
  CodeIcon,
  TextIcon,
  TerminalIcon,
  EmailIcon,
  ImageIcon,
  LockIcon,
} from '../../components/common/Icons';

export interface HistoryItemCardProps {
  item: ClipboardItem;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
}

export const HistoryItemCard: FC<HistoryItemCardProps> = ({ item, onTogglePin, onDelete }) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isRevealed, setIsRevealed] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const handleCopy = async () => {
    if (typeof window !== 'undefined' && window.clipOrbit?.writeClipboardText) {
      try {
        const success = await window.clipOrbit.writeClipboardText(item.content);
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      } catch (err) {
        console.error('[ClipOrbit Renderer] Failed to copy clip to clipboard:', err);
      }
    }
  };

  const isSensitive = Boolean(item.metadata?.isSensitive);
  const isMultiLine = item.content.includes('\n') || item.content.length > 120;

  const getTypeIcon = () => {
    switch (item.type) {
      case 'link':
        return <LinkIcon size={12} />;
      case 'code':
        return <CodeIcon size={12} />;
      case 'command':
        return <TerminalIcon size={12} />;
      case 'email':
        return <EmailIcon size={12} />;
      case 'image':
        return <ImageIcon size={12} />;
      case 'text':
      default:
        return <TextIcon size={12} />;
    }
  };

  const getTypeLabel = () => {
    if (item.metadata?.language) return item.metadata.language;
    switch (item.type) {
      case 'link':
        return 'URL';
      case 'code':
        return 'Code';
      case 'command':
        return 'Command';
      case 'email':
        return 'Email';
      case 'image':
        return 'Image';
      case 'text':
      default:
        return 'Text';
    }
  };

  return (
    <article
      className={`clip-card ${item.isPinned ? 'clip-card-pinned' : ''} ${
        isSensitive ? 'clip-card-sensitive' : ''
      }`}
      aria-label={`${getTypeLabel()} copied from ${item.sourceApp}`}
    >
      {/* Card Header: Metadata badges & Contextual Actions */}
      <div className="clip-card-header">
        <div className="clip-card-tags">
          <Badge
            variant={item.type === 'link' ? 'accent' : item.type === 'code' ? 'neutral' : 'default'}
            size="sm"
            icon={getTypeIcon()}
          >
            {getTypeLabel()}
          </Badge>

          <span className="clip-source-app">{item.sourceApp}</span>

          {item.metadata?.domain && <span className="clip-meta-tag">{item.metadata.domain}</span>}

          {item.metadata?.dimensions && (
            <span className="clip-meta-tag">{item.metadata.dimensions}</span>
          )}

          {isSensitive && (
            <Badge variant="warning" size="sm" icon={<LockIcon size={11} />}>
              Sensitive
            </Badge>
          )}
        </div>

        <div className="clip-card-actions">
          <span className="clip-timestamp">{item.copiedAt}</span>

          {/* Pin Toggle */}
          <button
            type="button"
            onClick={() => onTogglePin(item.id)}
            className={`clip-action-btn ${item.isPinned ? 'clip-action-pinned' : ''}`}
            aria-label={item.isPinned ? 'Unpin this clip' : 'Pin this clip'}
            title={item.isPinned ? 'Unpin' : 'Pin for this session'}
          >
            <PinIcon size={14} filled={item.isPinned} />
          </button>

          {/* Copy Button */}
          <button
            type="button"
            onClick={() => void handleCopy()}
            className={`clip-action-btn ${copied ? 'clip-action-copied' : ''}`}
            aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>

          {/* Delete Button */}
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="clip-action-btn clip-action-delete"
            aria-label="Remove clip from session"
            title="Remove from session"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      {/* Sensitive Banner if applicable */}
      {isSensitive && (
        <div className="clip-sensitive-notice">
          <LockIcon size={12} />
          <span>{item.metadata?.sensitiveReason || 'Sensitive content detected'}</span>
          <button
            type="button"
            onClick={() => setIsRevealed(!isRevealed)}
            className="clip-reveal-btn"
          >
            {isRevealed ? <EyeOffIcon size={12} /> : <EyeIcon size={12} />}
            <span>{isRevealed ? 'Mask' : 'Reveal'}</span>
          </button>
        </div>
      )}

      {/* Content Preview */}
      <div className="clip-content-box">
        {isSensitive && !isRevealed ? (
          <div className="clip-content-masked">
            <code>••••••••••••••••••••••••••••••••••••••••</code>
          </div>
        ) : item.type === 'code' ? (
          <pre
            className={`clip-content-code ${
              !isExpanded && isMultiLine ? 'clip-content-clamp' : ''
            }`}
          >
            <code>{item.content}</code>
          </pre>
        ) : item.type === 'command' ? (
          <div
            className={`clip-content-command ${
              !isExpanded && isMultiLine ? 'clip-content-clamp' : ''
            }`}
          >
            <span className="clip-command-prompt">$</span>
            <code>{item.content}</code>
          </div>
        ) : (
          <p
            className={`clip-content-text ${
              !isExpanded && isMultiLine ? 'clip-content-clamp' : ''
            }`}
          >
            {item.content}
          </p>
        )}
      </div>

      {/* Card Footer: Character count & Expand/Collapse */}
      <div className="clip-card-footer">
        <div className="clip-footer-meta">
          {typeof item.metadata?.charCount === 'number' && (
            <span className="clip-char-count">{item.metadata.charCount} chars</span>
          )}
          {typeof item.metadata?.wordCount === 'number' && (
            <span className="clip-word-count">• {item.metadata.wordCount} words</span>
          )}
        </div>

        {isMultiLine && (!isSensitive || isRevealed) && (
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="clip-expand-btn"
            aria-expanded={isExpanded}
          >
            <span>{isExpanded ? 'Collapse' : 'Expand full'}</span>
            {isExpanded ? <ChevronUpIcon size={12} /> : <ChevronDownIcon size={12} />}
          </button>
        )}
      </div>
    </article>
  );
};
