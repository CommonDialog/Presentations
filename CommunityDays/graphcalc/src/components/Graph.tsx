import { useMemo, useRef, useEffect, useState } from 'react';
import { useTheme } from '../theme';
import type { Expression } from '../types';
import { compileExpression, isDiscontinuity } from '../math/compile';

interface Viewport {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface Props {
  expressions: Expression[];
  width: number;
  height: number;
  highDensity: boolean;
  onCompileResult: (id: string, error?: string) => void;
}

const DEFAULT_VP: Viewport = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

function buildPath(
  fn: (x: number) => number,
  vp: Viewport,
  width: number,
  height: number,
  samples: number,
): string {
  const dx = (vp.xMax - vp.xMin) / samples;
  const sx = (x: number) => ((x - vp.xMin) / (vp.xMax - vp.xMin)) * width;
  const sy = (y: number) => height - ((y - vp.yMin) / (vp.yMax - vp.yMin)) * height;

  let d = '';
  let prevY = NaN;
  let started = false;

  for (let i = 0; i <= samples; i++) {
    const x = vp.xMin + i * dx;
    const y = fn(x);

    if (!isFinite(y)) {
      started = false;
      prevY = NaN;
      continue;
    }
    if (started && isDiscontinuity(prevY, y, dx)) {
      started = false;
    }
    // Clip to a reasonable plotting range to avoid astronomical numbers
    const clampedY = Math.max(vp.yMin - 1000, Math.min(vp.yMax + 1000, y));
    if (!started) {
      d += `M${sx(x).toFixed(2)},${sy(clampedY).toFixed(2)} `;
      started = true;
    } else {
      d += `L${sx(x).toFixed(2)},${sy(clampedY).toFixed(2)} `;
    }
    prevY = y;
  }
  return d;
}

function renderImplicitToCanvas(
  ctx: CanvasRenderingContext2D,
  fn: (x: number, y: number) => number,
  vp: Viewport,
  width: number,
  height: number,
  color: string,
) {
  // Marching: sample on grid, color sign-change cells
  const cols = 200;
  const rows = 200;
  const cellW = width / cols;
  const cellH = height / rows;
  ctx.fillStyle = color;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x0 = vp.xMin + ((i) / cols) * (vp.xMax - vp.xMin);
      const x1 = vp.xMin + ((i + 1) / cols) * (vp.xMax - vp.xMin);
      const y0 = vp.yMin + ((j) / rows) * (vp.yMax - vp.yMin);
      const y1 = vp.yMin + ((j + 1) / rows) * (vp.yMax - vp.yMin);
      const v00 = fn(x0, y0);
      const v10 = fn(x1, y0);
      const v01 = fn(x0, y1);
      const v11 = fn(x1, y1);
      const signs = [Math.sign(v00), Math.sign(v10), Math.sign(v01), Math.sign(v11)];
      if (signs.some(s => s !== signs[0])) {
        ctx.fillRect(i * cellW, height - (j + 1) * cellH, cellW + 1, cellH + 1);
      }
    }
  }
}

