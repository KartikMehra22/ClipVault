/**
 * Clipboard IPC contract definitions for ClipOrbit
 * Phase 5.2: Secure Clipboard Controls and Live History UI
 */

export type ClipCategory = 'url' | 'email' | 'code' | 'text' | 'image';

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

/**
 * Safe, serialized representation of a decrypted persisted clip entry for renderer consumption.
 * Strictly omits database entities, raw ciphertext, nonces, authentication tags, and encryption keys.
 */
export interface PersistedClipDto {
  /** Stable UUID matching in-memory and database record */
  id: string;
  /** Decrypted UTF-8 plaintext content */
  text: string;
  /** ISO 8601 string timestamp when the clip was originally detected / created */
  createdAt: string;
  /** Actual UTF-8 byte length of the content */
  byteLength: number;
  /** Categorization determined by deterministic heuristics */
  category: ClipCategory;
  /** Whether the clip is pinned in persistent storage */
  isPinned: boolean;
  /** Source application metadata if present */
  sourceApp?: string | null;
}

/**
 * Successful response containing decrypted persisted clips.
 */
export interface PersistedClipsSuccess {
  success: true;
  clips: PersistedClipDto[];
}

/**
 * Sanitized failure response for persisted history retrieval.
 * Strictly omits database exceptions, filesystem paths, ciphertext, or keys.
 */
export interface PersistedClipsFailure {
  success: false;
  error: string;
}

/**
 * Narrow, typed, renderer-safe result distinguishing successful empty retrieval from query failures.
 */
export type PersistedClipsResult = PersistedClipsSuccess | PersistedClipsFailure;

/**
 * Sanitized successful response for clear-history operation.
 */
export interface ClearHistorySuccess {
  success: true;
  clearedCount: number;
}

/**
 * Sanitized failure response for clear-history operation.
 * Strictly omits database exceptions, filesystem paths, ciphertext, or keys.
 */
export interface ClearHistoryFailure {
  success: false;
  error: string;
}

/**
 * Narrow, typed, renderer-safe result for clear-history operations.
 */
export type ClearHistoryResult = ClearHistorySuccess | ClearHistoryFailure;

/**
 * Merged representation of a clip combining live and persisted sources for presentation.
 * Strictly omits database entities, raw ciphertext, nonces, authentication tags, and encryption keys.
 */
export interface MergedClipDto {
  /** Stable UUID */
  id: string;
  /** UTF-8 plaintext content (prefers active in-memory representation if present) */
  text: string;
  /** ISO 8601 string timestamp of capture/detection or creation */
  createdAt: string;
  /** Actual UTF-8 byte length of the content */
  byteLength: number;
  /** Categorization */
  category: ClipCategory;
  /** Whether the clip is pinned */
  isPinned: boolean;
  /** Whether the clip exists in persistent storage */
  isPersisted: boolean;
  /** Source application metadata if present */
  sourceApp?: string | null;
}

/**
 * Merges live in-memory captures and persisted database clips into a single unified list.
 * Deduplicates by stable clip ID, preferring live in-memory representation for the active session.
 * Orders consistently by actual creation timestamp, newest first, and respects the display limit.
 */
export function mergeHistoryClips(
  liveClips: CapturedClipDto[],
  persistedClips: PersistedClipDto[],
  sessionPinnedIds: Set<string> | Iterable<string> = new Set(),
  maxLimit: number = 100,
): {
  clips: MergedClipDto[];
  persistedIds: Set<string>;
  allPinnedIds: Set<string>;
} {
  const sessionPinnedSet =
    sessionPinnedIds instanceof Set ? sessionPinnedIds : new Set(sessionPinnedIds);
  const persistedIds = new Set<string>();
  const allPinnedIds = new Set<string>(sessionPinnedSet);
  const clipMap = new Map<string, { clip: MergedClipDto; timestamp: number }>();

  // 1. Ingest persisted clips
  for (const persisted of persistedClips) {
    persistedIds.add(persisted.id);
    const isPinned = sessionPinnedSet.has(persisted.id) || Boolean(persisted.isPinned);
    if (isPinned) {
      allPinnedIds.add(persisted.id);
    }

    const timestamp = new Date(persisted.createdAt).getTime();
    clipMap.set(persisted.id, {
      clip: {
        id: persisted.id,
        text: persisted.text,
        createdAt: persisted.createdAt,
        byteLength: persisted.byteLength,
        category: persisted.category,
        isPinned,
        isPersisted: true,
        sourceApp: persisted.sourceApp ?? null,
      },
      timestamp: isNaN(timestamp) ? 0 : timestamp,
    });
  }

  // 2. Ingest live clips (prefer active in-memory representation for duplicate IDs)
  for (const live of liveClips) {
    const existing = clipMap.get(live.id);
    const isPersisted = Boolean(existing?.clip.isPersisted);
    const isPinned = sessionPinnedSet.has(live.id) || Boolean(existing?.clip.isPinned);

    if (isPinned) {
      allPinnedIds.add(live.id);
    }

    const timestamp = new Date(live.detectedAt).getTime();
    clipMap.set(live.id, {
      clip: {
        id: live.id,
        text: live.text,
        createdAt: live.detectedAt,
        byteLength: live.byteLength,
        category: live.category,
        isPinned,
        isPersisted,
        sourceApp: existing?.clip.sourceApp ?? null,
      },
      timestamp: isNaN(timestamp) ? 0 : timestamp,
    });
  }

  // 3. Sort by actual creation/capture timestamp, newest first
  const sorted = Array.from(clipMap.values()).sort((a, b) => b.timestamp - a.timestamp);

  // 4. Bound to maximum display limit
  const limitedClips = sorted.slice(0, maxLimit).map((entry) => entry.clip);

  return {
    clips: limitedClips,
    persistedIds,
    allPinnedIds,
  };
}
