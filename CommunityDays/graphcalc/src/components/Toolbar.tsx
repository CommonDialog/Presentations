import { useTheme } from '../theme';
import type { ThemeMode } from '../theme';
import { AudioTrace } from './AudioTrace';
import type { Expression } from '../types';

interface Props {
  expressions: Expression[];
  highDensity: boolean;
  setHighDensity: (b: boolean) => void;
}

export function Toolbar({ expressions, highDensity, setHighDensity }: Props) {
  const { theme, setMode, setLargePrint } = useTheme();

  return (
    <header
      role="toolbar"
      aria-label="Application toolbar"
      style={{
        display: 'flex',
        gap: 12,
        padding: theme.spacing(2),
        background: theme.colors.panel,
        borderBottom: `1px solid ${theme.colors.grid}`,
        alignItems: 'center',
      }}
    >
      <strong style={{ color: theme.colors.text, fontSize: theme.font.base + 2 }}>
        GraphCalc
      </strong>
      <span style={{ color: theme.colors.muted, fontSize: theme.font.base - 2 }}>
        Tab between fields • Wheel = zoom • Drag = pan
      </span>
      <div style={{ flex: 1 }} />

      <label style={{ color: theme.colors.text, fontSize: theme.font.base - 2 }}>
        Theme:&nbsp;
        <select
          value={theme.mode}
          onChange={e => setMode(e.target.value as ThemeMode)}
          style={selectStyle(theme)}
          aria-label="Theme selector"
        >
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="highContrast">High contrast</option>
        </select>
      </label>

      <label style={{ color: theme.colors.text, fontSize: theme.font.base - 2 }}>
        <input
          type="checkbox"
          checked={theme.largePrint}
          onChange={e => setLargePrint(e.target.checked)}
        /> Large print
      </label>

      <label style={{ color: theme.colors.text, fontSize: theme.font.base - 2 }}>
        <input
          type="checkbox"
          checked={highDensity}
          onChange={e => setHighDensity(e.target.checked)}
        /> High-density (10k samples)
      </label>

      <AudioTrace expressions={expressions} />
    </header>
  );
}

function selectStyle(theme: ReturnType<typeof useTheme>['theme']): React.CSSProperties {
  return {
    background: theme.colors.bg,
    color: theme.colors.text,
    border: `1px solid ${theme.colors.grid}`,
    padding: '2px 6px',
    fontSize: theme.font.base - 2,
  };
}
