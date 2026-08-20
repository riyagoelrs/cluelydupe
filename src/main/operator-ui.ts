import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, screen, shell, systemPreferences } from 'electron';
import {
  ensureContextFile,
  loadConfig,
  readOperatorContext,
  saveUserEnvSetting,
  writeOperatorContext,
} from './config';
import type { MaterialImportResult, PermissionState, SetupState } from '../shared/types';

const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin';
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.csv', '.json', '.yaml', '.yml']);
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.rtf', '.odt']);

let registered = false;

export function registerOperatorUi(onMaterialsChanged: () => void): void {
  if (registered) return;
  registered = true;
  const cfg = loadConfig();

  ipcMain.handle('data:get-context', () => {
    ensureContextFile(cfg);
    return readOperatorContext(cfg);
  });
  ipcMain.handle('data:save-context', (_event, text: string) => {
    writeOperatorContext(cfg, text);
    return true;
  });
  ipcMain.handle('data:list-materials', () => listMaterialFiles(cfg.materialsDir));
  ipcMain.handle('data:import-materials', async (event) => {
    const result = await importMaterials(BrowserWindow.fromWebContents(event.sender), cfg.materialsDir);
    if (result.added.length) onMaterialsChanged();
    return result;
  });
  ipcMain.handle('data:reveal-materials', () => shell.openPath(ensureMaterialsDir(cfg.materialsDir)));

  ipcMain.handle('setup:get', () => getSetupState());
  ipcMain.handle('setup:choose-whisper-model', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a whisper.cpp model',
      properties: ['openFile'],
      filters: [{ name: 'Whisper ggml model', extensions: ['bin'] }],
    };
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    const selected = result.filePaths[0];
    if (selected) {
      cfg.whisperModel = selected;
      saveUserEnvSetting('WHISPER_MODEL', selected);
    }
    return getSetupState();
  });
  ipcMain.handle('setup:download-whisper-model', async () => {
    const dir = path.join(app.getPath('userData'), 'models');
    const destination = path.join(dir, 'ggml-base.en.bin');
    const partial = `${destination}.download`;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const response = await fetch(WHISPER_MODEL_URL);
      if (!response.ok || !response.body) throw new Error(`Download failed (${response.status} ${response.statusText})`);
      const handle = await fs.promises.open(partial, 'w');
      try {
        const reader = response.body.getReader();
        let position = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = Buffer.from(value);
          await handle.write(chunk, 0, chunk.length, position);
          position += chunk.length;
        }
      } finally {
        await handle.close();
      }
      fs.renameSync(partial, destination);
      cfg.whisperModel = destination;
      saveUserEnvSetting('WHISPER_MODEL', destination);
    } catch (err) {
      fs.rmSync(partial, { force: true });
      throw err;
    }
    return getSetupState();
  });
  ipcMain.handle('setup:open-privacy', (_event, kind: 'screen' | 'microphone') => {
    if (process.platform !== 'darwin') return;
    const pane = kind === 'screen' ? 'Privacy_ScreenCapture' : 'Privacy_Microphone';
    void shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  });
  ipcMain.on('ctl:reset-window', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const work = screen.getPrimaryDisplay().workArea;
    const width = Math.min(520, work.width);
    const height = Math.min(640, Math.max(220, work.height - 48));
    win.setBounds({ width, height, x: work.x + work.width - width - 24, y: work.y + 24 });
  });

  async function getSetupState(): Promise<SetupState> {
    const permissionState = (kind: 'screen' | 'microphone'): PermissionState => {
      if (process.platform !== 'darwin') return 'unknown';
      return systemPreferences.getMediaAccessStatus(kind) as PermissionState;
    };

    const probe = spawnSync(cfg.whisperBinary, ['--help'], { stdio: 'ignore' });
    const whisperBinaryOk = (probe.error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT';

    let ollamaRunning = false;
    let modelNames: string[] = [];
    if (cfg.answerProvider === 'ollama') {
      try {
        const response = await fetch(`${cfg.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2_500) });
        if (response.ok) {
          const body = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
          modelNames = (body.models ?? []).flatMap((model) => [model.name, model.model]).filter((name): name is string => Boolean(name));
          ollamaRunning = true;
        }
      } catch {
        // setup UI reports the daemon as unavailable
      }
    } else {
      ollamaRunning = true;
    }

    const hasModel = (name: string): boolean => !name || modelNames.some((installed) =>
      installed === name || (!name.includes(':') && installed.startsWith(`${name}:`)),
    );

    return {
      whisperModel: { ok: cfg.sttProvider !== 'whisper' || Boolean(cfg.whisperModel && fs.existsSync(cfg.whisperModel)), path: cfg.whisperModel },
      whisperBinary: { ok: cfg.sttProvider !== 'whisper' || whisperBinaryOk, value: cfg.whisperBinary },
      screenPermission: permissionState('screen'),
      microphonePermission: permissionState('microphone'),
      ollama: {
        running: ollamaRunning,
        answerModel: { ok: cfg.answerProvider !== 'ollama' || hasModel(cfg.ollamaModel), name: cfg.ollamaModel },
        embedModel: { ok: cfg.answerProvider !== 'ollama' || hasModel(cfg.ollamaEmbedModel), name: cfg.ollamaEmbedModel },
        visionModel: { ok: cfg.answerProvider !== 'ollama' || hasModel(cfg.ollamaVisionModel), name: cfg.ollamaVisionModel },
        url: cfg.ollamaUrl,
      },
    };
  }
}

function ensureMaterialsDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function listMaterialFiles(root: string): string[] {
  ensureMaterialsDir(root);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (['.md', '.markdown', '.txt', '.text'].includes(path.extname(entry.name).toLowerCase())) found.push(path.relative(root, full));
    }
  };
  walk(root);
  return found.sort();
}

async function importMaterials(parent: BrowserWindow | null, dir: string): Promise<MaterialImportResult> {
  const options: Electron.OpenDialogOptions = {
    title: 'Add prep files',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Prep files', extensions: ['txt', 'text', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'pdf', 'doc', 'docx', 'rtf', 'odt'] }],
  };
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled) return { added: [], errors: [] };

  ensureMaterialsDir(dir);
  const added: string[] = [];
  const errors: string[] = [];
  for (const source of result.filePaths) {
    try {
      const ext = path.extname(source).toLowerCase();
      const base = path.basename(source, ext);
      if (!TEXT_EXTENSIONS.has(ext) && !DOCUMENT_EXTENSIONS.has(ext)) throw new Error('unsupported file type');
      const text = extractMaterialText(source, ext);
      if (!text.trim()) throw new Error('no readable text found');
      const target = uniqueFile(path.join(dir, `${base}.txt`));
      fs.writeFileSync(target, text, 'utf8');
      added.push(path.basename(target));
    } catch (err) {
      errors.push(`${path.basename(source)}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { added, errors };
}

function extractMaterialText(source: string, ext: string): string {
  if (TEXT_EXTENSIONS.has(ext)) return fs.readFileSync(source, 'utf8');

  if (ext === '.pdf') {
    try {
      return execFileSync('pdftotext', ['-layout', source, '-'], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    } catch {
      // fall through to macOS metadata extraction
    }
    if (process.platform === 'darwin') {
      try {
        execFileSync('/usr/bin/mdimport', [source], { stdio: 'ignore' });
        const text = execFileSync('/usr/bin/mdls', ['-raw', '-name', 'kMDItemTextContent', source], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 }).trim();
        if (text && text !== '(null)') return text;
      } catch {
        // fall through to useful error
      }
    }
    throw new Error('could not extract PDF text locally; install poppler (`brew install poppler`) or export the PDF as text');
  }

  if (process.platform === 'darwin') {
    try {
      return execFileSync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', source], { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
    } catch {
      throw new Error('macOS could not convert this document to text');
    }
  }

  throw new Error('document import is currently available for text files on this platform');
}

function uniqueFile(candidate: string): string {
  if (!fs.existsSync(candidate)) return candidate;
  const dir = path.dirname(candidate);
  const ext = path.extname(candidate);
  const base = path.basename(candidate, ext);
  for (let i = 2; i < 10_000; i += 1) {
    const next = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
  throw new Error('too many files with the same name');
}
