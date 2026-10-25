/**
 * ClipOrbit — Clipboard Adapters
 * Phase 5.1: In-Memory Clipboard Capture Engine
 *
 * Implements the production Electron clipboard adapter and a fake adapter
 * for hermetic automated unit tests.
 */

import { type IClipboardAdapter, type ClipboardImagePayload } from './types';

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

  public async readImage(): Promise<ClipboardImagePayload | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = (this.customClipboard !== undefined ? this.customClipboard : getElectronClipboard()) as any;
    if (!cb) {
      return null;
    }

    // Method A: Modern Electron 44 W3C Async Clipboard API (cb.read())
    if (typeof cb.read === 'function') {
      try {
        const items = await cb.read();
        if (Array.isArray(items)) {
          for (const item of items) {
            if (!item || !Array.isArray(item.types)) continue;
            for (const type of item.types) {
              if (typeof type === 'string' && type.startsWith('image/')) {
                const blob = await item.getType(type);
                if (blob && typeof blob.arrayBuffer === 'function') {
                  const arrayBuffer = await blob.arrayBuffer();
                  const buffer = Buffer.from(arrayBuffer);
                  const base64 = buffer.toString('base64');
                  const dataUrl = `data:${type};base64,${base64}`;
                  return {
                    dataUrl,
                    byteLength: buffer.byteLength,
                  };
                }
              }
            }
          }
        }
      } catch {
        // Fall through to legacy NativeImage check
      }
    }

    // Method B: Legacy Electron NativeImage API (cb.readImage())
    if (typeof cb.readImage === 'function') {
      try {
        const nativeImg = cb.readImage();
        if (!nativeImg || nativeImg.isEmpty()) {
          return null;
        }
        const size = nativeImg.getSize();
        if (size.width === 0 || size.height === 0) {
          return null;
        }

        // Constrain ultra-high-resolution images (e.g. 5K/8K captures) to max 1920px on the longest edge
        let finalImg = nativeImg;
        const maxDimension = 1920;
        if (size.width > maxDimension || size.height > maxDimension) {
          const scale = Math.min(maxDimension / size.width, maxDimension / size.height);
          finalImg = nativeImg.resize({
            width: Math.max(1, Math.round(size.width * scale)),
            height: Math.max(1, Math.round(size.height * scale)),
            quality: 'good',
          });
        }

        const pngBuf = finalImg.toPNG();
        const finalSize = finalImg.getSize();
        const dataUrl = finalImg.toDataURL();

        return {
          dataUrl,
          byteLength: pngBuf.byteLength,
          width: finalSize.width,
          height: finalSize.height,
        };
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * Checks whether the current clipboard contents originate from a password manager
   * or are flagged as concealed / transient / private pasteboard types.
   */
  public async isConcealed(): Promise<boolean> {
    const cb = (this.customClipboard !== undefined ? this.customClipboard : getElectronClipboard()) as any;
    if (!cb) {
      return false;
    }
    try {
      if (typeof cb.formats === 'function') {
        const formats = cb.formats();
        const sensitiveFormats = [
          'org.nspasteboard.ConcealedType',
          'org.nspasteboard.TransientType',
          'com.agilebits.onepassword',
          'de.keeweb.keeweb',
          'Clipboard Viewer Ignore',
          'ExcludeClipboardContentFromMonitorProcessing',
          'x-kde-passwordManagerHint',
        ];
        if (Array.isArray(formats)) {
          for (const fmt of sensitiveFormats) {
            if (formats.includes(fmt)) {
              return true;
            }
          }
        }
      }
      if (typeof cb.has === 'function') {
        const isConcealed = await cb.has('org.nspasteboard.ConcealedType');
        if (isConcealed) return true;

        const isTransient = await cb.has('org.nspasteboard.TransientType');
        if (isTransient) return true;

        const isOnePassword = await cb.has('com.agilebits.onepassword');
        if (isOnePassword) return true;
      }
    } catch {
      return false;
    }
    return false;
  }
}

/**
 * In-memory test adapter allowing automated tests to control clipboard content,
 * inspect read counts, and simulate adapter faults without accessing system clipboard.
 */
export class FakeClipboardAdapter implements IClipboardAdapter {
  private currentText = '';
  private currentImage: ClipboardImagePayload | null = null;
  private isConcealedFlag = false;
  private readCount = 0;
  private imageReadCount = 0;
  private simulatedError: Error | null = null;

  constructor(initialText = '') {
    this.currentText = initialText;
  }

  /**
   * Updates the simulated clipboard text.
   */
  public setText(text: string): void {
    this.currentText = text;
  }

  /**
   * Updates the simulated clipboard image.
   */
  public setImage(image: ClipboardImagePayload | null): void {
    this.currentImage = image;
  }

  /**
   * Toggles the concealed / password manager simulation flag.
   */
  public setConcealed(val: boolean): void {
    this.isConcealedFlag = val;
  }

  public isConcealed(): boolean {
    return this.isConcealedFlag;
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
   * Reads current simulated clipboard image and tracks image read invocations.
   */
  public readImage(): ClipboardImagePayload | null {
    this.imageReadCount += 1;
    if (this.simulatedError) {
      throw this.simulatedError;
    }
    return this.currentImage;
  }

  /**
   * Returns how many times readText() has been called.
   */
  public getReadCount(): number {
    return this.readCount;
  }

  /**
   * Returns how many times readImage() has been called.
   */
  public getImageReadCount(): number {
    return this.imageReadCount;
  }

  /**
   * Resets read counters to zero.
   */
  public resetReadCount(): void {
    this.readCount = 0;
    this.imageReadCount = 0;
  }

  /**
   * Configures an error to be thrown on subsequent read calls, or null to clear.
   */
  public simulateError(error: Error | null): void {
    this.simulatedError = error;
  }
}
