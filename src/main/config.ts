import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

/**
 * Electron's `app` when running inside Electron, undefined otherwise.
 *
 * Outside Electron the `electron` package resolves to a path string rather than
 * the API object, so command-line tooling (doctor, rehearse) can load this
 * module and get the same configuration the app sees, instead of duplicating it.
 */
function electronApp(): typeof import('electron').app | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as unknown;
    if (electron && typeof electron === 'object' && 'app' in electron) {
      return (electron as { app: typeof import('electron').app }).app;
    }
  } catch {
    // not installed, or not running under Electron
  }
  return undefined;
}

const app = electronApp();

export type ThinkingMode = 'off' | 'adaptive';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AnswerProviderName = 'ollama' | 'claude';
export type SttProviderName = 'whisper' | 'deepgram';

export interface Config {
  sttProvider: SttProviderName;
  answerProvider: AnswerProviderName;
  whisperBinary: string;
  whisperModel: string;
  whisperThreads: number;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaVisionModel: string;
  ollamaEmbedModel: string;
  materialsDir: string;
  materialsTopK: number;
  anthropicApiKey: string;
  deepgramApiKey: string;
  deepgramModel: string;
  deepgramEndpoint: string;
  language: string;
  answerModel: string;
  answerEffort: Effort;
  answerThinking: ThinkingMode;
  answerMaxTokens: number;
  autoAnswer: boolean;
  contextLines: number;
  contentProtection: boolean;
  contextFile: string;
  stateFile: string;
  appRoot: string;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
}

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  const v = (value ?? '').trim().toLowerCase() as T;
  return allowed.includes(v) ? v : fallback;
}

function resolveAppRoot(): string {
  if (!app) return process.cwd();
  return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
}

function userDataDir(): string {
  return app ? app.getPath('userData') : path.join(os.homedir(), '.cluely');
}

function resolveContextFile(appRoot: string): string {
  const candidates = [
    process.env.CLUELY_CONTEXT ? expandHome(process.env.CLUELY_CONTEXT.trim()) : undefined,
    path.join(appRoot, 'context.md'),
    path.join(userDataDir(), 'context.md'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(userDataDir(), 'context.md');
}

function resolveWhisperModel(): string {
  const explicit = expandHome((process.env.WHISPER_MODEL ?? '').trim());
  if (explicit) return explicit;

  const candidates = [
    path.join(os.homedir(), 'ggml-base.en.bin'),
    path.join(os.homedir(), '.cluely', 'models', 'ggml-base.en.bin'),
    path.join(userDataDir(), 'models', 'ggml-base.en.bin'),
    '/opt/homebrew/share/whisper-cpp/ggml-base.en.bin',
    '/usr/local/share/whisper-cpp/ggml-base.en.bin',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? '';
}

let cached: Config | undefined;

export { expandHome };

export function saveUserEnvSetting(key: string, value: string): void {
  const file = path.join(userDataDir(), '.env');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let lines: string[] = [];
  try {
    lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  } catch {
    // first setting
  }
  const prefix = `${key}=`;
  const encoded = value.includes(' ') ? JSON.stringify(value) : value;
  const replacement = `${prefix}${encoded}`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index >= 0) lines[index] = replacement;
  else lines.push(replacement);
  fs.writeFileSync(file, `${lines.filter(Boolean).join('\n')}\n`, 'utf8');
}

export function loadConfig(): Config {
  if (cached) return cached;

  const appRoot = resolveAppRoot();
  const appEnv = path.join(appRoot, '.env');
  const userEnv = path.join(userDataDir(), '.env');
  if (fs.existsSync(appEnv)) dotenv.config({ path: appEnv });
  if (fs.existsSync(userEnv)) dotenv.config({ path: userEnv, override: true });

  const materialsDir = expandHome((process.env.MATERIALS_DIR ?? '').trim()) || path.join(appRoot, 'materials');

  cached = {
    sttProvider: oneOf(process.env.STT_PROVIDER, ['whisper', 'deepgram'] as const, 'whisper'),
    answerProvider: oneOf(process.env.ANSWER_PROVIDER, ['ollama', 'claude'] as const, 'ollama'),
    whisperBinary: expandHome((process.env.WHISPER_BINARY ?? 'whisper-cli').trim()),
    whisperModel: resolveWhisperModel(),
    whisperThreads: int(process.env.WHISPER_THREADS, 4),
    ollamaUrl: (process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434').trim().replace(/\/$/, ''),
    ollamaModel: (process.env.OLLAMA_MODEL ?? 'llama3.1:8b').trim(),
    ollamaVisionModel: (process.env.OLLAMA_VISION_MODEL ?? 'llava:7b').trim(),
    ollamaEmbedModel: (process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text').trim(),
    materialsDir,
    materialsTopK: int(process.env.MATERIALS_TOP_K, 4),
    anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? '').trim(),
    deepgramApiKey: (process.env.DEEPGRAM_API_KEY ?? '').trim(),
    deepgramModel: (process.env.DEEPGRAM_MODEL ?? 'nova-3').trim(),
    deepgramEndpoint: (process.env.DEEPGRAM_URL ?? 'wss://api.deepgram.com/v1/listen').trim(),
    language: (process.env.STT_LANGUAGE ?? 'en').trim(),
    answerModel: (process.env.ANSWER_MODEL ?? 'claude-opus-5').trim(),
    answerEffort: oneOf(process.env.ANSWER_EFFORT, ['low', 'medium', 'high', 'xhigh', 'max'] as const, 'low'),
    answerThinking: oneOf(process.env.ANSWER_THINKING, ['off', 'adaptive'] as const, 'off'),
    answerMaxTokens: int(process.env.ANSWER_MAX_TOKENS, 1200),
    autoAnswer: bool(process.env.AUTO_ANSWER, true),
    contextLines: int(process.env.CONTEXT_LINES, 24),
    contentProtection: bool(process.env.CONTENT_PROTECTION, true),
    contextFile: resolveContextFile(appRoot),
    stateFile: path.join(userDataDir(), 'window-state.json'),
    appRoot,
  };
  return cached;
}

export function readOperatorContext(cfg: Config): string {
  try {
    return fs.readFileSync(cfg.contextFile, 'utf8').trim();
  } catch {
    return '';
  }
}

export function writeOperatorContext(cfg: Config, text: string): void {
  fs.mkdirSync(path.dirname(cfg.contextFile), { recursive: true });
  fs.writeFileSync(cfg.contextFile, text, 'utf8');
}

export function ensureContextFile(cfg: Config): string {
  if (!fs.existsSync(cfg.contextFile)) {
    fs.mkdirSync(path.dirname(cfg.contextFile), { recursive: true });
    fs.writeFileSync(
      cfg.contextFile,
      [
        '# Context for the copilot',
        '',
        'Anything here is given to the answer model on every answer. Keep it short and factual.',
        '',
        '## Who I am',
        '- ',
        '',
        '## What we are talking about',
        '- ',
        '',
        '## Facts I keep forgetting',
        '- ',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  return cfg.contextFile;
}
