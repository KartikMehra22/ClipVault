import type { FC } from 'react';
import type { ClipboardStatusDto } from '@cliporbit/contracts';
import { PlayIcon, PauseIcon, StopIcon, ShieldIcon } from '../../components/common/Icons';

export interface CaptureControlBarProps {
  status: ClipboardStatusDto | null;
  isLoading: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const CaptureControlBar: FC<CaptureControlBarProps> = ({
  status,
  isLoading,
  onStart,
  onPause,
  onResume,
  onStop,
}) => {
  const isRunning = Boolean(status?.isRunning);
  const isPaused = Boolean(status?.isPaused);
  const skippedCount = status?.skippedSensitiveCount ?? 0;
  const oversizedCount = status?.skippedOversizedCount ?? 0;

  if (!isRunning) {
    return (
      <div className="capture-control-bar" role="region" aria-label="Clipboard capture status">
        <div className="capture-status-group">
          <div className="capture-status-pill capture-status-pill-stopped">
            <span className="capture-dot capture-dot-stopped" />
            <span>Capture Inactive</span>
          </div>
          <span className="capture-meta-text">
            Clipboard monitoring is stopped. Text is not being recorded.
          </span>
        </div>

        <div className="capture-actions-group">
          <button
            type="button"
            onClick={onStart}
            disabled={isLoading}
            className="capture-btn capture-btn-primary"
            aria-label="Start clipboard capture"
          >
            <PlayIcon size={12} />
            <span>Start Capture</span>
          </button>
        </div>
      </div>
    );
  }

  if (isPaused) {
    return (
      <div className="capture-control-bar" role="region" aria-label="Clipboard capture status">
        <div className="capture-status-group">
          <div className="capture-status-pill capture-status-pill-paused">
            <span className="capture-dot capture-dot-paused" />
            <span>Capture Paused</span>
          </div>
          <span className="capture-meta-text">
            Paused • {status?.itemCount ?? 0} items retained in session
          </span>
          {skippedCount > 0 && (
            <span
              className="capture-skipped-pill"
              title="High-confidence credentials, private keys, or tokens were detected and excluded from in-memory history."
            >
              <ShieldIcon size={12} />
              <span>
                {skippedCount} potentially sensitive {skippedCount === 1 ? 'item' : 'items'} skipped
              </span>
            </span>
          )}
          {oversizedCount > 0 && (
            <span
              className="capture-skipped-pill capture-oversized-pill"
              title="Items exceeding the maximum safe limit (64 KB) were skipped to ensure complete sensitive-content scanning."
            >
              <span>
                {oversizedCount} large {oversizedCount === 1 ? 'item' : 'items'} skipped (&gt;64 KB)
              </span>
            </span>
          )}
        </div>

        <div className="capture-actions-group">
          <button
            type="button"
            onClick={onResume}
            disabled={isLoading}
            className="capture-btn capture-btn-primary"
            aria-label="Resume clipboard capture"
          >
            <PlayIcon size={12} />
            <span>Resume</span>
          </button>

          <button
            type="button"
            onClick={onStop}
            disabled={isLoading}
            className="capture-btn capture-btn-danger"
            aria-label="Stop clipboard capture and clear session"
            title="Stop capture and purge in-memory history"
          >
            <StopIcon size={12} />
            <span>Stop &amp; Clear</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="capture-control-bar" role="region" aria-label="Clipboard capture status">
      <div className="capture-status-group">
        <div className="capture-status-pill capture-status-pill-active">
          <span className="capture-dot capture-dot-active" />
          <span>Capture Active</span>
        </div>
        <span className="capture-meta-text">
          {status?.itemCount ?? 0} items in memory ({formatBytes(status?.totalByteLength ?? 0)})
        </span>
        {skippedCount > 0 && (
          <span
            className="capture-skipped-pill"
            title="High-confidence credentials, private keys, or tokens were detected and excluded from in-memory history."
          >
            <ShieldIcon size={12} />
            <span>
              {skippedCount} potentially sensitive {skippedCount === 1 ? 'item' : 'items'} skipped
            </span>
          </span>
        )}
        {oversizedCount > 0 && (
          <span
            className="capture-skipped-pill capture-oversized-pill"
            title="Items exceeding the maximum safe limit (64 KB) were skipped to ensure complete sensitive-content scanning."
          >
            <span>
              {oversizedCount} large {oversizedCount === 1 ? 'item' : 'items'} skipped (&gt;64 KB)
            </span>
          </span>
        )}
      </div>

      <div className="capture-actions-group">
        <button
          type="button"
          onClick={onPause}
          disabled={isLoading}
          className="capture-btn capture-btn-secondary"
          aria-label="Pause clipboard capture"
          title="Pause clipboard reads"
        >
          <PauseIcon size={12} />
          <span>Pause</span>
        </button>

        <button
          type="button"
          onClick={onStop}
          disabled={isLoading}
          className="capture-btn capture-btn-danger"
          aria-label="Stop clipboard capture and clear session"
          title="Stop capture and purge in-memory history"
        >
          <StopIcon size={12} />
          <span>Stop &amp; Clear</span>
        </button>
      </div>
    </div>
  );
};
