/**
 * ClipOrbit — In-Memory Clipboard Capture Engine
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Implements change detection via controlled polling, cryptographic fingerprinting
 * for duplicate detection, and a bounded in-memory buffer.
 *
 * SAFETY AND PRIVACY ASSURANCES:
 * 1. Capture is STOPPED by default. Never runs automatically on module import.
 * 2. In-memory history is never written to disk, database, or external endpoints.
 * 3. Polling reads text only (no binary images or file data).
 * 4. Error messages and status telemetry strictly redact and omit clipboard text.
 */

import crypto from 'node:crypto';
import {
  type CapturedTextItem,
  type ClipboardCaptureConfig,
  type ClipboardCaptureStatus,
  type IClipboardAdapter,
  DEFAULT_CAPTURE_CONFIG,
  ClipboardValidationError,
} from './types';
import { classifyText } from './classifier';
import { ElectronClipboardAdapter } from './adapter';

/**
 * Computes a SHA-256 hex digest for duplicate detection.
 * Used strictly for in-memory change comparisons; never persisted, exported, or logged.
 */
function computeFingerprint(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Validates and normalizes user configuration.
 */
function validateConfig(config?: ClipboardCaptureConfig): Required<ClipboardCaptureConfig> {
  const merged = { ...DEFAULT_CAPTURE_CONFIG, ...config };

  if (
    typeof merged.pollingIntervalMs !== 'number' ||
    !Number.isFinite(merged.pollingIntervalMs) ||
    merged.pollingIntervalMs < 50
  ) {
    throw new ClipboardValidationError(
      `Invalid pollingIntervalMs: expected number >= 50 ms (received ${String(merged.pollingIntervalMs)}).`,
    );
  }

  if (
    typeof merged.maxItems !== 'number' ||
    !Number.isInteger(merged.maxItems) ||
    merged.maxItems < 1
  ) {
    throw new ClipboardValidationError(
      `Invalid maxItems: expected integer >= 1 (received ${String(merged.maxItems)}).`,
    );
  }

  if (
    typeof merged.maxItemByteLength !== 'number' ||
    !Number.isInteger(merged.maxItemByteLength) ||
    merged.maxItemByteLength < 1
  ) {
    throw new ClipboardValidationError(
      `Invalid maxItemByteLength: expected integer >= 1 (received ${String(merged.maxItemByteLength)}).`,
    );
  }

  if (
    typeof merged.maxTotalByteLength !== 'number' ||
    !Number.isInteger(merged.maxTotalByteLength) ||
    merged.maxTotalByteLength < merged.maxItemByteLength
  ) {
    throw new ClipboardValidationError(
      `Invalid maxTotalByteLength: expected integer >= maxItemByteLength (${merged.maxItemByteLength}) ` +
        `(received ${String(merged.maxTotalByteLength)}).`,
    );
  }

  return merged;
}

/**
 * Manages clipboard polling and in-memory text history.
 */
export class ClipboardCaptureService {
  private readonly adapter: IClipboardAdapter;
  private readonly config: Required<ClipboardCaptureConfig>;

  private isRunning = false;
  private isPaused = false;
  private isPollingActive = false;
  private pollTimer: NodeJS.Timeout | null = null;

  private lastFingerprint: string | null = null;
  private history: CapturedTextItem[] = [];
  private totalByteLength = 0;
  private skippedOversizedCount = 0;
  private lastDetectedAt: Date | null = null;

  constructor(options?: { adapter?: IClipboardAdapter; config?: ClipboardCaptureConfig }) {
    this.adapter = options?.adapter ?? new ElectronClipboardAdapter();
    this.config = validateConfig(options?.config);
  }

  /**
   * Starts clipboard change monitoring.
   *
   * Idempotent: If already running and not paused, subsequent calls are no-ops.
   * Privacy rule: The first observed clipboard value establishes the baseline
   * and is not emitted as a captured history item.
   */
  public async start(): Promise<void> {
    if (this.isRunning && !this.isPaused) {
      return;
    }

    if (this.isRunning && this.isPaused) {
      await this.resume();
      return;
    }

    this.isRunning = true;
    this.isPaused = false;

    // Establish initial baseline without emitting an entry
    await this.establishBaseline();

    this.startTimer();
  }

  /**
   * Pauses clipboard change monitoring.
   * Clears active polling timers and prevents subsequent clipboard reads.
   */
  public pause(): void {
    if (!this.isRunning || this.isPaused) {
      return;
    }

    this.clearTimer();
    this.isPaused = true;
  }

  /**
   * Resumes clipboard monitoring after a pause.
   *
   * Privacy rule: Establishes a fresh baseline, ignoring content that was copied
   * while capture was paused.
   */
  public async resume(): Promise<void> {
    if (!this.isRunning || !this.isPaused) {
      return;
    }

    this.isPaused = false;

    // Establish fresh baseline on resume so changes during pause are ignored
    await this.establishBaseline();

    this.startTimer();
  }

  /**
   * Stops clipboard monitoring completely and purges in-memory history.
   *
   * Clears polling timers, internal baseline fingerprints, and retained items.
   * Safe to call multiple times.
   */
  public stop(): void {
    this.clearTimer();
    this.isRunning = false;
    this.isPaused = false;
    this.lastFingerprint = null;
    this.clearHistory();
    this.skippedOversizedCount = 0;
    this.lastDetectedAt = null;
  }

  /**
   * Clears the in-memory history buffer without changing running/paused status.
   */
  public clearHistory(): void {
    this.history = [];
    this.totalByteLength = 0;
  }

  /**
   * Returns current diagnostic status. Does not expose clipboard contents or keys.
   */
  public getStatus(): ClipboardCaptureStatus {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      itemCount: this.history.length,
      totalByteLength: this.totalByteLength,
      skippedOversizedCount: this.skippedOversizedCount,
      lastDetectedAt: this.lastDetectedAt,
    };
  }

  /**
   * Returns a copy of recent captured text items, ordered most recent first.
   */
  public getRecentItems(): CapturedTextItem[] {
    return [...this.history];
  }

  /**
   * Deterministically triggers a single polling check.
   * Exposed primarily for automated testing or explicit manual evaluation.
   */
  public async pollNow(): Promise<void> {
    if (!this.isRunning || this.isPaused) {
      return;
    }
    await this.executePoll();
  }

  // -------------------------------------------------------------------------
  // Internal Helpers
  // -------------------------------------------------------------------------

  /**
   * Reads current clipboard value to set the baseline fingerprint without creating history records.
   */
  private async establishBaseline(): Promise<void> {
    try {
      const text = await this.adapter.readText();
      if (text && typeof text === 'string' && text.length > 0) {
        this.lastFingerprint = computeFingerprint(text);
      } else {
        this.lastFingerprint = null;
      }
    } catch {
      this.lastFingerprint = null;
    }
  }

  private startTimer(): void {
    this.clearTimer();
    this.pollTimer = setInterval(() => {
      void this.executePoll();
    }, this.config.pollingIntervalMs);
  }

  private clearTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Core polling logic with concurrency guard, error containment, and memory bounds.
   */
  private async executePoll(): Promise<void> {
    if (this.isPollingActive || !this.isRunning || this.isPaused) {
      return;
    }

    this.isPollingActive = true;

    try {
      const text = await this.adapter.readText();

      // Rule 1: Ignore empty or non-string values
      if (!text || typeof text !== 'string' || text.length === 0) {
        return;
      }

      // Rule 2: Compute fingerprint and detect changes
      const fingerprint = computeFingerprint(text);
      if (fingerprint === this.lastFingerprint) {
        // Content unchanged
        return;
      }

      // Value has changed: update last observed fingerprint
      this.lastFingerprint = fingerprint;

      // Rule 3: Enforce single-item byte size limit
      const byteLength = Buffer.byteLength(text, 'utf8');
      if (byteLength > this.config.maxItemByteLength) {
        this.skippedOversizedCount += 1;
        return;
      }

      // Rule 4: Create new captured item
      const category = classifyText(text);
      const item: CapturedTextItem = {
        id: crypto.randomUUID(),
        text,
        detectedAt: new Date(),
        byteLength,
        category,
      };

      // Add to front of history (most recent first)
      this.history.unshift(item);
      this.totalByteLength += byteLength;
      this.lastDetectedAt = item.detectedAt;

      // Rule 5: Enforce history count bound
      while (this.history.length > this.config.maxItems) {
        const evicted = this.history.pop();
        if (evicted) {
          this.totalByteLength -= evicted.byteLength;
        }
      }

      // Rule 6: Enforce total history byte budget bound
      while (this.totalByteLength > this.config.maxTotalByteLength && this.history.length > 0) {
        const evicted = this.history.pop();
        if (evicted) {
          this.totalByteLength -= evicted.byteLength;
        }
      }
    } catch {
      // Contain adapter exceptions without crashing the process
    } finally {
      this.isPollingActive = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton Service and Facade Functions
// ---------------------------------------------------------------------------

let defaultClipboardService: ClipboardCaptureService | null = null;

/**
 * Returns the default singleton capture service, creating it if absent.
 * Note: Capture remains stopped until explicitly started.
 */
export function getClipboardCaptureService(options?: {
  adapter?: IClipboardAdapter;
  config?: ClipboardCaptureConfig;
}): ClipboardCaptureService {
  if (!defaultClipboardService) {
    defaultClipboardService = new ClipboardCaptureService(options);
  }
  return defaultClipboardService;
}

/**
 * Disposes the singleton capture service and cleans up resources.
 */
export function disposeClipboardCaptureService(): void {
  if (defaultClipboardService) {
    defaultClipboardService.stop();
    defaultClipboardService = null;
  }
}
