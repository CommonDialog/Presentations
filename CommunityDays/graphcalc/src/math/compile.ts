import { create, all } from 'mathjs';

const math = create(all, {});

export interface CompiledExpr {
  kind: 'function' | 'implicit' | 'constant';
  evalAt: (x: number, y?: number) => number;
  raw: string;
}

// Detect asymptotes / discontinuities by checking for huge jumps between adjacent points.
export function isDiscontinuity(prev: number, curr: number, dx: number): boolean {
  if (!isFinite(prev) || !isFinite(curr)) return true;
  const slope = Math.abs((curr - prev) / dx);
  return slope > 1e4;
}

export function compileExpression(raw: string): CompiledExpr | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: 'empty' };

  try {
    // Implicit form: contains '=' but not "y ="
    if (trimmed.includes('=') && !/^\s*y\s*=/.test(trimmed)) {
      const [lhs, rhs] = trimmed.split('=');
      if (!lhs || !rhs) throw new Error('incomplete equation');
      const node = math.parse(`(${lhs}) - (${rhs})`);
      const compiled = node.compile();
      return {
        kind: 'implicit',
        raw,
        evalAt: (x: number, y?: number) => {
          try {
            return compiled.evaluate({ x, y: y ?? 0 });
          } catch {
            return NaN;
          }
        },
      };
    }

    // y = f(x) explicit
    const body = /^\s*y\s*=/.test(trimmed) ? trimmed.replace(/^\s*y\s*=/, '') : trimmed;
    const node = math.parse(body);
    const compiled = node.compile();
    // Test if x appears
    const hasX = /\bx\b/.test(body);
    if (!hasX) {
      const val = compiled.evaluate({});
      const num = typeof val === 'number' ? val : NaN;
      return {
        kind: 'constant',
        raw,
        evalAt: () => num,
      };
    }
    return {
      kind: 'function',
      raw,
      evalAt: (x: number) => {
        try {
          const r = compiled.evaluate({ x });
          return typeof r === 'number' ? r : NaN;
        } catch {
          return NaN;
        }
      },
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'parse error' };
  }
}
