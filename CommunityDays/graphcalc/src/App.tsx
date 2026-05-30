import { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeProvider, useTheme } from './theme';
import type { Expression, Folder } from './types';
import { Sidebar } from './components/Sidebar';
import { Graph } from './components/Graph';
import { Toolbar } from './components/Toolbar';

const PLOT_COLORS = ['#2a6df4', '#e67e22', '#27ae60', '#8e44ad', '#16a085', '#c0392b'];

function makeId() {
  return Math.random().toString(36).slice(2, 9);
}

const STORAGE_KEY = 'graphcalc.v1';

function loadState(): { expressions: Expression[]; folders: Folder[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return {
    expressions: [
      { id: makeId(), raw: 'y = x^2', color: PLOT_COLORS[0], visible: true },
      { id: makeId(), raw: 'y = sin(x)', color: PLOT_COLORS[1], visible: true },
      { id: makeId(), raw: 'y = tan(x)', color: PLOT_COLORS[2], visible: true },
      { id: makeId(), raw: 'x^2 + y^2 = 25', color: PLOT_COLORS[3], visible: true },
    ],
    folders: [],
  };
}

function AppInner() {
  const { theme } = useTheme();
  const initial = useMemo(loadState, []);
  const [expressions, setExpressions] = useState<Expression[]>(initial.expressions);
  const [folders, setFolders] = useState<Folder[]>(initial.folders);
  const [highDensity, setHighDensity] = useState(false);
  const [graphSize, setGraphSize] = useState({ w: 800, h: 600 });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ expressions, folders }));
  }, [expressions, folders]);

  useEffect(() => {
    const onResize = () => {
      const w = Math.max(400, window.innerWidth - 380);
      const h = Math.max(300, window.innerHeight - 100);
      setGraphSize({ w, h });
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onAdd = useCallback((folderId?: string) => {
    setExpressions(prev => [
      ...prev,
      {
        id: makeId(),
        raw: '',
        color: PLOT_COLORS[prev.length % PLOT_COLORS.length],
        visible: true,
        folderId,
      },
    ]);
  }, []);

  const onUpdate = useCallback((id: string, patch: Partial<Expression>) => {
    setExpressions(prev => prev.map(e => (e.id === id ? { ...e, ...patch } : e)));
  }, []);

  const onDelete = useCallback((id: string) => {
    setExpressions(prev => prev.filter(e => e.id !== id));
  }, []);

  const onAddFolder = useCallback(() => {
    setFolders(prev => [
      ...prev,
      { id: makeId(), name: `Folder ${prev.length + 1}`, collapsed: false },
    ]);
  }, []);

  const onRenameFolder = useCallback((id: string, name: string) => {
    setFolders(prev => prev.map(f => (f.id === id ? { ...f, name } : f)));
  }, []);

  const onDeleteFolder = useCallback((id: string) => {
    setFolders(prev => prev.filter(f => f.id !== id));
    setExpressions(prev => prev.map(e => (e.folderId === id ? { ...e, folderId: undefined } : e)));
  }, []);

  const onToggleFolder = useCallback((id: string) => {
    setFolders(prev => prev.map(f => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
  }, []);

  const onMoveToFolder = useCallback((id: string, folderId?: string) => {
    setExpressions(prev => prev.map(e => (e.id === id ? { ...e, folderId } : e)));
  }, []);

  const onCompileResult = useCallback((id: string, error?: string) => {
    setExpressions(prev => prev.map(e => (e.id === id ? { ...e, error } : e)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        onAdd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onAdd]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: theme.colors.bg,
        color: theme.colors.text,
        fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
        fontSize: theme.font.base,
      }}
    >
      <a
        href="#main"
        style={{
          position: 'absolute', left: -9999, top: 0,
          padding: 8, background: theme.colors.accent, color: '#fff', zIndex: 1000,
        }}
        onFocus={e => { e.currentTarget.style.left = '8px'; }}
        onBlur={e => { e.currentTarget.style.left = '-9999px'; }}
      >
        Skip to graph
      </a>
      <Toolbar
        expressions={expressions}
        highDensity={highDensity}
        setHighDensity={setHighDensity}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <Sidebar
          expressions={expressions}
          folders={folders}
          onUpdate={onUpdate}
          onAdd={onAdd}
          onDelete={onDelete}
          onAddFolder={onAddFolder}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
          onToggleFolder={onToggleFolder}
          onMoveToFolder={onMoveToFolder}
        />
        <main id="main" style={{ flex: 1, padding: theme.spacing(2), overflow: 'auto' }}>
          <Graph
            expressions={expressions}
            width={graphSize.w}
            height={graphSize.h}
            highDensity={highDensity}
            onCompileResult={onCompileResult}
          />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  );
}
