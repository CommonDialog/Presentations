/**
 * In-process TTL cache with a size cap (oldest-inserted eviction).
 *
 * Used for per-request hot paths (auth contexts, per-org automation
 * summaries, prompt templates). Entries are small and TTLs short, so
 * cross-instance staleness is bounded by the TTL; anything that must be
 * immediate (logout, workflow/webhook edits) calls delete() explicitly.
 */
/**
 * TTL for the fixed-TTL caches (dispatch summaries, prompts). PERF_CACHES=off
 * disables them globally — used for A/B benchmarking, never in production.
 */
export function cacheTtl(defaultMs: number): number {
  return process.env.PERF_CACHES === 'off' ? 0 : defaultMs;
}

export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 5000,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  get(key: string): V | undefined {
    if (!this.enabled) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V): void {
    if (!this.enabled) return;
    if (this.entries.size >= this.maxEntries) {
      // Map preserves insertion order; drop the oldest entry.
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
