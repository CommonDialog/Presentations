import type { ZodType } from 'zod';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  system?: string | undefined;
  messages: LlmMessage[];
  model?: string | undefined;
  maxTokens?: number | undefined;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  text: string;
  model: string;
  usage: LlmUsage;
  stopReason: string | null;
}

export interface LlmStructuredResult<T> extends Omit<LlmResult, 'text'> {
  output: T;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: LlmRequest): Promise<LlmResult>;
  completeStructured<T>(
    request: LlmRequest & { schema: ZodType<T>; schemaName?: string },
  ): Promise<LlmStructuredResult<T>>;
  /** Streams text deltas via onDelta; resolves with the final accumulated result. */
  stream(request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
