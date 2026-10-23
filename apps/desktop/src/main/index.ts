import { app, BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { IPC_CHANNELS, type DesktopInfo } from '@cliporbit/contracts';
import { isAuthorizedFrame } from './security';
import { initializeDatabase, closeDatabase } from '../services/database';
import { initializeEncryptionService, disposeEncryptionService } from '../services/crypto';
import { disposeClipboardCaptureService } from '../services/clipboard';
import { LifecycleCoordinator, type AppReadinessStatus } from './lifecycle';
import { registerClipboardIpcHandlers } from './clipboardIpc';
import { registerSettingsIpcHandlers } from './settingsIpc';
import { registerSnippetIpcHandlers } from './snippetIpc';
import { resolveRendererOutDir, startRendererServer, type StaticServer } from './staticServer';

let mainWindow: BrowserWindow | null = null;
let staticRendererServer: StaticServer | null = null;
let activeRendererUrl = 'http://127.0.0.1:3000';
let allowedRendererOrigin = 'http://127.0.0.1:3000';
let ipcRegistered = false;

const isDev = !app.isPackaged;

app.name = 'ClipOrbit';

/**
 * Returns the currently authorized renderer origin for frame validation.
 */
export function getAllowedRendererOrigin(): string {
  return allowedRendererOrigin;
}

/**
 * Updates the authorized renderer origin (useful for testing or dynamic ports).
 */
export function setAllowedRendererOrigin(origin: string): void {
  allowedRendererOrigin = origin;
}

/**
 * Validates that an incoming IPC invocation originates strictly from the authorized renderer.
 */
function isAuthorizedSender(event: IpcMainInvokeEvent): boolean {
  return isAuthorizedFrame(event.senderFrame, allowedRendererOrigin);
}

/**
 * Handler for desktop information request.
 * Strictly returns the application name, version, and operating system platform.
 */
function handleGetDesktopInfo(event: IpcMainInvokeEvent): DesktopInfo {
  if (!isAuthorizedSender(event)) {
    console.warn(
      '[ClipOrbit Main] Security Warning: Rejected unauthorized IPC request from sender URL:',
      event.senderFrame?.url || '<unknown>',
    );
    throw new Error('Unauthorized IPC sender origin or frame.');
  }

  const info: DesktopInfo = {
    appName: app.name || 'ClipOrbit',
    appVersion: app.getVersion() || '0.1.0',
    platform: process.platform,
  };

  console.log(
    `[ClipOrbit Main] Authorized IPC request handled successfully from ${event.senderFrame?.url}:`,
    JSON.stringify(info),
  );

  return info;
}

/**
 * Registers all secure IPC handlers prior to window creation.
 * Idempotent: safe against duplicate invocation.
 */
function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.handle(IPC_CHANNELS.APP_GET_DESKTOP_INFO, handleGetDesktopInfo);
  registerClipboardIpcHandlers({
    isAuthorized: isAuthorizedSender,
    isShutdown: () =>
      lifecycleCoordinator.isShutdownInProgress() || lifecycleCoordinator.isShutdownCompleted(),
  });
  registerSettingsIpcHandlers({
    isAuthorized: isAuthorizedSender,
    isShutdown: () =>
      lifecycleCoordinator.isShutdownInProgress() || lifecycleCoordinator.isShutdownCompleted(),
  });
  registerSnippetIpcHandlers({
    isAuthorized: isAuthorizedSender,
    isShutdown: () =>
      lifecycleCoordinator.isShutdownInProgress() || lifecycleCoordinator.isShutdownCompleted(),
  });
  console.log('[ClipOrbit Main] Registered secure IPC handlers.');
}

/**
 * Resolves the appropriate renderer target URL and origin.
 * In production or packaged mode, serves static export assets on loopback.
 * In development, uses the Next.js dev server at http://127.0.0.1:3000.
 */
