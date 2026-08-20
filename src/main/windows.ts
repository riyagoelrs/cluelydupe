import * as path from 'node:path';
import { BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron';
import type { Config } from './config';
import { explainCaptureFailure } from './permissions';
import { registerOperatorUi } from './operator-ui';
import { clampToDisplay, type WindowState } from './window-state';

const OVERLAY_WIDTH = 540;
const OVERLAY_HEIGHT = 58;
const MARGIN = 24;
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 58;

let windowControlHandlersInstalled = false;

function installWindowControlHandlers(): void {
  if (windowControlHandlersInstalled) return;
  windowControlHandlersInstalled = true;

  ipcMain.on('ctl:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    win.minimize();
  });
}

export function createOverlayWindow(cfg: Config, state: WindowState = {}): BrowserWindow {
  // Setup/notes/materials share the same live config object as Whisper and the
  // answer engine, so a model chosen in Setup is usable immediately.
  registerOperatorUi(cfg, () => ipcMain.emit('ctl:reload-materials'));
  installWindowControlHandlers();

  const work = screen.getPrimaryDisplay().workArea;
  const width = Math.min(
    Math.max(MIN_WIDTH, state.width ?? OVERLAY_WIDTH),
    work.width - MARGIN * 2,
  );

  // Always launch compact. Expanded answer/settings heights are transient UI
  // state and should never turn the next launch back into a giant empty panel.
  const bounds = clampToDisplay({
    width,
    height: OVERLAY_HEIGHT,
    x: state.x ?? work.x + work.width - width - MARGIN,
    y: state.y ?? work.y + MARGIN,
  });

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minimizable: true,
    maximizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  // Normal-window behavior is the default. Pin is an explicit, session-only
  // choice for moments when the user actually wants the answer above a call.
  setPinned(win, false);
  win.setContentProtection(cfg.contentProtection);

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.once('ready-to-show', () => win.showInactive());

  return win;
}

export function setPinned(win: BrowserWindow, pinned: boolean): void {
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
}

export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));
  return win;
}

export function installMediaHandlers(onProblem: (message: string) => void): void {
  const s = session.defaultSession;

  s.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screenSource = sources[0];
          if (!screenSource) {
            onProblem(explainCaptureFailure(new Error('no screen sources returned')));
            callback({ video: undefined, audio: undefined });
            return;
          }
          // Electron/macOS exposes system loopback through the display capture
          // path. The video track is incidental; the hidden capture window only
          // forwards the audio PCM to the THEM Whisper session.
          callback({ video: screenSource, audio: 'loopback' });
        })
        .catch((err: unknown) => {
          onProblem(explainCaptureFailure(err));
          callback({ video: undefined, audio: undefined });
        });
    },
    { useSystemPicker: false },
  );

  s.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });
}
