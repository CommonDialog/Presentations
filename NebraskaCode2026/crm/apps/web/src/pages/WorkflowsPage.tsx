import { useState, type FormEvent } from 'react';
import {
  conditionOps,
  taskPriorities,
  workflowTriggerTypes,
  type WorkflowAction,
  type WorkflowCondition,
  type WorkflowCreateInput,
  type WorkflowDto,
  type WorkflowTriggerType,
} from '@crm/shared';
import {
  useWorkflowMutations,
  useWorkflowRuns,
  useWorkflows,
  useWorkflowTemplates,
} from '../api/workflowHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

const triggerLabels: Record<WorkflowTriggerType, string> = {
  'lead.created': 'Lead created',
  'contact.created': 'Contact created',
  'deal.created': 'Deal created',
  'deal.stage_changed': 'Deal stage changed',
  'deal.won': 'Deal won',
  'deal.lost': 'Deal lost',
  'project.created': 'Project created',
};

const actionLabels: Record<WorkflowAction['type'], string> = {
  create_task: 'Create task',
  send_email: 'Send email',
  notify: 'Send notification',
  analyze_deal: 'Run AI deal analysis',
  create_onboarding_project: 'Create onboarding project',
  post_message: 'Post to Slack/Teams',
};

function defaultAction(type: WorkflowAction['type']): WorkflowAction {
  switch (type) {
    case 'create_task':
      return { type, title: '' };
    case 'send_email':
      return { type, to: 'owner', subject: '', body: '' };
    case 'notify':
      return { type, recipient: 'owner', message: '' };
    case 'post_message':
      return { type, target: 'slack', message: '' };
    case 'analyze_deal':
    case 'create_onboarding_project':
      return { type };
  }
}

function summarizeAction(action: WorkflowAction): string {
  switch (action.type) {
    case 'create_task':
      return `Create task "${action.title}"`;
    case 'send_email':
      return `Email ${action.to}: "${action.subject}"`;
    case 'notify':
      return `Notify ${action.recipient}: "${action.message}"`;
    case 'post_message':
      return `Post to ${action.target}: "${action.message}"`;
    default:
      return actionLabels[action.type];
  }
}

