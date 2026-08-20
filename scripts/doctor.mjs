#!/usr/bin/env node
// Preflight for the local stack: `npm run doctor`.
//
// Every one of these has a distinct failure mode and an unhelpful error at
// runtime. Checking them up front, with the exact fix command attached, turns a
// confusing first run into a checklist.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(root, '.env');
if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const env = (key, fallback = '') => (process.env[key] ?? fallback).trim();
const results = [];

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const WARN = '\x1b[33m!\x1b[0m';

function record(level, label, detail, fix) {
  results.push({ level, label, detail, fix });
}

const ok = (label, detail) => record('ok', label, detail);
const bad = (label, detail, fix) => record('bad', label, detail, fix);
const warn = (label, detail, fix) => record('warn', label, detail, fix);

function run(command, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ code: -1, out: '', err: String(err) });
      return;
    }
    let out = '';
    let errText = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, out, err: errText }); });
  });
}

// --- node ------------------------------------------------------------------
{
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) ok('Node', `v${process.versions.node}`);
  else bad('Node', `v${process.versions.node} is too old`, 'Install Node 20 or newer');
}

// --- config file -----------------------------------------------------------
// Not fatal on its own: every setting it would provide is checked directly
// below, and real environment variables work just as well.
if (fs.existsSync(envPath)) ok('.env', envPath);
else warn('.env', 'not found — reading settings from the environment instead', 'cp .env.example .env');

// --- transcription ---------------------------------------------------------
const sttProvider = env('STT_PROVIDER', 'whisper').toLowerCase();

if (sttProvider === 'whisper') {
  const binary = env('WHISPER_BINARY', 'whisper-cli');
  const help = await run(binary, ['--help']);

  const text = `${help.out}${help.err}`;

  if (help.code === -1) {
    bad('whisper binary', `"${binary}" not found`, 'brew install whisper-cpp   (or set WHISPER_BINARY to its path)');
  } else if (help.signal) {
    // Killed by a signal with nothing printed: the binary exists but cannot run
    // here. Usually a build for the wrong CPU/architecture, or Gatekeeper.
    bad(
      'whisper binary',
      `"${binary}" crashed on startup (${help.signal})`,
      help.signal === 'SIGILL'
        ? 'Built for a different CPU — reinstall: brew reinstall whisper-cpp'
        : `xattr -cr "${binary}" (macOS quarantine), or reinstall whisper-cpp`,
    );
  } else if (!text.trim()) {
    bad('whisper binary', `"${binary}" ran but printed nothing`, 'That is probably not whisper-cli — check WHISPER_BINARY');
  } else {
    // The app passes these exact flags; a renamed one fails only at runtime.
    const missing = ['--no-timestamps', '--no-prints', '--language', '--model'].filter((f) => !text.includes(f));
    if (missing.length) {
      bad('whisper binary', `found, but missing flags: ${missing.join(', ')}`, 'Update whisper.cpp — this build is too old');
    } else {
      ok('whisper binary', binary);
    }
  }

  const model = env('WHISPER_MODEL').replace(/^~/, os.homedir());
  if (!model) {
    bad('whisper model', 'WHISPER_MODEL is not set', 'Download a model and set WHISPER_MODEL to its path (see README)');
  } else if (!fs.existsSync(model)) {
    bad('whisper model', `not found at ${model}`, `curl -L -o ${model} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`);
  } else {
    const mb = fs.statSync(model).size / 1e6;
    if (mb < 10) bad('whisper model', `${model} is only ${mb.toFixed(1)}MB — truncated download?`, 'Re-download the model file');
    else ok('whisper model', `${path.basename(model)} (${mb.toFixed(0)}MB)`);
  }
} else {
  if (env('DEEPGRAM_API_KEY')) ok('Deepgram key', 'set');
  else bad('Deepgram key', 'DEEPGRAM_API_KEY is empty', 'Add the key to .env, or set STT_PROVIDER=whisper');
}

// --- answers ---------------------------------------------------------------
const answerProvider = env('ANSWER_PROVIDER', 'ollama').toLowerCase();

