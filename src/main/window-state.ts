import * as fs from 'node:fs';
import * as path from 'node:path';
import { screen } from 'electron';

/** Overlay geometry and pin state, remembered between runs. */
export interface WindowState {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** Float above everything (including full-screen apps) vs. behave normally. */
  pinned?: boolean;
}

export function loadState(file: string): WindowState {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as WindowState;
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

export function saveState(file: string, state: WindowState): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Losing the remembered size is not worth interrupting a call over.
  }
}

/**
 * Keep the window somewhere the user can actually reach it. Saved coordinates
 * routinely point at a monitor that is no longer attached, which would restore
 * the overlay off-screen with no way to drag it back.
 */
export function clampToDisplay(bounds: { x: number; y: number; width: number; height: number }) {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.min(bounds.width, area.width);
  const height = Math.min(bounds.height, area.height);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
}
