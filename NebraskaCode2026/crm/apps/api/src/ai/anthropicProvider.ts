import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ZodType } from 'zod';
import type { LlmProvider, LlmRequest, LlmResult, LlmStructuredResult } from './types.js';

const DEFAULT_MAX_TOKENS = 16_000;

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly defaultModel: string = 'claude-opus-4-8',
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private baseParams(request: LlmRequest) {
    return {
      model: request.model ?? this.defaultModel,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      thinking: { type: 'adaptive' as const },
      ...(request.system ? { system: request.system } : {}),
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
  }

  private toResult(message: Anthropic.Message): LlmResult {
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      text,
      model: message.model,
      usage: {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
      },
      stopReason: message.stop_reason,
    };
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const message = await this.client.messages.create(this.baseParams(request));
    return this.toResult(message);
  }

  async completeStructured<T>(
    request: LlmRequest & { schema: ZodType<T>; schemaName?: string },
  ): Promise<LlmStructuredResult<T>> {
    const message = await this.client.messages.parse({
      ...this.baseParams(request),
      output_config: {
        format: zodOutputFormat(request.schema),
      },
    });
    if (message.parsed_output == null) {
      throw new Error(`structured output parse failed (stop_reason: ${message.stop_reason})`);
    }
    const base = this.toResult(message);
    return {
      output: message.parsed_output,
      model: base.model,
      usage: base.usage,
      stopReason: base.stopReason,
    };
  }

  async stream(request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
    const stream = this.client.messages.stream(this.baseParams(request));
    stream.on('text', (delta) => onDelta(delta));
    const message = await stream.finalMessage();
    return this.toResult(message);
  }
}
