#!/usr/bin/env node
// Dry run against your real setup: `npm run rehearse [--model qwen2.5:14b]`
//
// This is the only way to see answer quality and latency before a call, and it
// runs the *same* prompt, materials retrieval and provider the app uses — a
// rehearsal against a different prompt would be worse than none.
//
// Questions come from rehearsal.txt (one per line) if it exists, otherwise from
// the generic set below. Put your own in: the point is to see how the model
// handles the questions you actually get.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const modelFlag = process.argv.find((a) => a.startsWith('--model'));
if (modelFlag) {
  const value = modelFlag.includes('=') ? modelFlag.split('=')[1] : process.argv[process.argv.indexOf(modelFlag) + 1];
  if (value) process.env.OLLAMA_MODEL = value;
}

const { loadConfig } = await import(path.join(root, 'dist/main/config.js'));
const { Materials } = await import(path.join(root, 'dist/main/materials.js'));
const { createAnswerProvider } = await import(path.join(root, 'dist/main/answer/index.js'));
const { buildSystemPrompt, buildUserMessage } = await import(path.join(root, 'dist/main/prompt.js'));

const DEFAULT_QUESTIONS = [
  'So tell me a bit about yourself.',
  'What was the hardest technical problem you have worked on recently?',
  'How would you design a system that has to ingest a million events a second?',
  'Walk me through a time you disagreed with a decision your team made.',
  'Why are you looking to leave your current role?',
  'What questions do you have for us?',
];

const cfg = loadConfig();
const questionsFile = path.join(root, 'rehearsal.txt');
const questions = fs.existsSync(questionsFile)
  ? fs.readFileSync(questionsFile, 'utf8').split('\n').map((q) => q.trim()).filter((q) => q && !q.startsWith('#'))
  : DEFAULT_QUESTIONS;

const materials = new Materials(cfg);
await materials.load();
const stats = materials.stats();
const provider = createAnswerProvider(cfg);

const model = cfg.answerProvider === 'ollama' ? cfg.ollamaModel : cfg.answerModel;
console.log(`\nprovider ${cfg.answerProvider} · model ${model}`);
console.log(`materials ${stats.files} file(s), ${stats.chunks} passage(s)${stats.embedded ? ', semantic' : ', keyword only'}`);
if (stats.error) console.log(`note: ${stats.error}`);
console.log(`${questions.length} question(s) from ${fs.existsSync(questionsFile) ? 'rehearsal.txt' : 'the built-in set'}\n`);

const timings = [];

for (const [index, question] of questions.entries()) {
  // A real call has prior turns; a bare question underestimates prompt size.
  const transcriptWindow = `ME: Sure, happy to get into that.\nTHEM: ${question}`;
  const system = await buildSystemPrompt(cfg, materials, question);
  const user = buildUserMessage(transcriptWindow, question);

  console.log(`\x1b[36m${index + 1}. ${question}\x1b[0m`);

  const started = Date.now();
  let firstToken;
  let answer = '';

  try {
    await provider.generate({
      system,
      user,
      maxTokens: cfg.answerMaxTokens,
      signal: AbortSignal.timeout(120_000),
      onDelta: (delta) => {
        firstToken ??= Date.now() - started;
        answer += delta;
      },
    });
  } catch (err) {
    console.log(`   \x1b[31m${err instanceof Error ? err.message : String(err)}\x1b[0m\n`);
    continue;
  }

  const total = Date.now() - started;
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  timings.push({ firstToken: firstToken ?? total, total, words });

  console.log(`   \x1b[90mfirst token ${((firstToken ?? total) / 1000).toFixed(1)}s · total ${(total / 1000).toFixed(1)}s · ${words} words\x1b[0m`);
  console.log(answer.trim().split('\n').map((line) => `   ${line}`).join('\n'));
  console.log('');
}

if (!timings.length) {
  console.log('\x1b[31mNo answers completed — run `npm run doctor`.\x1b[0m');
  process.exit(1);
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const medianFirst = median(timings.map((t) => t.firstToken)) / 1000;
const medianTotal = median(timings.map((t) => t.total)) / 1000;
const medianWords = median(timings.map((t) => t.words));

console.log('─'.repeat(60));
console.log(`median first token ${medianFirst.toFixed(1)}s · median total ${medianTotal.toFixed(1)}s · median ${medianWords} words`);

// Time to first token is what decides whether this is usable mid-conversation:
// the answer streams, so you start reading before it finishes.
if (medianFirst > 3) {
  console.log(`\x1b[31mToo slow to be useful on a live call.\x1b[0m Try a smaller model:`);
  console.log(`  npm run rehearse -- --model llama3.2:3b`);
} else if (medianFirst > 1.5) {
  console.log(`\x1b[33mUsable but tight.\x1b[0m A smaller model buys you a second; a bigger one costs you one.`);
} else {
  console.log(`\x1b[32mFast enough for a live call.\x1b[0m`);
}

if (medianWords > 90) {
  console.log(`\x1b[33mAnswers run long (${medianWords} words).\x1b[0m Small models often ignore the length cap —`);
  console.log(`  strengthen the last line of SYSTEM_PROMPT in src/main/prompt.ts, or lower ANSWER_MAX_TOKENS.`);
}
