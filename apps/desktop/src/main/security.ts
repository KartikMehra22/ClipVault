export interface SenderFrameInfo {
  url?: string | null;
  parent?: unknown | null;
}

/**
 * Validates whether an incoming frame invocation originates strictly from the authorized renderer.
 *
 * Requirements:
 * 1. Frame and frame URL must be present.
 * 2. Frame must be top-level (parent === null or undefined); child frames/iframes are rejected.
 * 3. URL origin must exactly match the expected allowed origin.
 *
 * @param frame Information about the sender frame (URL and frame hierarchy).
 * @param allowedOrigin The expected authorized origin (e.g. 'http://127.0.0.1:3000').
 * @returns boolean indicating whether the sender is authorized.
 */
export function isAuthorizedFrame(
  frame: SenderFrameInfo | null | undefined,
  allowedOrigin: string,
): boolean {
  if (!frame || !frame.url) {
    return false;
  }

  // Reject child frames / iframes: only top-level trusted frames may invoke IPC
  if (frame.parent !== null && frame.parent !== undefined) {
    return false;
  }

  try {
    const frameOrigin = new URL(frame.url).origin;
    const expectedOrigin = new URL(allowedOrigin).origin;
    return frameOrigin === expectedOrigin;
  } catch {
    return false;
  }
}
