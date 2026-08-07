import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { aiCalls } from '../src/db/schema/index.js';
import { withOrg } from '../src/lib/tenant.js';
import { AiService } from '../src/ai/service.js';
import {
  cosineSimilarity,
  FakeEmbeddingProvider,
  FakeLlmProvider,
} from '../src/ai/fakeProvider.js';
import { computeCostUsd } from '../src/ai/pricing.js';
import { renderPrompt, renderTemplate, updatePrompt } from '../src/ai/prompts.js';
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
} from '../src/ai/conversations.js';
import { searchSimilar, upsertEntityEmbeddings } from '../src/ai/embeddings.js';
import type { AuthContext } from '../src/modules/auth/service.js';
import { buildTestApp, registerOrg, resetDb, type TestContext, type TestOrg } from './helpers/testApp.js';

let ctx: TestContext;
let org: TestOrg;
let fake: FakeLlmProvider;
let ai: AiService;

function authCtx(o: TestOrg): AuthContext {
  return {
    userId: o.userId,
    userName: 'Test',
    email: o.email,
    organizationId: o.organizationId,
    organizationName: 'Test',
    organizationSlug: 'test',
    permissions: new Set(),
  };
}

beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDb(ctx.db);
  org = await registerOrg(ctx.app);
  fake = new FakeLlmProvider();
  ai = new AiService(ctx.db, fake, new FakeEmbeddingProvider(), { retryBaseMs: 1 });
});

