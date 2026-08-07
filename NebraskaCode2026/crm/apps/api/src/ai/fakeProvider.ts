import { z, type ZodType } from 'zod';
import type {
  EmbeddingProvider,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmStructuredResult,
} from './types.js';

function fakeTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Minimal valid value for a Zod schema — used by the non-strict fake in dev/e2e. */
export function synthesizeFromSchema(schema: unknown): unknown {
  if (schema instanceof z.ZodObject) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.shape)) {
      if (value instanceof z.ZodOptional) continue;
      result[key] = synthesizeFromSchema(value);
    }
    return result;
  }
  if (schema instanceof z.ZodNullable) return null;
  if (schema instanceof z.ZodOptional) return undefined;
  if (schema instanceof z.ZodArray) return [];
  if (schema instanceof z.ZodString) return '[fake output]';
  if (schema instanceof z.ZodNumber) return 1;
  if (schema instanceof z.ZodBoolean) return false;
  if (schema instanceof z.ZodEnum) return (schema.options as unknown[])[0];
  if (schema instanceof z.ZodLiteral) return schema.value;
  if (schema instanceof z.ZodDefault) return undefined;
  return null;
}

/**
 * Deterministic test double. Queue responses for scripted scenarios; unqueued
 * text calls echo the last user message, unqueued structured calls throw
 * (silently inventing schema-shaped data would hide missing test setup).
 */
export class FakeLlmProvider implements LlmProvider {
  readonly name = 'fake';
  readonly defaultModel = 'fake-model';
  private textQueue: string[] = [];
  private structuredQueue: unknown[] = [];
  private failures = 0;
  readonly calls: LlmRequest[] = [];

  constructor(private readonly options: { strictStructured?: boolean } = {}) {}

  queueText(text: string): void {
    this.textQueue.push(text);
  }

  queueStructured(output: unknown): void {
    this.structuredQueue.push(output);
  }

  /** Make the next n calls fail (exercise retry policies). */
  failNext(n: number): void {
    this.failures = n;
  }

  private maybeFail(): void {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('fake provider transient failure');
    }
  }

  private usageFor(request: LlmRequest, outputText: string) {
    const inputText = (request.system ?? '') + request.messages.map((m) => m.content).join('');
    return { inputTokens: fakeTokens(inputText), outputTokens: fakeTokens(outputText) };
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    this.calls.push(request);
    this.maybeFail();
    const text =
      this.textQueue.shift() ??
      `[fake] ${request.messages[request.messages.length - 1]?.content.slice(0, 200) ?? ''}`;
    return {
      text,
      model: this.defaultModel,
      usage: this.usageFor(request, text),
      stopReason: 'end_turn',
    };
  }

  async completeStructured<T>(
    request: LlmRequest & { schema: ZodType<T>; schemaName?: string },
  ): Promise<LlmStructuredResult<T>> {
    this.calls.push(request);
    this.maybeFail();
    let queued = this.structuredQueue.shift();
    if (queued === undefined) {
      if (this.options.strictStructured !== false) {
        throw new Error('FakeLlmProvider: no structured response queued — call queueStructured() in the test');
      }
      queued = synthesizeFromSchema(request.schema);
    }
    const output = request.schema.parse(queued);
    return {
      output,
      model: this.defaultModel,
      usage: this.usageFor(request, JSON.stringify(queued)),
      stopReason: 'end_turn',
    };
  }

  async stream(request: LlmRequest, onDelta: (text: string) => void): Promise<LlmResult> {
    const result = await this.complete(request);
    // deliver in two chunks so consumers exercise their accumulation path
    const mid = Math.ceil(result.text.length / 2);
    onDelta(result.text.slice(0, mid));
    if (result.text.length > mid) onDelta(result.text.slice(mid));
    return result;
  }
}

/**
 * Deterministic local embeddings: hashed character trigrams, L2-normalized.
 * Not semantically meaningful like a real embedding model, but stable, fast,
 * and similar texts share trigrams — enough for tests and demo-scale search.
 */
export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'fake-trigram';
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.dimensions).fill(0);
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (let i = 0; i < normalized.length - 2; i++) {
      const trigram = normalized.slice(i, i + 3);
      let hash = 2166136261;
      for (let j = 0; j < trigram.length; j++) {
        hash ^= trigram.charCodeAt(j);
        hash = Math.imul(hash, 16777619);
      }
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] = (vector[idx] ?? 0) + 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0)) || 1;
    return vector.map((v) => v / norm);
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) dot += a[i]! * b[i]!;
  return dot; // vectors are L2-normalized
}
