import { systemPreferences } from 'electron';

/**
 * macOS gates loopback audio and screen capture behind Screen Recording, and
 * Electron surfaces a refusal as a bare "Failed to get sources" — which says
 * nothing about the permission or the relaunch that granting it requires.
 */
export function screenAccessProblem(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'granted') return undefined;
  return 'macOS is blocking screen access. System Settings → Privacy & Security → Screen Recording, enable this app, then QUIT AND REOPEN it — macOS does not apply the change to a running app.';
}

export function microphoneProblem(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  const status = systemPreferences.getMediaAccessStatus('microphone');
  if (status === 'granted' || status === 'not-determined') return undefined;
  return 'macOS is blocking the microphone. System Settings → Privacy & Security → Microphone, enable this app.';
}

/** Turns any capture failure into something that names the actual fix. */
export function explainCaptureFailure(err: unknown): string {
  const permission = screenAccessProblem();
  if (permission) return permission;
  const message = err instanceof Error ? err.message : String(err);
  if (/failed to get sources/i.test(message)) {
    return `Screen capture was refused by the OS (${message}). On macOS this is almost always the Screen Recording permission; grant it and reopen the app.`;
  }
  return message;
}
