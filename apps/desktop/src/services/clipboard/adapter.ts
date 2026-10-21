/**
 * ClipOrbit — Clipboard Adapters
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Implements the production Electron clipboard adapter and a fake adapter
 * for hermetic automated unit tests.
 */

import { type IClipboardAdapter } from './types';

/**
 * Safely resolves the Electron clipboard object at call time (not import time).
 */
function getElectronClipboard(): typeof import('electron').clipboard | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const electron = require('electron');
    if (typeof electron === 'object' && electron !== null && 'clipboard' in electron) {
      return electron.clipboard;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Production clipboard adapter backed by Electron's native clipboard API.
 * Never executes clipboard operations on import.
 */
export class ElectronClipboardAdapter implements IClipboardAdapter {
  private readonly customClipboard?: typeof import('electron').clipboard | null;

  constructor(customClipboard?: typeof import('electron').clipboard | null) {
    this.customClipboard = customClipboard;
  }

  public async readText(): Promise<string> {
    const cb = this.customClipboard !== undefined ? this.customClipboard : getElectronClipboard();
    if (!cb || typeof cb.readText !== 'function') {
      return '';
    }
    try {
      const result = await cb.readText();
      return typeof result === 'string' ? result : '';
    } catch {
      return '';
    }
  }
}

/**
 * In-memory test adapter allowing automated tests to control clipboard content,
 * inspect read counts, and simulate adapter faults without accessing system clipboard.
 */
export class FakeClipboardAdapter implements IClipboardAdapter {
  private currentText = '';
  private readCount = 0;
  private simulatedError: Error | null = null;

  constructor(initialText = '') {
    this.currentText = initialText;
  }

  /**
   * Updates the simulated clipboard content.
   */
  public setText(text: string): void {
    this.currentText = text;
  }

  /**
   * Reads current simulated clipboard text and tracks read invocations.
   */
  public readText(): string {
    this.readCount += 1;
    if (this.simulatedError) {
      throw this.simulatedError;
    }
    return this.currentText;
  }

  /**
   * Returns how many times readText() has been called.
   */
  public getReadCount(): number {
    return this.readCount;
  }

  /**
   * Resets read counter to zero.
   */
  public resetReadCount(): void {
    this.readCount = 0;
  }

  /**
   * Configures an error to be thrown on subsequent readText() calls, or null to clear.
   */
  public simulateError(error: Error | null): void {
    this.simulatedError = error;
  }
}