export function WorkflowsPage() {
  const { data, isLoading } = useWorkflows();
  const { data: templateData } = useWorkflowTemplates();
  const { create, update, remove } = useWorkflowMutations();
  const [showCreate, setShowCreate] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Workflows</h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New workflow'}</Button>
      </div>

      {showCreate ? (
        <WorkflowForm
          onSubmit={(input) => create.mutate(input, { onSuccess: () => setShowCreate(false) })}
          pending={create.isPending}
          error={create.error}
        />
      ) : null}

      <Card>
        {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}
        <ul className="divide-y divide-gray-100">
          {data?.workflows.map((workflow) => (
            <li key={workflow.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {workflow.name}
                    {workflow.enabled ? null : (
                      <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">disabled</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    When {triggerLabels[workflow.triggerType]}
                    {workflow.conditions.length > 0
                      ? ` and ${workflow.conditions
                          .map((c) => `${c.field} ${c.op}${c.value !== undefined ? ` ${c.value}` : ''}`)
                          .join(', ')}`
                      : ''}
                    {' → '}
                    {workflow.actions.map(summarizeAction).join('; ')}
                  </p>
                  {workflow.description ? (
                    <p className="mt-0.5 text-xs text-gray-400">{workflow.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setExpandedId(expandedId === workflow.id ? null : workflow.id)}
                  >
                    Runs
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => update.mutate({ id: workflow.id, enabled: !workflow.enabled })}
                  >
                    {workflow.enabled ? 'Disable' : 'Enable'}
                  </Button>
                  <Button variant="danger" onClick={() => remove.mutate(workflow.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              {expandedId === workflow.id ? <RunHistory workflowId={workflow.id} /> : null}
            </li>
          ))}
          {data && data.workflows.length === 0 ? (
            <li className="py-6 text-center text-sm text-gray-500">
              No workflows yet. Start from a template below or build your own.
            </li>
          ) : null}
        </ul>
        <ErrorNote error={update.error ?? remove.error} />
      </Card>

      <Card title="Templates">
        <ul className="divide-y divide-gray-100">
          {templateData?.templates.map((template) => (
            <li key={template.key} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="text-sm font-medium text-gray-800">{template.name}</p>
                <p className="text-xs text-gray-500">{template.description}</p>
              </div>
              <Button
                variant="secondary"
                disabled={create.isPending}
                onClick={() => create.mutate(template.definition)}
              >
                Use template
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function RunHistory(props: { workflowId: string }) {
  const { data, isLoading } = useWorkflowRuns(props.workflowId);
  const statusColors: Record<string, string> = {
    executed: 'text-green-700',
    skipped: 'text-gray-500',
    failed: 'text-red-700',
  };
  return (
    <div className="mt-2 rounded border border-gray-100 bg-gray-50 p-2">
      {isLoading ? <p className="text-xs text-gray-500">Loading…</p> : null}
      <ul className="space-y-1">
        {data?.runs.map((run) => (
          <li key={run.id} className="text-xs text-gray-600">
            <span className={`font-medium ${statusColors[run.status] ?? ''}`}>{run.status}</span>
            {' · '}
            {new Date(run.createdAt).toLocaleString()}
            {run.actionsExecuted.length > 0
              ? ` · ${run.actionsExecuted.map((a) => a.note ? `${a.type} (${a.note})` : a.type).join(', ')}`
              : ''}
            {run.error ? <span className="text-red-600"> — {run.error}</span> : null}
          </li>
        ))}
        {data && data.runs.length === 0 ? (
          <li className="text-xs text-gray-500">This workflow has not run yet.</li>
        ) : null}
      </ul>
    </div>
  );
}

function WorkflowForm(props: {
  onSubmit: (input: WorkflowCreateInput) => void;
  pending: boolean;
  error: unknown;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<WorkflowTriggerType>('deal.stage_changed');
  const [conditions, setConditions] = useState<WorkflowCondition[]>([]);
  const [actions, setActions] = useState<WorkflowAction[]>([defaultAction('notify')]);

  function setCondition(index: number, patch: Partial<WorkflowCondition>) {
    setConditions((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function setAction(index: number, action: WorkflowAction) {
    setActions((prev) => prev.map((a, i) => (i === index ? action : a)));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    props.onSubmit({
      name,
      ...(description ? { description } : {}),
      triggerType,
      conditions,
      actions,
      enabled: true,
    });
  }

  return (
    <Card title="New workflow">
      <form onSubmit={submit} className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name">
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Trigger">
            <select
              className={inputClass}
              value={triggerType}
              onChange={(e) => setTriggerType(e.target.value as WorkflowTriggerType)}
            >
              {workflowTriggerTypes.map((t) => (
                <option key={t} value={t}>
                  {triggerLabels[t]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Description (optional)">
          <input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Conditions (all must match)</span>
            <Button
              variant="secondary"
              onClick={() => setConditions((prev) => [...prev, { field: '', op: 'eq', value: '' }])}
            >
              Add condition
            </Button>
          </div>
          {conditions.length === 0 ? (
            <p className="text-xs text-gray-500">No conditions — runs on every matching event.</p>
          ) : null}
          <div className="space-y-2">
            {conditions.map((condition, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  className={inputClass}
                  placeholder="field, e.g. deal.amount"
                  value={condition.field}
                  onChange={(e) => setCondition(i, { field: e.target.value })}
                  required
                />
                <select
                  className={`${inputClass} w-28`}
                  value={condition.op}
                  onChange={(e) => setCondition(i, { op: e.target.value as WorkflowCondition['op'] })}
                >
                  {conditionOps.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                {condition.op === 'exists' ? null : (
                  <input
                    className={inputClass}
                    placeholder="value"
                    value={String(condition.value ?? '')}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const asNumber = Number(raw);
                      setCondition(i, { value: raw !== '' && !Number.isNaN(asNumber) ? asNumber : raw });
                    }}
                  />
                )}
                <Button variant="danger" onClick={() => setConditions((prev) => prev.filter((_, j) => j !== i))}>
                  ✕
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">Actions (run in order)</span>
            <Button variant="secondary" onClick={() => setActions((prev) => [...prev, defaultAction('notify')])}>
              Add action
            </Button>
          </div>
          <div className="space-y-2">
            {actions.map((action, i) => (
              <div key={i} className="rounded border border-gray-200 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <select
                    className={`${inputClass} w-56`}
                    value={action.type}
                    onChange={(e) => setAction(i, defaultAction(e.target.value as WorkflowAction['type']))}
                  >
                    {(Object.keys(actionLabels) as WorkflowAction['type'][]).map((t) => (
                      <option key={t} value={t}>
                        {actionLabels[t]}
                      </option>
                    ))}
                  </select>
                  {actions.length > 1 ? (
                    <Button variant="danger" onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  ) : null}
                </div>
                <ActionFields action={action} onChange={(a) => setAction(i, a)} />
              </div>
            ))}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Text fields support {'{{deal.name}}'}-style placeholders from the trigger context.
          </p>
        </div>

        <Button type="submit" disabled={props.pending}>
          Create workflow
        </Button>
        <ErrorNote error={props.error} />
      </form>
    </Card>
  );
}

function ActionFields(props: { action: WorkflowAction; onChange: (action: WorkflowAction) => void }) {
  const { action, onChange } = props;

  if (action.type === 'create_task') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Task title">
          <input
            className={inputClass}
            value={action.title}
            onChange={(e) => onChange({ ...action, title: e.target.value })}
            required
          />
        </Field>
        <Field label="Priority">
          <select
            className={inputClass}
            value={action.priority ?? 'normal'}
            onChange={(e) => onChange({ ...action, priority: e.target.value as typeof action.priority })}
          >
            {taskPriorities.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Due in days (optional)">
          <input
            className={inputClass}
            type="number"
            min={0}
            max={365}
            value={action.dueInDays ?? ''}
            onChange={(e) =>
              onChange({
                ...action,
                ...(e.target.value === '' ? { dueInDays: undefined } : { dueInDays: Number(e.target.value) }),
              })
            }
          />
        </Field>
        <Field label="Description (optional)">
          <input
            className={inputClass}
            value={action.description ?? ''}
            onChange={(e) => onChange({ ...action, description: e.target.value || undefined })}
          />
        </Field>
      </div>
    );
  }

  if (action.type === 'send_email') {
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label='To ("owner", "contact", or an email)'>
            <input
              className={inputClass}
              value={action.to}
              onChange={(e) => onChange({ ...action, to: e.target.value })}
              required
            />
          </Field>
          <Field label="Subject">
            <input
              className={inputClass}
              value={action.subject}
              onChange={(e) => onChange({ ...action, subject: e.target.value })}
              required
            />
          </Field>
        </div>
        <Field label="Body">
          <textarea
            className={`${inputClass} h-20`}
            value={action.body}
            onChange={(e) => onChange({ ...action, body: e.target.value })}
            required
          />
        </Field>
      </div>
    );
  }

  if (action.type === 'notify') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Recipient">
          <select
            className={inputClass}
            value={action.recipient}
            onChange={(e) => onChange({ ...action, recipient: e.target.value as typeof action.recipient })}
          >
            <option value="owner">Record owner</option>
            <option value="actor">Triggering user</option>
          </select>
        </Field>
        <Field label="Message">
          <input
            className={inputClass}
            value={action.message}
            onChange={(e) => onChange({ ...action, message: e.target.value })}
            required
          />
        </Field>
      </div>
    );
  }

  if (action.type === 'post_message') {
    return (
      <div className="grid grid-cols-2 gap-2">
        <Field label="Channel">
          <select
            className={inputClass}
            value={action.target}
            onChange={(e) => onChange({ ...action, target: e.target.value as typeof action.target })}
          >
            <option value="slack">Slack</option>
            <option value="teams">Microsoft Teams</option>
          </select>
        </Field>
        <Field label="Message">
          <input
            className={inputClass}
            value={action.message}
            onChange={(e) => onChange({ ...action, message: e.target.value })}
            required
          />
        </Field>
      </div>
    );
  }

  // analyze_deal / create_onboarding_project take no configuration.
  return (
    <p className="text-xs text-gray-500">
      {action.type === 'analyze_deal'
        ? 'Re-runs AI analysis on the deal in the trigger context.'
        : 'Creates the onboarding project from the deal in the trigger context.'}
    </p>
  );
}
