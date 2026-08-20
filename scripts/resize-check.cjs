// Drives a real resize drag through the real window, with synthesized mouse
// input, and asserts the window actually changed size. The resize path has
// shipped broken twice; a screenshot cannot catch this, only a drag can.
const { app } = require('electron');

process.env.CONTENT_PROTECTION = 'false';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { loadConfig } = require('../dist/main/config.js');
  const { createOverlayWindow, MIN_WIDTH, MIN_HEIGHT } = require('../dist/main/windows.js');
  const { clampToDisplay } = require('../dist/main/window-state.js');
  const { ipcMain } = require('electron');

  const cfg = loadConfig();
  const win = createOverlayWindow(cfg, { x: 60, y: 60, width: 520, height: 600, pinned: true });
  await new Promise((r) => win.webContents.once('did-finish-load', r));
  win.showInactive();
  await wait(400);

  // Wire the same handlers main.ts installs.
  let origin;
  ipcMain.on('ctl:resize-begin', () => { origin = win.getBounds(); });
  ipcMain.on('ctl:resize-to', (_e, width, height) => {
    if (!origin) return;
    win.setBounds(clampToDisplay({
      x: origin.x, y: origin.y,
      width: Math.max(MIN_WIDTH, width ?? origin.width),
      height: Math.max(MIN_HEIGHT, height ?? origin.height),
    }));
  });
  ipcMain.on('ctl:resize-end', () => { origin = undefined; });

  const before = win.getBounds();
  const drag = async (fromX, fromY, dx, dy) => {
    win.webContents.sendInputEvent({ type: 'mouseDown', x: fromX, y: fromY, button: 'left', clickCount: 1 });
    await wait(120);
    for (let step = 1; step <= 4; step += 1) {
      win.webContents.sendInputEvent({
        type: 'mouseMove',
        x: fromX + (dx * step) / 4,
        y: fromY + (dy * step) / 4,
        button: 'left',
        buttons: 1,
      });
      await wait(60);
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: fromX + dx, y: fromY + dy, button: 'left', clickCount: 1 });
    await wait(200);
  };

  // Grab the corner grip: bottom-right 18x18 of the window.
  await drag(before.width - 9, before.height - 9, 140, 90);
  const after = win.getBounds();

  const grewWide = after.width - before.width;
  const grewTall = after.height - before.height;
  console.log(`[resize] ${before.width}x${before.height} -> ${after.width}x${after.height} (dw ${grewWide}, dh ${grewTall})`);

  if (grewWide <= 0 || grewTall <= 0) {
    console.log('[resize] FAILED: the drag did not resize the window at all');
    process.exitCode = 1;
  } else {
    console.log('[resize] corner drag OK (grip -> capture -> IPC -> setBounds)');
  }

  // A drag that would shrink below the floor must stop at the floor, not vanish.
  const beforeShrink = win.getBounds();
  await drag(beforeShrink.width - 9, beforeShrink.height - 9, -5000, -5000);
  const shrunk = win.getBounds();
  console.log(`[resize] clamped to ${shrunk.width}x${shrunk.height} (min ${MIN_WIDTH}x${MIN_HEIGHT})`);
  if (shrunk.width !== MIN_WIDTH || shrunk.height !== MIN_HEIGHT) {
    console.log('[resize] FAILED: minimum size not enforced');
    process.exitCode = 1;
  } else {
    console.log('[resize] minimum size OK');
  }

  app.quit();
});