if (answerProvider === 'ollama') {
  const url = env('OLLAMA_URL', 'http://127.0.0.1:11434').replace(/\/$/, '');
  let tags;
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    tags = await response.json();
    ok('Ollama', url);
  } catch {
    bad('Ollama', `not reachable at ${url}`, 'ollama serve');
  }

  if (tags) {
    const installed = (tags.models ?? []).map((m) => m.name);
    const has = (want) => installed.some((name) => name === want || name === `${want}:latest` || name.startsWith(`${want}:`));

    const answerModel = env('OLLAMA_MODEL', 'llama3.1:8b');
    if (has(answerModel)) ok('answer model', answerModel);
    else bad('answer model', `"${answerModel}" not pulled`, `ollama pull ${answerModel}`);

    const embedModel = env('OLLAMA_EMBED_MODEL', 'nomic-embed-text');
    if (!embedModel) warn('embedding model', 'disabled — materials use keyword search only', '');
    else if (has(embedModel)) ok('embedding model', embedModel);
    else warn('embedding model', `"${embedModel}" not pulled — falling back to keyword search`, `ollama pull ${embedModel}`);

    const visionModel = env('OLLAMA_VISION_MODEL', 'llava:7b');
    if (has(visionModel)) ok('vision model', visionModel);
    else warn('vision model', `"${visionModel}" not pulled — the Screen button won't work`, `ollama pull ${visionModel}`);
  }
} else {
  if (env('ANTHROPIC_API_KEY')) ok('Anthropic key', 'set');
  else bad('Anthropic key', 'ANTHROPIC_API_KEY is empty', 'Add the key to .env, or set ANSWER_PROVIDER=ollama');
}

// --- your content ----------------------------------------------------------
{
  const contextFile = env('CLUELY_CONTEXT') || path.join(root, 'context.md');
  if (fs.existsSync(contextFile)) ok('context.md', contextFile);
  else warn('context.md', 'missing — answers will be generic', 'cp context.example.md context.md');

  const materialsDir = env('MATERIALS_DIR') || path.join(root, 'materials');
  const count = fs.existsSync(materialsDir)
    ? fs.readdirSync(materialsDir, { recursive: true }).filter((f) => /\.(md|markdown|txt|text)$/i.test(String(f))).length
    : 0;
  if (count) ok('materials', `${count} file${count === 1 ? '' : 's'} in ${materialsDir}`);
  else warn('materials', 'folder is empty — nothing to retrieve from', `mkdir -p ${materialsDir} and drop .md/.txt files in`);
}

// --- system audio ----------------------------------------------------------
if (process.platform === 'darwin') {
  if (env('SYSTEM_AUDIO_DEVICE')) {
    ok('system audio', `virtual device: ${env('SYSTEM_AUDIO_DEVICE')}`);
  } else {
    const version = await run('sw_vers', ['-productVersion']);
    const raw = version.out.trim();
    const [major, minor = 0] = raw.split('.').map(Number);
    if (Number.isFinite(major) && (major > 14 || (major === 14 && minor >= 4))) {
      ok('system audio', `macOS ${raw} supports loopback — grant Screen Recording permission`);
    } else if (Number.isFinite(major)) {
      bad('system audio', `macOS ${raw} is below 14.4, so loopback is unavailable`, 'Install BlackHole and set SYSTEM_AUDIO_DEVICE=BlackHole');
    }
  }
} else if (process.platform === 'linux' && !env('SYSTEM_AUDIO_DEVICE')) {
  warn('system audio', 'Linux loopback is unreliable', 'Set SYSTEM_AUDIO_DEVICE="Monitor of" to use a PulseAudio monitor source');
} else if (process.platform === 'win32') {
  ok('system audio', 'Windows loopback works without setup');
}

// --- report ----------------------------------------------------------------
console.log('');
for (const { level, label, detail, fix } of results) {
  const mark = level === 'ok' ? PASS : level === 'warn' ? WARN : FAIL;
  console.log(`${mark} ${label.padEnd(18)} ${detail}`);
  if (fix && level !== 'ok') console.log(`  ${' '.repeat(18)} → ${fix}`);
}

const failures = results.filter((r) => r.level === 'bad').length;
const warnings = results.filter((r) => r.level === 'warn').length;
console.log('');
if (failures) {
  console.log(`\x1b[31m${failures} problem${failures === 1 ? '' : 's'} to fix before this will run.\x1b[0m`);
  if (warnings) console.log(`${warnings} warning${warnings === 1 ? '' : 's'} (not fatal).`);
  process.exit(1);
}
console.log(
  warnings
    ? `\x1b[32mReady to run.\x1b[0m ${warnings} warning${warnings === 1 ? '' : 's'} — npm start`
    : '\x1b[32mEverything checks out — npm start\x1b[0m',
);
