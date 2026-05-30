import { useRef } from 'react';
import { useTheme } from '../theme';
import type { Expression } from '../types';
import { compileExpression } from '../math/compile';

interface Props {
  expressions: Expression[];
}

export function AudioTrace({ expressions }: Props) {
  const { theme } = useTheme();
  const ctxRef = useRef<AudioContext | null>(null);

  const play = async () => {
    const visible = expressions.filter(e => e.visible && e.raw.trim());
    if (visible.length === 0) return;
    const c = visible[0];
    const compiled = compileExpression(c.raw);
    if ('error' in compiled) return;
    if (compiled.kind === 'implicit') return;

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const audio = ctxRef.current;
    if (audio.state === 'suspended') await audio.resume();

    const duration = 3;
    const samples = 200;
    const xMin = -10, xMax = 10;
    const fn = compiled.evalAt as (x: number) => number;
    const ys: number[] = [];
    for (let i = 0; i < samples; i++) {
      const x = xMin + (i / (samples - 1)) * (xMax - xMin);
      const y = fn(x);
      ys.push(isFinite(y) ? y : 0);
    }
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const range = yMax - yMin || 1;

    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.connect(gain).connect(audio.destination);
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.15, audio.currentTime);

    const now = audio.currentTime;
    ys.forEach((y, i) => {
      const t = now + (i / samples) * duration;
      const norm = (y - yMin) / range;
      const freq = 200 + norm * 1000;
      osc.frequency.setValueAtTime(freq, t);
    });
    osc.start(now);
    gain.gain.setValueAtTime(0.15, now + duration - 0.05);
    gain.gain.linearRampToValueAtTime(0, now + duration);
    osc.stop(now + duration);
  };

  return (
    <button
      onClick={play}
      aria-label="Play audio trace of graph"
      style={{
        background: theme.colors.accent,
        color: '#fff',
        border: 'none',
        padding: '6px 12px',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: theme.font.base - 1,
      }}
    >
      🔊 Audio trace
    </button>
  );
}
