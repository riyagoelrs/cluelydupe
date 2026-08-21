import type { Config } from '../config';
import type { AnswerProvider, GenerateRequest } from './types';

interface ResponsesBody {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

/** OpenAI Responses API provider. Uses fetch directly so the desktop app does not need another SDK dependency. */
export class OpenAIProvider implements AnswerProvider {
  readonly name = 'openai';

  constructor(private readonly cfg: Config) {}

  async generate(request: GenerateRequest): Promise<void> {
    if (!this.cfg.openaiApiKey) {
      throw new Error('OPENAI_API_KEY is not set — add it to .env.');
    }

    const input = request.image
      ? [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: request.user },
              { type: 'input_image', image_url: `data:image/png;base64,${request.image}` },
            ],
          },
        ]
      : request.user;

    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.cfg.openaiApiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.answerModel,
          instructions: request.system,
          input,
          max_output_tokens: request.maxTokens,
        }),
        signal: request.signal,
      });
    } catch (err) {
      if (request.signal.aborted) throw err;
      throw new Error('Could not reach the OpenAI API — check your network.');
    }

    let body: ResponsesBody;
    try {
      body = (await response.json()) as ResponsesBody;
    } catch {
      throw new Error(`OpenAI API returned an unreadable response (${response.status}).`);
    }

    if (!response.ok) {
      if (response.status === 401) throw new Error('OpenAI rejected the API key — check OPENAI_API_KEY.');
      if (response.status === 403) throw new Error('This OpenAI API key is not allowed to use that model.');
      if (response.status === 404) throw new Error('OpenAI model not found — check ANSWER_MODEL.');
      if (response.status === 429) throw new Error('OpenAI rate limit or API credits issue — check your Platform billing/limits.');
      throw new Error(body.error?.message || `OpenAI API error ${response.status}.`);
    }

    const text = (body.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) throw new Error('OpenAI returned no answer text.');
    request.onDelta(text);
  }
}
