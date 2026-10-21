import { app, BrowserWindow } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
const RENDERER_URL = process.env.RENDERER_URL || 'http://127.0.0.1:3000';

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

  mainWindow.webContents.on('did-finish-load', async () => {
    console.log('[ClipOrbit Main] Renderer page finished loading successfully.');

    // Programmatic verification of secure renderer environment
    try {
      const securityStatus = await mainWindow?.webContents.executeJavaScript(
        '({ hasProcess: typeof window.process !== "undefined", hasRequire: typeof window.require !== "undefined", title: document.title })',
      );
      console.log(
        '[ClipOrbit Security Check] Sandbox isolation verification:',
        JSON.stringify(securityStatus),
      );
    } catch (err) {
      console.error('[ClipOrbit Security Check] Failed to execute security probe:', err);
    }
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