export function Graph({ expressions, width, height, highDensity, onCompileResult }: Props) {
  const { theme } = useTheme();
  const [vp, setVp] = useState<Viewport>(DEFAULT_VP);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const compiled = useMemo(() => {
    return expressions.map(e => {
      const c = compileExpression(e.raw);
      return { expr: e, compiled: c };
    });
  }, [expressions]);

  useEffect(() => {
    compiled.forEach(({ expr, compiled: c }) => {
      if ('error' in c) {
        if (expr.raw.trim() && expr.error !== c.error) onCompileResult(expr.id, c.error);
      } else if (expr.error) {
        onCompileResult(expr.id, undefined);
      }
    });
  }, [compiled, onCompileResult]);

  const sx = (x: number) => ((x - vp.xMin) / (vp.xMax - vp.xMin)) * width;
  const sy = (y: number) => height - ((y - vp.yMin) / (vp.yMax - vp.yMin)) * height;

  // Implicit drawing goes to canvas (US-5 + US-6)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    compiled.forEach(({ expr, compiled: c }) => {
      if ('error' in c) return;
      if (!expr.visible) return;
      if (c.kind === 'implicit') {
        renderImplicitToCanvas(ctx, c.evalAt as (x: number, y: number) => number, vp, width, height, expr.color);
      }
    });
  }, [compiled, vp, width, height]);

  // Gridlines
  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const xStep = niceStep((vp.xMax - vp.xMin) / 10);
    const yStep = niceStep((vp.yMax - vp.yMin) / 10);
    for (let x = Math.ceil(vp.xMin / xStep) * xStep; x <= vp.xMax; x += xStep) {
      lines.push({ x1: sx(x), y1: 0, x2: sx(x), y2: height, major: Math.abs(x) < xStep / 2 });
    }
    for (let y = Math.ceil(vp.yMin / yStep) * yStep; y <= vp.yMax; y += yStep) {
      lines.push({ x1: 0, y1: sy(y), x2: width, y2: sy(y), major: Math.abs(y) < yStep / 2 });
    }
    return lines;
  }, [vp, width, height]);

  // Pan/zoom
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.1 : 0.9;
    const cx = (vp.xMin + vp.xMax) / 2;
    const cy = (vp.yMin + vp.yMax) / 2;
    const xr = (vp.xMax - vp.xMin) / 2 * factor;
    const yr = (vp.yMax - vp.yMin) / 2 * factor;
    setVp({ xMin: cx - xr, xMax: cx + xr, yMin: cy - yr, yMax: cy + yr });
  };

  const dragRef = useRef<{ x: number; y: number; vp: Viewport } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, vp };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) / width * (vp.xMax - vp.xMin);
    const dy = (e.clientY - dragRef.current.y) / height * (vp.yMax - vp.yMin);
    const v = dragRef.current.vp;
    setVp({ xMin: v.xMin - dx, xMax: v.xMax - dx, yMin: v.yMin + dy, yMax: v.yMax + dy });
  };
  const onMouseUp = () => { dragRef.current = null; };

  // Build alt text summary (US-15)
  const summary = useMemo(() => {
    const parts = compiled
      .filter(c => !('error' in c.compiled) && c.expr.visible)
      .map(c => `${c.expr.raw}`);
    return parts.length
      ? `Graph showing ${parts.length} plot${parts.length === 1 ? '' : 's'}: ${parts.join('; ')}. X axis from ${vp.xMin.toFixed(1)} to ${vp.xMax.toFixed(1)}, Y axis from ${vp.yMin.toFixed(1)} to ${vp.yMax.toFixed(1)}.`
      : 'Empty graph.';
  }, [compiled, vp]);

  return (
    <div
      style={{ position: 'relative', width, height, background: theme.colors.panel, border: `1px solid ${theme.colors.grid}` }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Canvas layer for implicit / high density (US-5) */}
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      {/* SVG layer for crisp scalable rendering (US-4 / US-11) */}
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={summary}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
      >
        <title>Graph</title>
        <desc>{summary}</desc>
        <g aria-hidden="true">
          {gridLines.map((l, i) => (
            <line
              key={i}
              x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
              stroke={l.major ? theme.colors.axis : theme.colors.grid}
              strokeWidth={l.major ? 1.2 : 0.5}
            />
          ))}
        </g>
        {compiled.map(({ expr, compiled: c }) => {
          if ('error' in c) return null;
          if (!expr.visible) return null;
          if (c.kind === 'implicit') return null;

          if (c.kind === 'constant') {
            const yPx = sy(c.evalAt(0));
            return (
              <g key={expr.id} role="img" aria-label={`Horizontal line at y equals ${c.evalAt(0)}`}>
                <line x1={0} y1={yPx} x2={width} y2={yPx} stroke={expr.color} strokeWidth={2} />
              </g>
            );
          }

          // High density branch: render to canvas overlay if requested
          const samples = highDensity ? 10000 : 1200;
          const d = buildPath(c.evalAt as (x: number) => number, vp, width, height, samples);
          return (
            <g key={expr.id} role="img" aria-label={`Plot of ${expr.raw}`}>
              <path d={d} fill="none" stroke={expr.color} strokeWidth={2} strokeLinejoin="round" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function niceStep(rough: number) {
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const n = rough / pow;
  let nice;
  if (n < 1.5) nice = 1;
  else if (n < 3) nice = 2;
  else if (n < 7) nice = 5;
  else nice = 10;
  return nice * pow;
}
