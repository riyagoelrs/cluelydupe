import * as path from 'node:path';
import { BrowserWindow, desktopCapturer, ipcMain, screen, session } from 'electron';
import type { Config } from './config';
import { explainCaptureFailure } from './permissions';
import { registerOperatorUi } from './operator-ui';
import { clampToDisplay, type WindowState } from './window-state';

const OVERLAY_WIDTH = 520;
const OVERLAY_HEIGHT = 640;
const MARGIN = 24;
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 220;

export function createOverlayWindow(cfg: Config, state: WindowState = {}): BrowserWindow {
  // Register the self-contained setup/notes/materials controller once. Keeping
  // it here avoids coupling those UI concerns to the live audio/answer engine.
  registerOperatorUi(() => ipcMain.emit('ctl:reload-materials'));

  const work = screen.getPrimaryDisplay().workArea;

  const defaults = {
    width: OVERLAY_WIDTH,
    height: Math.min(OVERLAY_HEIGHT, work.height - MARGIN * 2),
    x: work.x + work.width - OVERLAY_WIDTH - MARGIN,
    y: work.y + MARGIN,
  };
  const bounds = clampToDisplay({
    width: Math.max(MIN_WIDTH, state.width ?? defaults.width),
    height: Math.max(MIN_HEIGHT, state.height ?? defaults.height),
    x: state.x ?? defaults.x,
    y: state.y ?? defaults.y,
  });

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: true,
    minimizable: false,
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

  setPinned(win, state.pinned ?? true);
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
