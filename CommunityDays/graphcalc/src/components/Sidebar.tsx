import { useState } from 'react';
import { useTheme } from '../theme';
import type { Expression, Folder } from '../types';
import { EquationInput } from './EquationInput';

interface Props {
  expressions: Expression[];
  folders: Folder[];
  onUpdate: (id: string, patch: Partial<Expression>) => void;
  onAdd: (folderId?: string) => void;
  onDelete: (id: string) => void;
  onAddFolder: () => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onMoveToFolder: (id: string, folderId?: string) => void;
}

export function Sidebar(p: Props) {
  const { theme } = useTheme();
  const ungrouped = p.expressions.filter(e => !e.folderId);

  return (
    <aside
      style={{
        width: 360,
        background: theme.colors.bg,
        color: theme.colors.text,
        padding: theme.spacing(2),
        overflow: 'auto',
        borderRight: `1px solid ${theme.colors.grid}`,
      }}
      aria-label="Expression list"
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: theme.spacing(2) }}>
        <button onClick={() => p.onAdd()} style={btn(theme.colors.accent)}>+ Expression</button>
        <button onClick={p.onAddFolder} style={btn(theme.colors.muted)}>+ Folder</button>
      </div>

      {p.folders.map(f => {
        const items = p.expressions.filter(e => e.folderId === f.id);
        return (
          <FolderView
            key={f.id}
            folder={f}
            items={items}
            allFolders={p.folders}
            {...p}
          />
        );
      })}

      {ungrouped.map((e, i) => (
        <ExpressionRow
          key={e.id}
          expr={e}
          index={i}
          allFolders={p.folders}
          onUpdate={p.onUpdate}
          onDelete={p.onDelete}
          onMoveToFolder={p.onMoveToFolder}
        />
      ))}
    </aside>
  );
}

function FolderView({
  folder, items, allFolders, onUpdate, onDelete, onRenameFolder, onDeleteFolder,
  onToggleFolder, onMoveToFolder, onAdd,
}: { folder: Folder; items: Expression[]; allFolders: Folder[] } & Props) {
  const { theme } = useTheme();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);

  return (
    <div style={{
      marginBottom: theme.spacing(3),
      border: `1px solid ${theme.colors.grid}`,
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: theme.spacing(2),
        background: theme.colors.panel,
      }}>
        <button
          onClick={() => onToggleFolder(folder.id)}
          aria-expanded={!folder.collapsed}
          aria-label={`Toggle folder ${folder.name}`}
          style={iconBtn(theme.colors.text)}
        >
          {folder.collapsed ? '▶' : '▼'}
        </button>
        {editing ? (
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => { onRenameFolder(folder.id, name); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') { onRenameFolder(folder.id, name); setEditing(false); } }}
            autoFocus
            style={{
              flex: 1, background: 'transparent', color: theme.colors.text,
              border: `1px solid ${theme.colors.accent}`, padding: 2,
            }}
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            style={{ flex: 1, textAlign: 'left', background: 'transparent', color: theme.colors.text, border: 'none', cursor: 'text', fontSize: theme.font.base }}
          >
            📁 {folder.name}
          </button>
        )}
        <button onClick={() => onAdd(folder.id)} aria-label="Add expression to folder" style={iconBtn(theme.colors.accent)}>+</button>
        <button onClick={() => onDeleteFolder(folder.id)} aria-label="Delete folder" style={iconBtn(theme.colors.error)}>×</button>
      </div>
      {!folder.collapsed && (
        <div style={{ padding: theme.spacing(2) }}>
          {items.map((e, i) => (
            <ExpressionRow
              key={e.id}
              expr={e}
              index={i}
              allFolders={allFolders}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onMoveToFolder={onMoveToFolder}
            />
          ))}
          {items.length === 0 && (
            <div style={{ color: theme.colors.muted, fontSize: theme.font.base - 2, fontStyle: 'italic' }}>
              Empty — add expressions here.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExpressionRow({
  expr, index, allFolders, onUpdate, onDelete, onMoveToFolder,
}: {
  expr: Expression;
  index: number;
  allFolders: Folder[];
  onUpdate: (id: string, patch: Partial<Expression>) => void;
  onDelete: (id: string) => void;
  onMoveToFolder: (id: string, folderId?: string) => void;
}) {
  const { theme } = useTheme();
  const [showNote, setShowNote] = useState(!!expr.note);

  return (
    <div>
      <EquationInput
        value={expr.raw}
        onChange={v => onUpdate(expr.id, { raw: v })}
        color={expr.color}
        error={expr.error}
        visible={expr.visible}
        onToggleVisible={() => onUpdate(expr.id, { visible: !expr.visible })}
        ariaLabel={`Expression ${index + 1}`}
      />
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, paddingLeft: 32 }}>
        <button onClick={() => setShowNote(s => !s)} style={tinyBtn(theme.colors.muted)}>
          {showNote ? 'Hide note' : 'Add note'}
        </button>
        <select
          value={expr.folderId ?? ''}
          onChange={e => onMoveToFolder(expr.id, e.target.value || undefined)}
          style={{
            background: theme.colors.panel, color: theme.colors.text,
            border: `1px solid ${theme.colors.grid}`, fontSize: theme.font.base - 3,
          }}
          aria-label="Move to folder"
        >
          <option value="">(no folder)</option>
          {allFolders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <button onClick={() => onDelete(expr.id)} style={tinyBtn(theme.colors.error)}>Delete</button>
      </div>
      {showNote && (
        <textarea
          value={expr.note ?? ''}
          onChange={e => onUpdate(expr.id, { note: e.target.value })}
          placeholder="Notes for this expression…"
          rows={2}
          aria-label={`Notes for expression ${index + 1}`}
          style={{
            width: 'calc(100% - 32px)', marginLeft: 32, marginBottom: 8,
            background: theme.colors.panel, color: theme.colors.text,
            border: `1px solid ${theme.colors.grid}`, padding: 6, borderRadius: 4,
            fontFamily: 'inherit', fontSize: theme.font.base - 2, resize: 'vertical',
          }}
        />
      )}
    </div>
  );
}

function btn(color: string): React.CSSProperties {
  return {
    background: color, color: '#fff', border: 'none', padding: '6px 10px',
    borderRadius: 4, cursor: 'pointer', fontSize: 13,
  };
}
function iconBtn(color: string): React.CSSProperties {
  return {
    background: 'transparent', color, border: 'none', cursor: 'pointer',
    fontSize: 14, padding: 4,
  };
}
function tinyBtn(color: string): React.CSSProperties {
  return {
    background: 'transparent', color, border: `1px solid ${color}`,
    padding: '2px 6px', borderRadius: 3, cursor: 'pointer', fontSize: 11,
  };
}
