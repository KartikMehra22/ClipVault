import { useState, type FC, type MouseEvent } from 'react';
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
  ExternalLinkIcon,
  GlobeIcon,
  YouTubeIcon,
  TwitterIcon,
  InstagramIcon,
  GithubIcon,
  LinkedinIcon,
  RedditIcon,
  DiscordIcon,
  SpotifyIcon,
} from '../../components/common/Icons';

export interface HistoryItemCardProps {
  item: ClipboardItem;
  isSelected?: boolean;
  maskSecrets?: boolean;
  onTogglePin: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect?: (id: string) => void;
  onHover?: (id: string) => void;
  onHoverEnd?: (id: string) => void;
}

/**
 * Returns a dedicated brand SVG icon for a recognized platform ID.
 */
function getPlatformIcon(platformId?: string, size = 13) {
  switch (platformId) {
    case 'youtube':
      return <YouTubeIcon size={size} />;
    case 'twitter':
      return <TwitterIcon size={size} />;
    case 'instagram':
      return <InstagramIcon size={size} />;
    case 'github':
      return <GithubIcon size={size} />;
    case 'linkedin':
      return <LinkedinIcon size={size} />;
    case 'reddit':
      return <RedditIcon size={size} />;
    case 'discord':
      return <DiscordIcon size={size} />;
    case 'spotify':
      return <SpotifyIcon size={size} />;
    default:
      return <GlobeIcon size={size} />;
  }
}

export const HistoryItemCard: FC<HistoryItemCardProps> = ({
  item,
  isSelected = false,
  maskSecrets = true,
  onTogglePin,
  onDelete,
  onSelect,
  onHover,
  onHoverEnd,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isRevealed, setIsRevealed] = useState<boolean>(!maskSecrets);
  const [copied, setCopied] = useState<boolean>(false);
  const [imageDimensions, setImageDimensions] = useState<string | null>(null);

  const social = item.metadata?.socialLink;

  const handleCopy = async () => {
    if (typeof window !== 'undefined') {
      try {
        if (item.type === 'image' && window.clipOrbit?.writeClipboardImage) {
          const success = await window.clipOrbit.writeClipboardImage(item.content);
          if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
          return;
        }

        if (window.clipOrbit?.writeClipboardText) {
          const success = await window.clipOrbit.writeClipboardText(item.content);
          if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        }
      } catch (err) {
        console.error('[ClipOrbit Renderer] Failed to copy clip to clipboard:', err);
      }
    }
  };

  const handleOpenExternal = async (e: MouseEvent) => {
    e.stopPropagation();
    if (typeof window !== 'undefined' && window.clipOrbit?.openExternalUrl) {
      await window.clipOrbit.openExternalUrl(item.content);
    } else if (typeof window !== 'undefined') {
      window.open(item.content, '_blank', 'noopener,noreferrer');
    }
  };

  const isSensitive = Boolean(item.metadata?.isSensitive);
  const isMultiLine =
    item.type !== 'image' && !social && (item.content.includes('\n') || item.content.length > 120);

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
      data-clip-id={item.id}
      tabIndex={0}
      onClick={() => onSelect?.(item.id)}
      onFocus={() => onSelect?.(item.id)}
      onMouseEnter={() => onHover?.(item.id)}
      onMouseLeave={() => onHoverEnd?.(item.id)}
      className={`clip-card ${item.isPinned ? 'clip-card-pinned' : ''} ${
        isSensitive ? 'clip-card-sensitive' : ''
      } ${social ? 'clip-card-social-wrapper' : ''} ${
        isSelected ? 'clip-card-selected' : ''
      }`}
      aria-label={`${social ? social.platform : getTypeLabel()} copied from ${item.sourceApp}`}
    >
      {/* Card Header: Metadata badges & Contextual Actions */}
      <div className="clip-card-header">
        <div className="clip-card-tags">
          {social ? (
            <span
              className="clip-social-pill"
              style={{
                backgroundColor: social.theme.badgeBg,
                borderColor: social.theme.badgeBorder,
                color: social.theme.badgeText,
              }}
            >
              {getPlatformIcon(social.platformId, 12)}
              <span>{social.platform}</span>
            </span>
          ) : (
            <Badge
              variant={item.type === 'link' ? 'accent' : item.type === 'code' ? 'neutral' : 'default'}
              size="sm"
              icon={getTypeIcon()}
            >
              {getTypeLabel()}
            </Badge>
          )}

          <span className="clip-source-app">{item.sourceApp}</span>

          {social ? (
            <span className="clip-social-category-tag" title={social.category}>
              {social.category}
            </span>
          ) : item.metadata?.domain ? (
            <span className="clip-meta-tag">{item.metadata.domain}</span>
          ) : null}

          {social?.contentType && (
            <span className="clip-content-type-badge">{social.contentType}</span>
          )}

          {(imageDimensions || item.metadata?.dimensions) && (
            <span className="clip-meta-tag">{imageDimensions || item.metadata?.dimensions}</span>
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
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(item.id);
            }}
            className={`clip-action-btn ${item.isPinned ? 'clip-action-pinned' : ''}`}
            aria-label={item.isPinned ? 'Unpin this clip' : 'Pin this clip'}
            title={item.isPinned ? 'Unpin' : 'Pin for this session'}
          >
            <PinIcon size={14} filled={item.isPinned} />
          </button>

          {/* Copy Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void handleCopy();
            }}
            className={`clip-action-btn ${copied ? 'clip-action-copied' : ''}`}
            aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
            title={copied ? 'Copied!' : 'Copy to clipboard'}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
          </button>

          {/* Delete Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(item.id);
            }}
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
            onClick={(e) => {
              e.stopPropagation();
              setIsRevealed(!isRevealed);
            }}
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
        ) : item.type === 'image' ? (
          <div className="clip-content-image-wrapper">
            <img
              src={item.content}
              alt="Copied clipboard item"
              className="clip-image-preview"
              loading="lazy"
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth && img.naturalHeight) {
                  setImageDimensions(`${img.naturalWidth} × ${img.naturalHeight} px`);
                }
              }}
            />
          </div>
        ) : social ? (
          /* Smart Social Media & Web Link Intelligence Card */
          <div className="clip-social-card">
            <div className="clip-social-card-top">
              <div className="clip-social-identity">
                <span
                  className="clip-social-icon-wrapper"
                  style={{
                    color: social.theme.primary,
                    background: social.theme.badgeBg,
                    borderColor: social.theme.badgeBorder,
                  }}
                >
                  {getPlatformIcon(social.platformId, 16)}
                </span>
                <div className="clip-social-info">
                  <div className="clip-social-title-row">
                    <span className="clip-social-brand">{social.platform}</span>
                    <span className="clip-social-kind">{social.category}</span>
                  </div>
                  {social.pathSummary && (
                    <span className="clip-social-path">{social.pathSummary}</span>
                  )}
                </div>
              </div>
              <span className="clip-social-type-pill">{social.contentType}</span>
            </div>

            {/* Contextual Description */}
            <div className="clip-social-desc-box">
              <p className="clip-social-desc">{social.description}</p>
            </div>

            {/* URL Row with Open Action */}
            <div className="clip-social-url-row">
              <span className="clip-social-url-text" title={item.content}>
                {item.content}
              </span>
              <button
                type="button"
                onClick={handleOpenExternal}
                className="clip-social-open-btn"
                title="Open in default browser"
              >
                <ExternalLinkIcon size={12} />
                <span>Open Link</span>
              </button>
            </div>
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
          {social && (
            <span className="clip-social-origin-badge">
              {social.isSocial ? 'Verified Platform Link' : 'Web Link'}
            </span>
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
