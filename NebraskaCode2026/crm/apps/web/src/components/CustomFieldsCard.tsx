import { useEffect, useMemo, useState } from 'react';
import {
  evaluateFieldCondition,
  isEmptyFieldValue,
  RECORD_TYPE_FIELD,
  type CustomFieldDto,
  type CustomizableEntityType,
  type LayoutSection,
} from '@crm/shared';
import { useCustomizationBundle } from '../api/customizationHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

interface Props {
  entityType: CustomizableEntityType;
  values: Record<string, unknown>;
  onSave: (custom: Record<string, unknown>) => void;
  saving: boolean;
  error: unknown;
}

function FieldInput(props: {
  field: CustomFieldDto;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { field, value, onChange } = props;
  switch (field.fieldType) {
    case 'boolean':
      return (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
          {field.label}
        </label>
      );
    case 'select':
      return (
        <select
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-2">
          {(field.options ?? []).map((o) => (
            <label key={o} className="flex items-center gap-1 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...selected, o] : selected.filter((s) => s !== o),
                  )
                }
              />
              {o}
            </label>
          ))}
        </div>
      );
    }
    case 'number':
      return (
        <input
          className={inputClass}
          type="number"
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      );
    case 'date':
      return (
        <input
          className={inputClass}
          type="date"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    default:
      return (
        <input
          className={inputClass}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.fieldType === 'url' ? 'https://…' : undefined}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}

/**
 * Renders an entity's custom fields per the org's layout: sections in order,
 * progressive disclosure via collapsed sections and visibleWhen rules, record
 * type picker, and required markers. All configuration comes from settings —
 * nothing here is entity-specific.
 */
export function CustomFieldsCard(props: Props) {
  const [draft, setDraft] = useState<Record<string, unknown>>(props.values);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const recordTypeKey = typeof draft[RECORD_TYPE_FIELD] === 'string' ? (draft[RECORD_TYPE_FIELD] as string) : undefined;
  const { data: bundle } = useCustomizationBundle(props.entityType, recordTypeKey);

  useEffect(() => {
    setDraft(props.values);
  }, [props.values]);

  const sections = useMemo((): LayoutSection[] => {
    if (!bundle) return [];
    const layoutSections = bundle.layout?.sections ?? [];
    const placed = new Set(layoutSections.flatMap((s) => s.fields));
    const unplaced = bundle.fields.map((f) => f.key).filter((k) => !placed.has(k));
    const all = [...layoutSections];
    if (unplaced.length > 0) {
      all.push({
        key: '__other',
        title: layoutSections.length > 0 ? 'More fields' : 'Details',
        collapsed: false,
        fields: unplaced,
      });
    }
    return all;
  }, [bundle]);

  if (!bundle || (bundle.fields.length === 0 && bundle.recordTypes.length === 0)) return null;
  const byKey = new Map(bundle.fields.map((f) => [f.key, f]));

  function setValue(key: string, value: unknown) {
    setDraft((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function isRequiredNow(field: CustomFieldDto): boolean {
    if (field.required) return true;
    return field.rules.requiredWhen ? evaluateFieldCondition(field.rules.requiredWhen, draft) : false;
  }

  return (
    <Card title="Custom fields">
      {bundle.recordTypes.length > 0 ? (
        <div className="mb-3 max-w-xs">
          <Field label="Record type">
            <select
              className={inputClass}
              value={recordTypeKey ?? ''}
              onChange={(e) => setValue(RECORD_TYPE_FIELD, e.target.value || undefined)}
            >
              <option value="">—</option>
              {bundle.recordTypes.map((rt) => (
                <option key={rt.id} value={rt.key}>
                  {rt.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ) : null}

      <div className="space-y-4">
        {sections.map((section) => {
          if (section.visibleWhen && !evaluateFieldCondition(section.visibleWhen, draft)) return null;
          const fields = section.fields
            .map((k) => byKey.get(k))
            .filter((f): f is CustomFieldDto => f !== undefined)
            .filter((f) => !f.rules.visibleWhen || evaluateFieldCondition(f.rules.visibleWhen, draft));
          if (fields.length === 0) return null;

          const isCollapsed = section.collapsed && !expanded.has(section.key);
          return (
            <div key={section.key}>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{section.title}</h3>
                {section.collapsed ? (
                  <button
                    type="button"
                    className="text-xs text-blue-700 hover:underline"
                    onClick={() =>
                      setExpanded((prev) => {
                        const next = new Set(prev);
                        if (next.has(section.key)) next.delete(section.key);
                        else next.add(section.key);
                        return next;
                      })
                    }
                  >
                    {isCollapsed ? `Show (${fields.length})` : 'Hide'}
                  </button>
                ) : null}
              </div>
              {isCollapsed ? null : (
                <div className="grid grid-cols-2 gap-3">
                  {fields.map((field) => (
                    <div key={field.key}>
                      {field.fieldType === 'boolean' ? (
                        <FieldInput field={field} value={draft[field.key]} onChange={(v) => setValue(field.key, v)} />
                      ) : (
                        <Field label={`${field.label}${isRequiredNow(field) ? ' *' : ''}`}>
                          <FieldInput field={field} value={draft[field.key]} onChange={(v) => setValue(field.key, v)} />
                        </Field>
                      )}
                      {isRequiredNow(field) && isEmptyFieldValue(draft[field.key]) ? (
                        <p className="mt-0.5 text-xs text-amber-700">Required</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-3">
        <Button onClick={() => props.onSave(draft)} disabled={props.saving}>
          Save custom fields
        </Button>
        <ErrorNote error={props.error} />
      </div>
    </Card>
  );
}
