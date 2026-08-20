import * as path from 'node:path';
import { BrowserWindow, desktopCapturer, screen, session } from 'electron';
import type { Config } from './config';
import { explainCaptureFailure } from './permissions';
import { clampToDisplay, type WindowState } from './window-state';

const OVERLAY_WIDTH = 520;
const OVERLAY_HEIGHT = 640;
const MARGIN = 24;
export const MIN_WIDTH = 320;
export const MIN_HEIGHT = 220;

export function createOverlayWindow(cfg: Config, state: WindowState = {}): BrowserWindow {
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
    // Focusable so its buttons and text selection work; it is shown with
    // showInactive() below so it never steals focus from the call app.
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
  // Excludes the overlay from screen shares and screenshots, so your own notes
  // don't end up on the shared screen. Set CONTENT_PROTECTION=false to disable.
  win.setContentProtection(cfg.contentProtection);

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  win.once('ready-to-show', () => win.showInactive());

  return win;
}

/**
 * Pinned: floats above everything, including full-screen call windows, and
 * follows you between spaces — necessary during a call, insufferable otherwise.
 * Unpinned: an ordinary window that goes behind whatever you focus.
 */
export function setPinned(win: BrowserWindow, pinned: boolean): void {
  // 'screen-saver' is the only level that clears a full-screen Zoom/Meet window.
  if (pinned) win.setAlwaysOnTop(true, 'screen-saver');
  else win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(pinned, { visibleOnFullScreen: pinned });
}

/**
 * Hidden window whose only job is to hold the audio graph. getUserMedia and
 * getDisplayMedia are renderer-only APIs, so capture cannot live in main.
 */
export function createCaptureWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 320,
    height: 200,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'capture-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // A hidden window is throttled by default, which would stall the audio graph.
      backgroundThrottling: false,
    },
  });

  void win.loadFile(path.join(__dirname, '..', 'renderer', 'capture.html'));
  return win;
}

/**
 * Route getDisplayMedia to the primary screen with loopback audio, so the
 * capture window receives what the machine is playing (i.e. the other person)
 * without a picker dialog appearing mid-call.
 */
export function installMediaHandlers(onProblem: (message: string) => void): void {
  const s = session.defaultSession;

  s.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screenSource = sources[0];
          if (!screenSource) {
            // Handing back an empty stream here produces an opaque failure in the
            // capture renderer, so say what actually went wrong.
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
    // The system picker would prompt on every start; we always want the same thing.
    { useSystemPicker: false },
  );

  s.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });
}
