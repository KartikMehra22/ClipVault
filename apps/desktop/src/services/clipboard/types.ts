/**
 * ClipOrbit — In-Memory Clipboard Capture Engine Types and Contracts
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Defines contracts, configuration bounds, and data structures
 * for text-only clipboard change detection and bounded in-memory buffering.
 */

/**
 * Organizational category detected for captured text content.
 * Note: Classification is metadata for organization, not a security assessment.
 */
export type ContentCategory = 'url' | 'email' | 'code' | 'text' | 'image';

/**
 * Image payload read from the system clipboard.
 */
export interface ClipboardImagePayload {
  /** Complete base64 Data URL (e.g. data:image/png;base64,...) */
  dataUrl: string;
  /** Binary byte length of the image payload */
  byteLength: number;
  /** Image pixel width */
  width?: number;
  /** Image pixel height */
  height?: number;
}

/**
 * An individual captured clipboard entry stored in process memory.
 *
 * PRIVACY NOTICE:
 * This in-memory record can contain sensitive plaintext while capture is active.
 * Persistence to disk or database is strictly governed by user consent.
 */
export interface CapturedTextItem {
  /** Unique in-memory identifier (UUID v4) not derived from content. */
  id: string;
  /** Captured plaintext content or image data URL. */
  text: string;
  /** Timestamp when the change was detected by the polling engine. */
  detectedAt: Date;
  /** Actual UTF-8 / payload byte length of the content. */
  byteLength: number;
  /** Categorization determined by deterministic heuristics. */
  category: ContentCategory;
}

/**
 * Diagnostic status for the clipboard capture service.
 * Exposes strictly non-sensitive telemetry.
 */
export interface ClipboardCaptureStatus {
  /** Whether the polling engine is actively running. */
  isRunning: boolean;
  /** Whether capture is temporarily paused. */
  isPaused: boolean;
  /** Current number of items held in the bounded in-memory history. */
  itemCount: number;
  /** Total UTF-8 byte length currently held in memory across all items. */
  totalByteLength: number;
  /** Number of clipboard changes skipped due to exceeding maxItemByteLength. */
  skippedOversizedCount: number;
  /** Number of clipboard changes excluded due to sensitive content detection. */
  skippedSensitiveCount: number;
  /** Timestamp of the most recent detected item, or null if none. */
  lastDetectedAt: Date | null;
}

/**
 * Abstract interface for reading clipboard text and images.
 * Allows decoupling from Electron's native clipboard module during automated tests.
 */
export interface IClipboardAdapter {
  /**
   * Reads the current text from the clipboard.
   * Returns empty string if no text is present or clipboard is empty.
   */
  readText(): string | Promise<string>;

  /**
   * Reads the current image from the clipboard.
   * Returns null if no image is present or clipboard is empty.
   */
  readImage?(): ClipboardImagePayload | null | Promise<ClipboardImagePayload | null>;
}

/**
 * Maximum safe UTF-8 byte length permitted for any single clipboard text item.
 * Exactly matches the sensitive detector's safe scanning ceiling (64 KiB = 65,536 bytes).
 * Ensures items are never accepted after scanning only a truncated prefix.
 */
export const MAX_SAFE_ITEM_BYTE_LENGTH = 64 * 1024; // 64 KiB = 65,536 bytes

/**
 * Maximum safe byte length permitted for captured image entries (10 MiB).
 * Large screenshots or high-res captures are safely bounded to prevent unbounded memory growth.
 */
export const MAX_SAFE_IMAGE_BYTE_LENGTH = 10 * 1024 * 1024; // 10 MiB = 10,485,760 bytes

/**
 * Configuration options for the clipboard capture service.
 */
export interface ClipboardCaptureConfig {
  /** Polling interval in milliseconds (default: 600ms, minimum: 50ms). */
  pollingIntervalMs?: number;
  /** Maximum number of history items to retain in memory (default: 100). */
  maxItems?: number;
  /**
   * Maximum UTF-8 byte length permitted for a single item (default: 64 KiB = 65,536 bytes; maximum: 64 KiB).
   * Must not exceed MAX_SAFE_ITEM_BYTE_LENGTH to guarantee complete sensitive-content scanning.
   */
  maxItemByteLength?: number;
  /** Maximum aggregate byte length across all in-memory items (default: 32 MiB). */
  maxTotalByteLength?: number;
}

/**
 * Default configuration values for the in-memory capture engine.
 */
export const DEFAULT_CAPTURE_CONFIG: Required<ClipboardCaptureConfig> = {
  pollingIntervalMs: 600,
  maxItems: 100,
  maxItemByteLength: MAX_SAFE_ITEM_BYTE_LENGTH, // 64 KiB
  maxTotalByteLength: 32 * 1024 * 1024, // 32 MiB
};

// ---------------------------------------------------------------------------
// Error Hierarchy
// ---------------------------------------------------------------------------

/**
 * Base error for clipboard capture operations.
 */
export class ClipboardCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClipboardCaptureError';
  }
}

/**
 * Thrown when configuration parameters fail validation.
 */
export class ClipboardValidationError extends ClipboardCaptureError {
  constructor(message: string) {
    super(message);
    this.name = 'ClipboardValidationError';
  }
}
