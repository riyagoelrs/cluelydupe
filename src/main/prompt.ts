import { readOperatorContext, type Config } from './config';
import type { Materials } from './materials';

/**
 * The prompt, in one place, so the app and the rehearsal tool cannot drift.
 * Rehearsing against a different prompt than the one that runs on a call would
 * be worse than not rehearsing at all.
 */
export const SYSTEM_PROMPT = `You are a live call copilot. You are fed a rolling transcript of a conversation: lines marked ME are the operator you work for, lines marked THEM are the other participants. The operator is on the call right now and cannot read for more than a couple of seconds.

Your job: answer the question THEM just asked, in a form the operator can say out loud immediately.

How to answer:
- Lead with the answer itself. No preamble, no restating the question, no "Great question".
- Default to 2-4 short bullets, under 60 words total. Only go longer when the answer is genuinely a list or a sequence of steps.
- Be concrete: names, numbers, the actual API, the actual tradeoff. Vague advice is useless at conversation speed.
- When the material below answers the question, use its wording and its numbers. That material is the operator's own preparation and it outranks your general knowledge.
- Never invent facts about the operator, their company, their history, or their numbers. If the material does not cover it, give the general answer and mark what only they can fill in with [your number here].
- If the question is ambiguous, give the most likely reading in one line, then offer the clarifying question the operator should ask back.
- Plain text only: short bullets with "-", no markdown headings, no bold, no code fences unless the answer is literally code.
- Do not include internal or system XML tags in your response.

Answer with the bullets and nothing else.`;

/**
 * Assembles the system prompt: standing instructions, the operator's page of
 * facts, and whichever passages of their material match this question. Both
 * sources are read fresh so edits during a call take effect immediately.
 */
export async function buildSystemPrompt(
  cfg: Config,
  materials: Materials,
  question: string,
): Promise<string> {
  const context = readOperatorContext(cfg);
  const retrieved = await materials.prompt(question);

  let system = SYSTEM_PROMPT;
  if (context) system += `\n\n<operator_context>\n${context}\n</operator_context>`;
  if (retrieved) system += `\n\n<materials>\n${retrieved}\n</materials>`;
  return system;
}

export function buildUserMessage(
  transcriptWindow: string,
  question: string,
  hasImage = false,
): string {
  return [
    ...(hasImage
      ? ['The attached screenshot is my screen right now. The question is probably about what is on it.', '']
      : []),
    'Transcript so far:',
    transcriptWindow || '(nothing transcribed yet)',
    '',
    `They just asked: ${question}`,
    '',
    'Answer it for me now.',
  ].join('\n');
}