async function resolveRendererTarget(): Promise<{ url: string; origin: string }> {
  if (process.env.RENDERER_URL) {
    const rawUrl = process.env.RENDERER_URL.trim();
    try {
      const parsed = new URL(rawUrl);
      return { url: rawUrl, origin: parsed.origin };
    } catch {
      return { url: rawUrl, origin: 'http://127.0.0.1:3000' };
    }
  }

  const outDir = resolveRendererOutDir();
  if (app.isPackaged || process.env.NODE_ENV === 'production' || outDir) {
    if (outDir) {
      console.log(`[ClipOrbit Main] Serving packaged renderer assets from: ${outDir}`);
      staticRendererServer = await startRendererServer(outDir);
      console.log(
        `[ClipOrbit Main] Internal renderer server running at: ${staticRendererServer.url}`,
      );
      return { url: staticRendererServer.url, origin: staticRendererServer.origin };
    }
  }

  return { url: 'http://127.0.0.1:3000', origin: 'http://127.0.0.1:3000' };
}

/**
 * Loads the renderer URL into the BrowserWindow with retry logic,
 * allowing the application to wait for the development server to finish starting.
 */
async function loadRendererWithRetry(
  window: BrowserWindow,
  targetUrl: string,
  maxAttempts = 30,
  intervalMs = 500,
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (window.isDestroyed()) {
      return;
    }

    try {
      if (attempt > 1) {
        console.log(
          `[ClipOrbit Main] Waiting for renderer at ${targetUrl} (attempt ${attempt}/${maxAttempts})...`,
        );
      }
      await window.loadURL(targetUrl);
      console.log(`[ClipOrbit Main] Successfully loaded renderer from ${targetUrl}.`);
      return;
    } catch (err) {
      if (window.isDestroyed()) {
        return;
      }

      if (attempt === maxAttempts) {
        console.error(
          `[ClipOrbit Main] Fatal: Timed out waiting for renderer at ${targetUrl} after ${maxAttempts} attempts.`,
          err,
        );
        dialog.showErrorBox(
          'ClipOrbit — Renderer Connection Failed',
          `Could not connect to the renderer at ${targetUrl}.\n\n` +
            `Ensure the Next.js development server is running ("pnpm dev") or compile production assets ("pnpm build").`,
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return mainWindow;
  }

  const preloadPath = path.join(__dirname, '../preload/index.js');
  console.log('[ClipOrbit Main] Initializing BrowserWindow (Title: "ClipOrbit", Size: 960x640)');
  console.log('[ClipOrbit Main] Preload script path:', preloadPath);

  mainWindow = new BrowserWindow({
    title: 'ClipOrbit',
    width: 960,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: '#0b0f19',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (event, ...legacyArgs) => {
      const message =
        typeof event === 'object' && event !== null && 'message' in event
          ? String((event as unknown as { message: unknown }).message)
          : typeof legacyArgs[1] === 'string'
            ? legacyArgs[1]
            : '';
      const level =
        typeof event === 'object' && event !== null && 'level' in event
          ? String((event as unknown as { level: unknown }).level)
          : String(legacyArgs[0] ?? 0);
      // Redact potential 64-char hex key strings before logging
      const sanitized = message.replace(/\b[0-9a-fA-F]{64}\b/g, '[REDACTED_KEY]');
      if (sanitized.trim()) {
        console.log(`[ClipOrbit WebContents Log] [Level ${level}]: ${sanitized}`);
      }
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[ClipOrbit Main] Renderer page finished loading successfully.');
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[ClipOrbit Main] Window ready-to-show event triggered; showing window.');
    if (process.env.CLIPORBIT_SMOKE_TEST !== '1') {
      mainWindow?.show();
    }
  });

  loadRendererWithRetry(mainWindow, activeRendererUrl).catch((err: unknown) => {
    console.error(`[ClipOrbit Main] Unexpected error while loading renderer URL:`, err);
  });

  if (isDev && process.env.CLIPORBIT_SMOKE_TEST !== '1') {
    console.log('[ClipOrbit Main] Development mode active: opening DevTools.');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    console.log('[ClipOrbit Main] Window closed.');
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Global lifecycle coordinator configured with runtime database, encryption,
 * static server, and Electron window dependencies.
 */
const lifecycleCoordinator = new LifecycleCoordinator({
  initializeDatabase: async () => {
    const dbResult = await initializeDatabase();
    console.log(
      `[ClipOrbit Main] Runtime database initialized and verified at: ${dbResult.paths.dbFilePath}`,
    );
    if (dbResult.migrationSummary) {
      console.log(`[ClipOrbit Main] Migration summary:\n${dbResult.migrationSummary}`);
    }
    return dbResult;
  },
  closeDatabase: async () => {
    await closeDatabase();
  },
  initializeEncryption: async () => {
    const encResult = await initializeEncryptionService();
    console.log(
      `[ClipOrbit Main] Local encryption service initialized. Master key stored at: ${encResult.masterKeyPath}`,
    );
    return encResult;
  },
  disposeEncryption: () => {
    disposeEncryptionService();
  },
  disposeClipboard: () => {
    disposeClipboardCaptureService();
  },
  disposeServer: async () => {
    if (staticRendererServer) {
      await staticRendererServer.close();
      staticRendererServer = null;
    }
  },
  createWindow: () => createWindow(),
  showErrorBox: (title, content) => dialog.showErrorBox(title, content),
  quitApp: () => app.quit(),
  log: (msg) => console.log(msg),
  logError: (msg, err) => console.error(msg, err),
});

/**
 * Returns non-secret readiness status for internal diagnostics.
 */
function getReadinessStatus(): AppReadinessStatus {
  return lifecycleCoordinator.getStatus();
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  console.warn('[ClipOrbit Main] Another instance is already running. Exiting.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    console.log('[ClipOrbit Main] Electron app ready event received.');

    // Determine target renderer URL and origin
    try {
      const target = await resolveRendererTarget();
      activeRendererUrl = target.url;
      allowedRendererOrigin = target.origin;
    } catch (targetErr) {
      console.error('[ClipOrbit Main] Failed to resolve renderer target:', targetErr);
    }

    registerIpcHandlers();

    // Execute orderly startup: DB -> Encryption -> Window
    const startupSuccess = await lifecycleCoordinator.startup();
    if (!startupSuccess) {
      console.warn('[ClipOrbit Main] Startup sequence aborted due to initialization failure.');
      return;
    }

    // Automated smoke test verification hook
    if (process.env.CLIPORBIT_SMOKE_TEST === '1') {
      console.log(
        '[ClipOrbit Main] Smoke test startup verified successfully. Initiating clean exit...',
      );
      setTimeout(() => {
        app.quit();
      }, 500);
      return;
    }

    app.on('activate', () => {
      console.log('[ClipOrbit Main] macOS application activate event received.');
      if (
        BrowserWindow.getAllWindows().length === 0 &&
        lifecycleCoordinator.getStatus().isFullyReady
      ) {
        createWindow();
      }
    });
  });

  app.on('before-quit', (event) => {
    if (lifecycleCoordinator.isShutdownCompleted()) {
      return;
    }

    event.preventDefault();

    if (lifecycleCoordinator.isShutdownInProgress()) {
      return;
    }

    console.log('[ClipOrbit Main] Graceful shutdown sequence initiated...');
    lifecycleCoordinator
      .shutdown()
      .then(() => {
        console.log('[ClipOrbit Main] Graceful shutdown completed cleanly.');
      })
      .catch((err) => {
        console.error('[ClipOrbit Main] Error during shutdown:', err);
      })
      .finally(() => {
        app.quit();
      });
  });

  app.on('window-all-closed', () => {
    console.log('[ClipOrbit Main] All windows closed.');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

export {
  isAuthorizedSender,
  handleGetDesktopInfo,
  lifecycleCoordinator,
  getReadinessStatus,
  registerIpcHandlers,
  createWindow,
};
