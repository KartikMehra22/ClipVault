import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import path from 'path';
import { IPC_CHANNELS, type DesktopInfo } from '@cliporbit/contracts';
import { isAuthorizedFrame } from './security';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
const RENDERER_URL = process.env.RENDERER_URL || 'http://127.0.0.1:3000';
const ALLOWED_RENDERER_ORIGIN = 'http://127.0.0.1:3000';

app.name = 'ClipOrbit';

/**
 * Validates that an incoming IPC invocation originates strictly from the authorized renderer.
 */
function isAuthorizedSender(event: IpcMainInvokeEvent): boolean {
  return isAuthorizedFrame(event.senderFrame, ALLOWED_RENDERER_ORIGIN);
}

/**
 * Handler for desktop information request.
 * Strictly returns the application name, version and operating system platform.
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
 */
function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_DESKTOP_INFO, handleGetDesktopInfo);
  console.log('[ClipOrbit Main] Registered secure IPC handlers.');
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

  mainWindow.webContents.on('console-message', (_event, level, message) => {
    console.log(`[ClipOrbit WebContents Log] [Level ${level}]: ${message}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[ClipOrbit Main] Renderer page finished loading successfully.');
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[ClipOrbit Main] Window ready-to-show event triggered; showing window.');
    mainWindow?.show();
  });

  mainWindow.loadURL(RENDERER_URL).catch((err: unknown) => {
    console.error(
      `[ClipOrbit Main] Error: Failed to connect to renderer server at ${RENDERER_URL}. Ensure Next.js is running.`,
      err,
    );
  });

  if (isDev) {
    console.log('[ClipOrbit Main] Development mode active: opening DevTools.');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    console.log('[ClipOrbit Main] Window closed.');
    mainWindow = null;
  });

  return mainWindow;
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

  app.whenReady().then(() => {
    console.log('[ClipOrbit Main] Electron app ready event received.');
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
      console.log('[ClipOrbit Main] macOS application activate event received.');
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    console.log('[ClipOrbit Main] All windows closed.');
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

export { isAuthorizedSender, handleGetDesktopInfo };
