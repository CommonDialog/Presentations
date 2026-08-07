import type { ZodType } from 'zod';
import type { Db } from '../db/client.js';
import { aiCalls } from '../db/schema/index.js';
import { withOrg } from '../lib/tenant.js';
import { computeCostUsd } from './pricing.js';
import type {
  EmbeddingProvider,
  LlmProvider,
  LlmRequest,
  LlmResult,
  LlmStructuredResult,
  LlmUsage,
} from './types.js';

export interface AiCallContext {
  organizationId: string;
  purpose: string;
  promptName?: string | undefined;
}

export interface AiServiceOptions {
  maxRetries?: number;
  retryBaseMs?: number;
}

function isRetryable(error: unknown): boolean {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  return true; // network / transport errors carry no status
}

/**
 * The single gateway for AI work: every call goes through here so retries,
 * logging, latency, and cost tracking cannot be skipped by feature code.
 */
export class AiService {
  constructor(
    private readonly db: Db,
    readonly llm: LlmProvider,
    readonly embedder: EmbeddingProvider,
    private readonly options: AiServiceOptions = {},
  ) {}

  private get maxRetries(): number {
    return this.options.maxRetries ?? 2;
  }

  private async logCall(entry: {
    ctx: AiCallContext;
    operation: string;
    model: string | null;
    usage: LlmUsage | null;
    latencyMs: number;
    attempts: number;
    success: boolean;
    error?: string;
  }): Promise<void> {
    await withOrg(this.db, entry.ctx.organizationId, (tx) =>
      tx.insert(aiCalls).values({
        organizationId: entry.ctx.organizationId,
        provider: this.llm.name,
        model: entry.model,
        operation: entry.operation,
        purpose: entry.ctx.purpose,
        promptName: entry.ctx.promptName ?? null,
        inputTokens: entry.usage?.inputTokens ?? null,
        outputTokens: entry.usage?.outputTokens ?? null,
        costUsd:
          entry.model && entry.usage
            ? (computeCostUsd(entry.model, entry.usage)?.toFixed(6) ?? null)
            : null,
        latencyMs: entry.latencyMs,
        attempts: entry.attempts,
        success: entry.success,
        error: entry.error ?? null,
      }),
    );
  }

  private async run<T extends { model: string; usage: LlmUsage }>(
    ctx: AiCallContext,
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    let attempts = 0;
    let lastError: unknown;
    while (attempts <= this.maxRetries) {
      attempts += 1;
      try {
        const result = await fn();
        await this.logCall({
          ctx,
          operation,
          model: result.model,
          usage: result.usage,
          latencyMs: Date.now() - started,
          attempts,
          success: true,
        });
        return result;
      } catch (error) {
        lastError = error;
        if (attempts > this.maxRetries || !isRetryable(error)) break;
        const delay = (this.options.retryBaseMs ?? 200) * 2 ** (attempts - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    await this.logCall({
      ctx,
      operation,
      model: null,
      usage: null,
      latencyMs: Date.now() - started,
      attempts,
      success: false,
      error: lastError instanceof Error ? lastError.message : String(lastError),
    });
    throw lastError;
  }

  complete(ctx: AiCallContext, request: LlmRequest): Promise<LlmResult> {
    return this.run(ctx, 'complete', () => this.llm.complete(request));
  }

  completeStructured<T>(
    ctx: AiCallContext,
    request: LlmRequest & { schema: ZodType<T>; schemaName?: string },
  ): Promise<LlmStructuredResult<T>> {
    return this.run(ctx, 'structured', () => this.llm.completeStructured(request));
  }

  stream(
    ctx: AiCallContext,
    request: LlmRequest,
    onDelta: (text: string) => void,
  ): Promise<LlmResult> {
    return this.run(ctx, 'stream', () => this.llm.stream(request, onDelta));
  }

  async embed(ctx: AiCallContext, texts: string[]): Promise<number[][]> {
    const started = Date.now();
    try {
      const vectors = await this.embedder.embed(texts);
      await this.logCall({
        ctx,
        operation: 'embed',
        model: this.embedder.name,
        usage: {
          inputTokens: Math.ceil(texts.reduce((sum, t) => sum + t.length, 0) / 4),
          outputTokens: 0,
        },
        latencyMs: Date.now() - started,
        attempts: 1,
        success: true,
      });
      return vectors;
    } catch (error) {
      await this.logCall({
        ctx,
        operation: 'embed',
        model: this.embedder.name,
        usage: null,
        latencyMs: Date.now() - started,
        attempts: 1,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
