import type { FC } from 'react';
import type { ClipboardStatusDto } from '@cliporbit/contracts';
import { PlayIcon, PauseIcon, StopIcon } from '../../components/common/Icons';

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
