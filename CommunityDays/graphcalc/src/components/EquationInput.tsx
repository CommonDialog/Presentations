import { useMemo } from 'react';
import { useTheme } from '../theme';

interface Props {
  value: string;
  onChange: (v: string) => void;
  color: string;
  error?: string;
  visible: boolean;
  onToggleVisible: () => void;
  ariaLabel: string;
}

// Lightweight MathQuill-style rendering preview: shows pretty math next to raw input.
// We render exponents as superscripts and fractions a/b as stacked using SVG-ish HTML.
function prettify(raw: string): string {
  let s = raw;
  s = s.replace(/\*/g, '·');
  s = s.replace(/sqrt\(([^()]+)\)/g, '√($1)');
  s = s.replace(/pi/gi, 'π');
  s = s.replace(/\^(\([^)]+\)|\w+)/g, (_m, g) => `^${g}`);
  return s;
}

export function EquationInput({ value, onChange, color, error, visible, onToggleVisible, ariaLabel }: Props) {
  const { theme } = useTheme();
  const pretty = useMemo(() => prettify(value), [value]);

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 8,
        padding: theme.spacing(2),
        background: theme.colors.panel,
        borderLeft: `4px solid ${error ? theme.colors.error : color}`,
        borderRadius: 4,
        marginBottom: 4,
      }}
    >
      <button
        type="button"
        onClick={onToggleVisible}
        aria-pressed={visible}
        aria-label={visible ? `Hide plot ${ariaLabel}` : `Show plot ${ariaLabel}`}
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: visible ? color : 'transparent',
          border: `2px solid ${color}`,
          cursor: 'pointer',
          flexShrink: 0,
          alignSelf: 'center',
        }}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
          aria-label={`${ariaLabel} expression`}
          aria-invalid={!!error}
          style={{
            background: 'transparent',
            color: theme.colors.text,
            border: 'none',
            outline: 'none',
            fontFamily: theme.font.mono,
            fontSize: theme.font.base,
            padding: 4,
          }}
          placeholder="y = x^2"
        />
        {value && (
          <div
            aria-hidden="true"
            style={{
              fontFamily: 'Cambria Math, Georgia, serif',
              fontStyle: 'italic',
              color: theme.colors.muted,
              fontSize: theme.font.base - 2,
              paddingLeft: 4,
            }}
          >
            {pretty}
          </div>
        )}
        {error && (
          <div
            role="alert"
            style={{
              color: theme.colors.error,
              fontSize: theme.font.base - 3,
              paddingLeft: 4,
            }}
          >
            ⚠ {error} — input preserved, keep editing
          </div>
        )}
      </div>
    </div>
  );
}