describe('pricing', () => {
  it('computes cost from the model rate card', () => {
    expect(computeCostUsd('claude-opus-4-8', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(30);
    expect(computeCostUsd('claude-haiku-4-5', { inputTokens: 2_000_000, outputTokens: 0 })).toBe(2);
    expect(computeCostUsd('fake-model', { inputTokens: 100, outputTokens: 100 })).toBeNull();
  });
});

describe('prompt management', () => {
  it('seeds defaults, renders with variables, rejects missing ones', async () => {
    const rendered = await renderPrompt(ctx.db, 'generic.summarize', {
      kind: 'email',
      content: 'Hello world',
    });
    expect(rendered.user).toContain('Hello world');
    expect(rendered.user).toContain('email');
    expect(() => renderTemplate('Hi {{name}}', {})).toThrow(/name/);
  });

  it('updating a prompt bumps its version', async () => {
    const updated = await updatePrompt(ctx.db, 'generic.summarize', {
      userTemplate: 'New template: {{content}}',
    });
    expect(updated.version).toBe(2);
    expect(updated.userTemplate).toContain('New template');
  });
});

describe('AiService', () => {
  it('logs successful calls with usage, latency and attempts', async () => {
    fake.queueText('a summary');
    const result = await ai.complete(
      { organizationId: org.organizationId, purpose: 'test.summarize' },
      { messages: [{ role: 'user', content: 'Summarize this' }] },
    );
    expect(result.text).toBe('a summary');

    const calls = await withOrg(ctx.db, org.organizationId, (tx) => tx.select().from(aiCalls));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.purpose).toBe('test.summarize');
    expect(calls[0]!.operation).toBe('complete');
    expect(calls[0]!.success).toBe(true);
    expect(calls[0]!.attempts).toBe(1);
    expect(calls[0]!.inputTokens).toBeGreaterThan(0);
    expect(calls[0]!.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('retries transient failures and records the attempt count', async () => {
    fake.failNext(1);
    fake.queueText('recovered');
    const result = await ai.complete(
      { organizationId: org.organizationId, purpose: 'test.retry' },
      { messages: [{ role: 'user', content: 'x' }] },
    );
    expect(result.text).toBe('recovered');
    const calls = await withOrg(ctx.db, org.organizationId, (tx) => tx.select().from(aiCalls));
    expect(calls[0]!.attempts).toBe(2);
    expect(calls[0]!.success).toBe(true);
  });

  it('gives up after max retries and logs the failure', async () => {
    fake.failNext(5);
    await expect(
      ai.complete(
        { organizationId: org.organizationId, purpose: 'test.fail' },
        { messages: [{ role: 'user', content: 'x' }] },
      ),
    ).rejects.toThrow(/transient/);
    const calls = await withOrg(ctx.db, org.organizationId, (tx) => tx.select().from(aiCalls));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.success).toBe(false);
    expect(calls[0]!.attempts).toBe(3); // 1 + 2 retries
    expect(calls[0]!.error).toMatch(/transient/);
  });

  it('returns schema-validated structured output', async () => {
    const schema = z.object({ sentiment: z.enum(['positive', 'negative']), score: z.number() });
    fake.queueStructured({ sentiment: 'positive', score: 0.9 });
    const result = await ai.completeStructured(
      { organizationId: org.organizationId, purpose: 'test.structured' },
      { messages: [{ role: 'user', content: 'classify' }], schema },
    );
    expect(result.output.sentiment).toBe('positive');
    const calls = await withOrg(ctx.db, org.organizationId, (tx) => tx.select().from(aiCalls));
    expect(calls[0]!.operation).toBe('structured');
  });

  it('streams deltas and accumulates the final result', async () => {
    fake.queueText('streamed answer');
    const deltas: string[] = [];
    const result = await ai.stream(
      { organizationId: org.organizationId, purpose: 'test.stream' },
      { messages: [{ role: 'user', content: 'go' }] },
      (d) => deltas.push(d),
    );
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.join('')).toBe('streamed answer');
    expect(result.text).toBe('streamed answer');
  });
});

describe('conversation history', () => {
  it('creates, appends and reads back in order', async () => {
    const auth = authCtx(org);
    const conversation = await createConversation(ctx.db, auth, 'Pipeline questions');
    await appendMessage(ctx.db, auth, conversation.id, 'user', 'What deals are stalled?');
    await appendMessage(ctx.db, auth, conversation.id, 'assistant', 'Two deals are stalled.');

    const history = await getConversation(ctx.db, auth, conversation.id);
    expect(history.title).toBe('Pipeline questions');
    expect(history.messages.map((m) => m.role)).toEqual(['user', 'assistant']);

    const list = await listConversations(ctx.db, auth);
    expect(list).toHaveLength(1);
  });

  it('is tenant-isolated', async () => {
    const auth = authCtx(org);
    const conversation = await createConversation(ctx.db, auth, 'Secret');
    const orgB = await registerOrg(ctx.app);
    await expect(getConversation(ctx.db, authCtx(orgB), conversation.id)).rejects.toThrow(/not found/);
  });
});

describe('embeddings', () => {
  it('is deterministic and ranks similar text higher', async () => {
    const embedder = new FakeEmbeddingProvider();
    const [a1] = await embedder.embed(['pricing discussion for enterprise deal']);
    const [a2] = await embedder.embed(['pricing discussion for enterprise deal']);
    const [b] = await embedder.embed(['completely unrelated topic about gardening']);
    expect(a1).toEqual(a2);
    expect(cosineSimilarity(a1!, a2!)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a1!, b!)).toBeLessThan(0.5);
  });

  it('stores and searches entity embeddings per org', async () => {
    await upsertEntityEmbeddings(ctx.db, ai, {
      organizationId: org.organizationId,
      entityType: 'account',
      entityId: '0198c5f0-0000-7000-8000-000000000001',
      chunks: ['Enterprise software company focused on healthcare billing'],
    });
    await upsertEntityEmbeddings(ctx.db, ai, {
      organizationId: org.organizationId,
      entityType: 'account',
      entityId: '0198c5f0-0000-7000-8000-000000000002',
      chunks: ['Family-owned bakery chain in the midwest'],
    });

    const hits = await searchSimilar(ctx.db, ai, {
      organizationId: org.organizationId,
      query: 'healthcare billing software',
      limit: 2,
    });
    expect(hits[0]!.entityId).toBe('0198c5f0-0000-7000-8000-000000000001');
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);

    // embed operations were logged too
    const embedCalls = await withOrg(ctx.db, org.organizationId, (tx) =>
      tx.select().from(aiCalls).where(eq(aiCalls.operation, 'embed')),
    );
    expect(embedCalls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('usage endpoint', () => {
  it('aggregates cost and calls by purpose', async () => {
    fake.queueText('one');
    await ai.complete(
      { organizationId: org.organizationId, purpose: 'test.a' },
      { messages: [{ role: 'user', content: 'x' }] },
    );
    // the app's own AiService uses its own fake; call through it too via HTTP-visible data:
    const res = await ctx.app.inject({ method: 'GET', url: '/api/ai/usage', cookies: org.cookies });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.totals.calls).toBe(1);
    expect(body.byPurpose[0].purpose).toBe('test.a');
  });
});

describe.runIf(Boolean(process.env.ANTHROPIC_API_KEY))('anthropic provider (live)', () => {
  it('completes a trivial request against the real API', async () => {
    const { AnthropicProvider } = await import('../src/ai/anthropicProvider.js');
    const provider = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
    const result = await provider.complete({
      messages: [{ role: 'user', content: 'Reply with exactly the word: ok' }],
      maxTokens: 200,
    });
    expect(result.text.toLowerCase()).toContain('ok');
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  }, 60_000);
});
