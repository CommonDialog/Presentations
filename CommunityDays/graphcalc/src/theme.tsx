import { createContext, useContext, useMemo, useState, useCallback } from 'react';
import type { ReactNode } from 'react';

export type ThemeMode = 'light' | 'dark' | 'highContrast';

export interface Theme {
  mode: ThemeMode;
  largePrint: boolean;
  colors: {
    bg: string;
    panel: string;
    text: string;
    muted: string;
    accent: string;
    error: string;
    grid: string;
    axis: string;
    plot: string[];
  };
  font: {
    base: number;
    mono: string;
  };
  spacing: (n: number) => string;
}

const palettes: Record<ThemeMode, Theme['colors']> = {
  light: {
    bg: '#fafafa',
    panel: '#ffffff',
    text: '#1a1a1a',
    muted: '#666',
    accent: '#2a6df4',
    error: '#c0392b',
    grid: '#e6e6e6',
    axis: '#999',
    plot: ['#2a6df4', '#e67e22', '#27ae60', '#8e44ad', '#16a085'],
  },
  dark: {
    bg: '#0f1115',
    panel: '#171a21',
    text: '#e8e8e8',
    muted: '#9aa0a6',
    accent: '#6ea8ff',
    error: '#ff7b6b',
    grid: '#262a33',
    axis: '#5a6170',
    plot: ['#6ea8ff', '#ffb86c', '#8be39b', '#c39bff', '#5eead4'],
  },
  highContrast: {
    bg: '#000000',
    panel: '#000000',
    text: '#ffffff',
    muted: '#ffffff',
    accent: '#ffff00',
    error: '#ff5555',
    grid: '#ffffff',
    axis: '#ffffff',
    plot: ['#ffff00', '#00ffff', '#ff00ff', '#00ff00', '#ffffff'],
  },
};

interface ThemeContextValue {
  theme: Theme;
  setMode: (m: ThemeMode) => void;
  setLargePrint: (b: boolean) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');
  const [largePrint, setLargePrint] = useState(false);

  const theme = useMemo<Theme>(() => ({
    mode,
    largePrint,
    colors: palettes[mode],
    font: {
      base: largePrint ? 20 : 14,
      mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    },
    spacing: (n: number) => `${n * 4}px`,
  }), [mode, largePrint]);

  const setModeCb = useCallback((m: ThemeMode) => setMode(m), []);
  const setLargePrintCb = useCallback((b: boolean) => setLargePrint(b), []);

  const value = useMemo(() => ({
    theme,
    setMode: setModeCb,
    setLargePrint: setLargePrintCb,
  }), [theme, setModeCb, setLargePrintCb]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
