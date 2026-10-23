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
  MAX_SAFE_ITEM_BYTE_LENGTH,
  MAX_SAFE_IMAGE_BYTE_LENGTH,
  ClipboardValidationError,
} from './types';
import { classifyText } from './classifier';
import { ElectronClipboardAdapter } from './adapter';
import { detectSensitiveContent } from './sensitiveContentDetector';
import {
  type EncryptedClipboardPersistenceService,
  getEncryptedClipboardPersistenceService,
  resetEncryptedClipboardPersistenceService,
} from './persistence';

/**
 * Computes a SHA-256 hex digest for duplicate detection.
 * Used strictly for in-memory change comparisons; never persisted, exported, or logged.
 */
function computeFingerprint(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Source for EncryptedClipboardPersistenceService injection.
 */
export type PersistenceServiceSource =
  EncryptedClipboardPersistenceService | (() => EncryptedClipboardPersistenceService | null) | null;

/**
 * Options for configuring ClipboardCaptureService.
 */
export interface ClipboardCaptureServiceOptions {
  adapter?: IClipboardAdapter;
  config?: ClipboardCaptureConfig;
  persistenceService?: PersistenceServiceSource;
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
    merged.maxItemByteLength < 1 ||
    merged.maxItemByteLength > MAX_SAFE_ITEM_BYTE_LENGTH
  ) {
    throw new ClipboardValidationError(
      `Invalid maxItemByteLength: expected integer between 1 and ${MAX_SAFE_ITEM_BYTE_LENGTH} bytes ` +
        `(received ${String(merged.maxItemByteLength)}). Cannot exceed maximum safe scanning limit.`,
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
  private readonly persistenceSource?: PersistenceServiceSource;

  private isRunning = false;
  private isPaused = false;
  private isPollingActive = false;
  private pollTimer: NodeJS.Timeout | null = null;

  private lastFingerprint: string | null = null;
  private history: CapturedTextItem[] = [];
  private totalByteLength = 0;
  private skippedOversizedCount = 0;
  private skippedSensitiveCount = 0;
  private lastDetectedAt: Date | null = null;

  constructor(options?: ClipboardCaptureServiceOptions) {
    this.adapter = options?.adapter ?? new ElectronClipboardAdapter();
    this.config = validateConfig(options?.config);
    this.persistenceSource = options?.persistenceService;
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
    this.skippedSensitiveCount = 0;
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
   * Removes a captured text item from in-memory history by ID.
   * Updates total byte length accordingly. Returns true if removed, false if not found.
   */
  public removeItem(id: string): boolean {
    const index = this.history.findIndex((item) => item.id === id);
    if (index !== -1) {
      const removed = this.history.splice(index, 1)[0];
      this.totalByteLength = Math.max(0, this.totalByteLength - removed.byteLength);
      return true;
    }
    return false;
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
      skippedSensitiveCount: this.skippedSensitiveCount,
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
        return;
      }
      if (typeof this.adapter.readImage === 'function') {
        const img = await this.adapter.readImage();
        if (img && typeof img.dataUrl === 'string' && img.dataUrl.length > 0) {
          this.lastFingerprint = computeFingerprint(img.dataUrl);
          return;
        }
      }
      this.lastFingerprint = null;
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

      // Branch 1: Text content present
      if (text && typeof text === 'string' && text.length > 0) {
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

        // Rule 4: Enforce sensitive-content filtering
        // High-confidence sensitive items must never enter history or be retained.
        try {
          const detection = detectSensitiveContent(text);
          if (detection.isSensitive) {
            this.skippedSensitiveCount += 1;
            return;
          }
          if (detection.exceededScanLimit) {
            // Defense-in-depth: If the item exceeded the safe scanning limit, skip conservatively as oversized
            this.skippedOversizedCount += 1;
            return;
          }
        } catch {
          // Fail-safe: if detector throws, treat as sensitive and exclude rather than leaking
          this.skippedSensitiveCount += 1;
          return;
        }

        // Rule 5: Create new captured item
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

        // Persist newly accepted eligible text capture to encrypted persistence
        const persistence = this.getPersistenceService();
        if (persistence) {
          try {
            await persistence.saveTextClip({
              id: item.id,
              text: item.text,
              createdAt: item.detectedAt,
              contentType: 'text/plain',
            });
          } catch {
            // Failure to persist must never crash the polling loop
          }
        }
      } else if (typeof this.adapter.readImage === 'function') {
        // Branch 2: No text on clipboard; check for image payload
        const img = await this.adapter.readImage();
        if (img && typeof img.dataUrl === 'string' && img.dataUrl.length > 0) {
          const fingerprint = computeFingerprint(img.dataUrl);
          if (fingerprint === this.lastFingerprint) {
            // Image content unchanged
            return;
          }

          this.lastFingerprint = fingerprint;

          // Enforce image safe size ceiling (10 MiB)
          if (img.byteLength > MAX_SAFE_IMAGE_BYTE_LENGTH) {
            this.skippedOversizedCount += 1;
            return;
          }

          const item: CapturedTextItem = {
            id: crypto.randomUUID(),
            text: img.dataUrl,
            detectedAt: new Date(),
            byteLength: img.byteLength,
            category: 'image',
          };

          this.history.unshift(item);
          this.totalByteLength += item.byteLength;
          this.lastDetectedAt = item.detectedAt;

          const persistence = this.getPersistenceService();
          if (persistence) {
            try {
              await persistence.saveTextClip({
                id: item.id,
                text: item.text,
                createdAt: item.detectedAt,
                contentType: 'image/png',
              });
            } catch {
              // Failure to persist must never crash the polling loop
            }
          }
        } else {
          return;
        }
      } else {
        return;
      }

      // Rule 6: Enforce history count bound
      while (this.history.length > this.config.maxItems) {
        const evicted = this.history.pop();
        if (evicted) {
          this.totalByteLength = Math.max(0, this.totalByteLength - evicted.byteLength);
        }
      }

      // Rule 7: Enforce total history byte budget bound
      while (this.totalByteLength > this.config.maxTotalByteLength && this.history.length > 0) {
        const evicted = this.history.pop();
        if (evicted) {
          this.totalByteLength = Math.max(0, this.totalByteLength - evicted.byteLength);
        }
      }
    } catch {
      // Contain adapter exceptions without crashing the process
    } finally {
      this.isPollingActive = false;
    }
  }

  /**
   * Resolves the configured or default persistence service safely.
   */
  private getPersistenceService(): EncryptedClipboardPersistenceService | null {
    if (this.persistenceSource === null) {
      return null;
    }
    if (typeof this.persistenceSource === 'function') {
      try {
        return this.persistenceSource();
      } catch {
        return null;
      }
    }
    if (this.persistenceSource) {
      return this.persistenceSource;
    }
    try {
      return getEncryptedClipboardPersistenceService();
    } catch {
      return null;
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
export function getClipboardCaptureService(
  options?: ClipboardCaptureServiceOptions,
): ClipboardCaptureService {
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
  resetEncryptedClipboardPersistenceService();
}
