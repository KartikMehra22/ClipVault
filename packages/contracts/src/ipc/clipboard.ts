/**
 * Clipboard IPC contract definitions for ClipOrbit
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 */

export type ClipCategory = 'url' | 'email' | 'code' | 'text';

/**
 * Safe, serialized representation of an in-memory captured clip entry for renderer consumption.
 * Contains no Node.js Buffers, raw cryptographic digests, or database entities.
 */
export interface CapturedClipDto {
  /** Stable in-memory UUID */
  id: string;
  /** Captured UTF-8 plaintext content */
  text: string;
  /** ISO 8601 string timestamp when detected by the polling engine */
  detectedAt: string;
  /** Actual UTF-8 byte length of the content */
  byteLength: number;
  /** Categorization determined by deterministic heuristics */
  category: ClipCategory;
}

/**
 * Non-sensitive capture status telemetry for renderer consumption.
 * Strictly omits clipboard text, secret keys, file paths, or internal hashes.
 */
export interface ClipboardStatusDto {
  /** Whether the capture engine is actively running */
  isRunning: boolean;
  /** Whether capture is temporarily paused */
  isPaused: boolean;
  /** Number of items currently retained in memory */
  itemCount: number;
  /** Total UTF-8 bytes retained in memory */
  totalByteLength: number;
  /** Count of oversized items skipped due to exceeding maxItemByteLength (safe scan limit of 64 KiB) */
  skippedOversizedCount: number;
  /** Count of sensitive items excluded from capture */
  skippedSensitiveCount: number;
  /** ISO 8601 string timestamp of last detected item, or null */
  lastDetectedAt: string | null;
}
