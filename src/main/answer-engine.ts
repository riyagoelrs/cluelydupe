import { randomUUID } from 'node:crypto';
import type { Config } from './config';
import { buildSystemPrompt, buildUserMessage } from './prompt';
import { createAnswerProvider, type AnswerProvider } from './answer';
import type { Materials } from './materials';
import type { Transcript } from './transcript';
import type { AnswerPatch } from '../shared/types';

export interface AnswerRequest {
  question: string;
  trigger: 'auto' | 'manual';
  /** Base64 PNG of the screen, when the question is about what's on it. */
  image?: string;
}

/**
 * Turns a question from the far side into a streamed answer card.
 * Only one answer runs at a time — a newer question cancels an older one, because
 * on a live call a stale answer is worse than no answer.
 */
export class AnswerEngine {
  private readonly provider: AnswerProvider;
  private inFlight: AbortController | undefined;

  constructor(
    private readonly cfg: Config,
    private readonly transcript: Transcript,
    private readonly materials: Materials,
    private readonly emit: (patch: AnswerPatch) => void,
  ) {
    this.provider = createAnswerProvider(cfg);
  }

  cancel(): void {
    this.inFlight?.abort();
    this.inFlight = undefined;
  }

  async answer(request: AnswerRequest): Promise<void> {
    this.cancel();

    const controller = new AbortController();
    this.inFlight = controller;

    const id = randomUUID();
    const question = request.question.trim() || '(what should I say next?)';
    this.emit({ id, question, body: '', status: 'thinking', trigger: request.trigger, at: Date.now() });

    try {
      const system = await buildSystemPrompt(this.cfg, this.materials, question);
      if (controller.signal.aborted) return;

      let started = false;
      await this.provider.generate({
        system,
        user: buildUserMessage(this.transcript.render(this.cfg.contextLines), question, Boolean(request.image)),
        image: request.image,
        maxTokens: this.cfg.answerMaxTokens,
        signal: controller.signal,
        onDelta: (delta) => {
          if (!started) {
            started = true;
            this.emit({ id, status: 'streaming' });
          }
          this.emit({ id, append: delta });
        },
      });

      this.emit({ id, status: started ? 'done' : 'error', ...(started ? {} : { body: 'The model returned nothing.' }) });
    } catch (err) {
      if (controller.signal.aborted) return; // superseded by a newer question
      this.emit({ id, body: err instanceof Error ? err.message : String(err), status: 'error' });
    } finally {
      if (this.inFlight === controller) this.inFlight = undefined;
    }
  }

}
