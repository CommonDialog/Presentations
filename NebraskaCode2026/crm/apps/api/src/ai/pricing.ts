import type { LlmUsage } from './types.js';

// USD per million tokens (Anthropic first-party rates, cached 2026-06).
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};

/** Cost in USD for a call; null when the model is unknown (fake provider, new models). */
export function computeCostUsd(model: string | null, usage: LlmUsage): number | null {
  if (!model) return null;
  const rate = PRICING[model] ?? PRICING[Object.keys(PRICING).find((k) => model.startsWith(k)) ?? ''];
  if (!rate) return null;
  const cost = (usage.inputTokens * rate.input + usage.outputTokens * rate.output) / 1_000_000;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
