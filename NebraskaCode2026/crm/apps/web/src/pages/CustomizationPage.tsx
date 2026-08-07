import { useState, type FormEvent } from 'react';
import {
  customFieldTypes,
  customizableEntityTypes,
  RECORD_TYPE_FIELD,
  type CustomFieldDto,
  type CustomFieldType,
  type CustomizableEntityType,
  type FieldCondition,
  type FieldRules,
  type LayoutSection,
} from '@crm/shared';
import {
  useCustomFields,
  useCustomizationMutations,
  useLayouts,
  useRecordTypes,
} from '../api/customizationHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

const entityLabels: Record<CustomizableEntityType, string> = {
  account: 'Accounts',
  contact: 'Contacts',
  deal: 'Deals',
  lead: 'Leads',
  project: 'Projects',
};

const conditionOps = ['eq', 'neq', 'in', 'set', 'notset'] as const;

function ConditionEditor(props: {
  label: string;
  condition: FieldCondition | undefined;
  fieldKeys: string[];
  onChange: (c: FieldCondition | undefined) => void;
}) {
  const c = props.condition;
  return (
    <div className="flex items-end gap-2">
      <Field label={props.label}>
        <select
          className={inputClass}
          value={c?.field ?? ''}
          onChange={(e) => {
            const field = e.target.value;
            props.onChange(field ? { field, op: c?.op ?? 'eq', value: c?.value ?? '' } : undefined);
          }}
        >
          <option value="">always</option>
          <option value={RECORD_TYPE_FIELD}>record type</option>
          {props.fieldKeys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      {c ? (
        <>
          <select
            className={`${inputClass} w-24`}
            value={c.op}
            onChange={(e) =>
              props.onChange({ ...c, op: e.target.value as FieldCondition['op'] })
            }
          >
            {conditionOps.map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </select>
          {c.op === 'set' || c.op === 'notset' ? null : (
            <input
              className={inputClass}
              placeholder={c.op === 'in' ? 'comma,separated' : 'value'}
              value={
                Array.isArray(c.value) ? c.value.join(',') : c.value === undefined ? '' : String(c.value)
              }
              onChange={(e) =>
                props.onChange({
                  ...c,
                  value: c.op === 'in' ? e.target.value.split(',').map((s) => s.trim()) : e.target.value,
                })
              }
            />
          )}
        </>
      ) : null}
    </div>
  );
}

function FieldForm(props: {
  entityType: CustomizableEntityType;
  existing: CustomFieldDto | null;
  otherFieldKeys: string[];
  recordTypeKeys: string[];
  onDone: () => void;
}) {
  const { createField, updateField } = useCustomizationMutations(props.entityType);
  const [key, setKey] = useState(props.existing?.key ?? '');
  const [label, setLabel] = useState(props.existing?.label ?? '');
  const [fieldType, setFieldType] = useState<CustomFieldType>(props.existing?.fieldType ?? 'text');
  const [required, setRequired] = useState(props.existing?.required ?? false);
  const [options, setOptions] = useState((props.existing?.options ?? []).join(', '));
  const [rules, setRules] = useState<FieldRules>(props.existing?.rules ?? {});
  const mutation = props.existing ? updateField : createField;

  function setRule<K extends keyof FieldRules>(k: K, v: FieldRules[K] | undefined) {
    setRules((prev) => {
      const next = { ...prev };
      if (v === undefined || (typeof v === 'string' && v === '')) delete next[k];
      else next[k] = v;
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsedOptions = options
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const base = {
      label,
      required,
      ...(parsedOptions.length > 0 ? { options: parsedOptions } : {}),
      rules,
    };
    if (props.existing) {
      updateField.mutate({ id: props.existing.id, ...base }, { onSuccess: props.onDone });
    } else {
      createField.mutate(
        { entityType: props.entityType, key, fieldType, displayOrder: 0, ...base },
        { onSuccess: props.onDone },
      );
    }
  }

  const needsOptions = fieldType === 'select' || fieldType === 'multiselect';
  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-gray-200 p-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label="Key (immutable)">
          <input
            className={inputClass}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            disabled={props.existing !== null}
            placeholder="contract_value"
            required
          />
        </Field>
        <Field label="Label">
          <input className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} required />
        </Field>
        <Field label="Type">
          <select
            className={inputClass}
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            disabled={props.existing !== null}
          >
            {customFieldTypes.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {needsOptions ? (
        <Field label="Options (comma-separated)">
          <input className={inputClass} value={options} onChange={(e) => setOptions(e.target.value)} />
        </Field>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex items-center gap-1 text-sm text-gray-700">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
          always required
        </label>
        {fieldType === 'number' ? (
          <>
            <Field label="Min">
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={rules.min ?? ''}
                onChange={(e) => setRule('min', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
            <Field label="Max">
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={rules.max ?? ''}
                onChange={(e) => setRule('max', e.target.value === '' ? undefined : Number(e.target.value))}
              />
            </Field>
          </>
        ) : null}
        {fieldType === 'text' ? (
          <>
            <Field label="Max length">
              <input
                className={`${inputClass} w-24`}
                type="number"
                value={rules.maxLength ?? ''}
                onChange={(e) =>
                  setRule('maxLength', e.target.value === '' ? undefined : Number(e.target.value))
                }
              />
            </Field>
            <Field label="Pattern (regex)">
              <input
                className={inputClass}
                value={rules.pattern ?? ''}
                onChange={(e) => setRule('pattern', e.target.value || undefined)}
              />
            </Field>
          </>
        ) : null}
      </div>

      <ConditionEditor
        label="Visible when"
        condition={rules.visibleWhen}
        fieldKeys={props.otherFieldKeys.filter((k) => k !== key)}
        onChange={(c) => setRule('visibleWhen', c)}
      />
      <ConditionEditor
        label="Required when"
        condition={rules.requiredWhen}
        fieldKeys={props.otherFieldKeys.filter((k) => k !== key)}
        onChange={(c) => setRule('requiredWhen', c)}
      />

      {props.recordTypeKeys.length > 0 ? (
        <div>
          <span className="mb-1 block text-sm font-medium text-gray-700">Limit to record types</span>
          <div className="flex flex-wrap gap-2">
            {props.recordTypeKeys.map((rt) => (
              <label key={rt} className="flex items-center gap-1 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={(rules.recordTypes ?? []).includes(rt)}
                  onChange={(e) => {
                    const current = rules.recordTypes ?? [];
                    const next = e.target.checked ? [...current, rt] : current.filter((r) => r !== rt);
                    setRule('recordTypes', next.length > 0 ? next : undefined);
                  }}
                />
                {rt}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {props.existing ? 'Save field' : 'Add field'}
        </Button>
        <Button variant="secondary" onClick={props.onDone}>
          Cancel
        </Button>
      </div>
      <ErrorNote error={mutation.error} />
    </form>
  );
}

function FieldsPanel(props: { entityType: CustomizableEntityType; recordTypeKeys: string[] }) {
  const { data } = useCustomFields(props.entityType);
  const { updateField, removeField } = useCustomizationMutations(props.entityType);
  const [editing, setEditing] = useState<CustomFieldDto | null>(null);
  const [adding, setAdding] = useState(false);
  const fields = data?.fields ?? [];

  return (
    <Card title="Fields">
      <ul className="divide-y divide-gray-100">
        {fields.map((field) => (
          <li key={field.id} className="flex items-center justify-between gap-2 py-2">
            <div>
              <p className="text-sm font-medium text-gray-900">
                {field.label}
                <span className="ml-2 text-xs font-normal text-gray-500">
                  {field.key} · {field.fieldType}
                  {field.required ? ' · required' : ''}
                  {field.rules.visibleWhen ? ' · conditional' : ''}
                </span>
                {field.isActive ? null : (
                  <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">inactive</span>
                )}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={() => setEditing(field)}>
                Edit
              </Button>
              <Button
                variant="secondary"
                onClick={() => updateField.mutate({ id: field.id, isActive: !field.isActive })}
              >
                {field.isActive ? 'Deactivate' : 'Activate'}
              </Button>
              <Button variant="danger" onClick={() => removeField.mutate(field.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {fields.length === 0 ? (
          <li className="py-3 text-center text-sm text-gray-500">No custom fields yet.</li>
        ) : null}
      </ul>

      {editing ? (
        <FieldForm
          entityType={props.entityType}
          existing={editing}
          otherFieldKeys={fields.map((f) => f.key)}
          recordTypeKeys={props.recordTypeKeys}
          onDone={() => setEditing(null)}
        />
      ) : adding ? (
        <FieldForm
          entityType={props.entityType}
          existing={null}
          otherFieldKeys={fields.map((f) => f.key)}
          recordTypeKeys={props.recordTypeKeys}
          onDone={() => setAdding(false)}
        />
      ) : (
        <div className="mt-2">
          <Button onClick={() => setAdding(true)}>Add field</Button>
        </div>
      )}
    </Card>
  );
}

function RecordTypesPanel(props: { entityType: CustomizableEntityType }) {
  const { data } = useRecordTypes(props.entityType);
  const { createRecordType, updateRecordType, removeRecordType } = useCustomizationMutations(props.entityType);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const recordTypesList = data?.recordTypes ?? [];

  return (
    <Card title="Record types">
      <ul className="divide-y divide-gray-100">
        {recordTypesList.map((rt) => (
          <li key={rt.id} className="flex items-center justify-between gap-2 py-2">
            <p className="text-sm text-gray-900">
              {rt.name}
              <span className="ml-2 text-xs text-gray-500">{rt.key}</span>
              {rt.isDefault ? (
                <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800">default</span>
              ) : null}
            </p>
            <div className="flex shrink-0 gap-2">
              {rt.isDefault ? null : (
                <Button variant="secondary" onClick={() => updateRecordType.mutate({ id: rt.id, isDefault: true })}>
                  Make default
                </Button>
              )}
              <Button variant="danger" onClick={() => removeRecordType.mutate(rt.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
        {recordTypesList.length === 0 ? (
          <li className="py-3 text-center text-sm text-gray-500">
            No record types — all {entityLabels[props.entityType].toLowerCase()} share one form.
          </li>
        ) : null}
      </ul>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          createRecordType.mutate(
            { entityType: props.entityType, key, name, isDefault: false, displayOrder: 0 },
            {
              onSuccess: () => {
                setKey('');
                setName('');
              },
            },
          );
        }}
      >
        <Field label="Key">
          <input className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="renewal" required />
        </Field>
        <Field label="Name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Renewal" required />
        </Field>
        <Button type="submit" disabled={createRecordType.isPending}>
          Add
        </Button>
      </form>
      <ErrorNote error={createRecordType.error ?? removeRecordType.error} />
    </Card>
  );
}

function LayoutPanel(props: { entityType: CustomizableEntityType }) {
  const { data: layoutData } = useLayouts(props.entityType);
  const { data: fieldData } = useCustomFields(props.entityType);
  const { data: rtData } = useRecordTypes(props.entityType);
  const { saveLayout } = useCustomizationMutations(props.entityType);
  const [recordTypeId, setRecordTypeId] = useState<string | null>(null);
  const [sections, setSections] = useState<LayoutSection[] | null>(null);

  const stored = layoutData?.layouts.find((l) => l.recordTypeId === recordTypeId);
  const current = sections ?? stored?.sections ?? [];
  const fieldKeys = (fieldData?.fields ?? []).filter((f) => f.isActive).map((f) => f.key);

  function patchSection(index: number, patch: Partial<LayoutSection>) {
    const next = current.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setSections(next);
  }

  return (
    <Card title="Layout">
      <div className="mb-2 max-w-xs">
        <Field label="Layout for">
          <select
            className={inputClass}
            value={recordTypeId ?? ''}
            onChange={(e) => {
              setRecordTypeId(e.target.value || null);
              setSections(null);
            }}
          >
            <option value="">Default (all records)</option>
            {(rtData?.recordTypes ?? []).map((rt) => (
              <option key={rt.id} value={rt.id}>
                {rt.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="space-y-3">
        {current.map((section, i) => (
          <div key={section.key} className="rounded border border-gray-200 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Section title">
                <input
                  className={inputClass}
                  value={section.title}
                  onChange={(e) => patchSection(i, { title: e.target.value })}
                />
              </Field>
              <label className="flex items-center gap-1 pb-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={section.collapsed}
                  onChange={(e) => patchSection(i, { collapsed: e.target.checked })}
                />
                starts collapsed
              </label>
              <Button variant="danger" onClick={() => setSections(current.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
            <ConditionEditor
              label="Section visible when"
              condition={section.visibleWhen}
              fieldKeys={fieldKeys}
              onChange={(c) => {
                const next = { ...section } as LayoutSection;
                if (c) next.visibleWhen = c;
                else delete next.visibleWhen;
                setSections(current.map((s, j) => (j === i ? next : s)));
              }}
            />
            <div className="mt-2">
              <span className="mb-1 block text-sm font-medium text-gray-700">Fields (in order)</span>
              <ol className="mb-1 flex flex-wrap gap-1">
                {section.fields.map((key, fi) => (
                  <li key={key} className="flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                    {key}
                    <button
                      type="button"
                      className="text-gray-400 hover:text-gray-700"
                      title="move earlier"
                      onClick={() => {
                        if (fi === 0) return;
                        const fields = [...section.fields];
                        [fields[fi - 1], fields[fi]] = [fields[fi]!, fields[fi - 1]!];
                        patchSection(i, { fields });
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="text-red-400 hover:text-red-700"
                      onClick={() => patchSection(i, { fields: section.fields.filter((f) => f !== key) })}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap gap-2">
                {fieldKeys
                  .filter((k) => !section.fields.includes(k))
                  .map((k) => (
                    <button
                      key={k}
                      type="button"
                      className="rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-700"
                      onClick={() => patchSection(i, { fields: [...section.fields, k] })}
                    >
                      + {k}
                    </button>
                  ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          variant="secondary"
          onClick={() =>
            setSections([
              ...current,
              { key: `section_${current.length + 1}`, title: 'New section', collapsed: false, fields: [] },
            ])
          }
        >
          Add section
        </Button>
        <Button
          disabled={saveLayout.isPending || sections === null}
          onClick={() =>
            saveLayout.mutate(
              { entityType: props.entityType, recordTypeId, sections: current },
              { onSuccess: () => setSections(null) },
            )
          }
        >
          Save layout
        </Button>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Fields not placed in any section still appear under "More fields" on records.
      </p>
      <ErrorNote error={saveLayout.error} />
    </Card>
  );
}

export function CustomizationPage() {
  const [entityType, setEntityType] = useState<CustomizableEntityType>('deal');
  const { data: rtData } = useRecordTypes(entityType);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Customization</h1>
        <div className="flex gap-1">
          {customizableEntityTypes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setEntityType(t)}
              className={`rounded px-2 py-1 text-xs font-medium ${
                entityType === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {entityLabels[t]}
            </button>
          ))}
        </div>
      </div>
      <FieldsPanel
        entityType={entityType}
        recordTypeKeys={(rtData?.recordTypes ?? []).map((r) => r.key)}
      />
      <RecordTypesPanel entityType={entityType} />
      <LayoutPanel entityType={entityType} />
    </div>
  );
}
