import { useState } from 'react';
import {
  webhookEventTypes,
  type ChatIntegrationKind,
  type ImportEntityType,
} from '@crm/shared';
import {
  useApiKeyMutations,
  useApiKeys,
  useImportCsv,
  useIntegrationMutations,
  useIntegrations,
  useWebhookDeliveries,
  useWebhookMutations,
  useWebhooks,
} from '../api/integrationHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

function ChatIntegrationRow(props: { kind: ChatIntegrationKind; label: string }) {
  const { data } = useIntegrations();
  const { save, test } = useIntegrationMutations();
  const existing = data?.integrations.find((i) => i.kind === props.kind);
  const [url, setUrl] = useState<string | null>(null);
  const value = url ?? existing?.config.webhookUrl ?? '';

  return (
    <div className="flex flex-wrap items-end gap-2 py-2">
      <Field label={`${props.label} incoming webhook URL`}>
        <input
          className={`${inputClass} w-96`}
          value={value}
          placeholder={`https://hooks.${props.kind === 'slack' ? 'slack.com' : 'office.com'}/…`}
          onChange={(e) => setUrl(e.target.value)}
        />
      </Field>
      <Button
        disabled={save.isPending || !value}
        onClick={() =>
          save.mutate(
            { kind: props.kind, config: { webhookUrl: value }, enabled: true },
            { onSuccess: () => setUrl(null) },
          )
        }
      >
        Save
      </Button>
      <Button
        variant="secondary"
        disabled={test.isPending || !existing}
        onClick={() => test.mutate(props.kind)}
      >
        Send test
      </Button>
      {test.data && test.variables === props.kind ? (
        <span className={`pb-2 text-xs ${test.data.posted ? 'text-green-700' : 'text-amber-700'}`}>
          {test.data.posted ? 'Delivered ✓' : test.data.note}
        </span>
      ) : null}
    </div>
  );
}

function ApiKeysCard() {
  const { data } = useApiKeys();
  const { create, revoke } = useApiKeyMutations();
  const [name, setName] = useState('');

  return (
    <Card title="REST API keys">
      <p className="mb-2 text-xs text-gray-500">
        Call the full REST API with <code className="rounded bg-gray-100 px-1">Authorization: Bearer &lt;token&gt;</code>.
        A key acts as you, with your permissions.
      </p>
      <ul className="divide-y divide-gray-100">
        {data?.keys.map((key) => (
          <li key={key.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="text-gray-900">
              {key.name}
              <span className="ml-2 font-mono text-xs text-gray-500">{key.prefix}…</span>
              {key.revokedAt ? (
                <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">revoked</span>
              ) : key.lastUsedAt ? (
                <span className="ml-2 text-xs text-gray-400">
                  last used {new Date(key.lastUsedAt).toLocaleString()}
                </span>
              ) : (
                <span className="ml-2 text-xs text-gray-400">never used</span>
              )}
            </span>
            {key.revokedAt ? null : (
              <Button variant="danger" onClick={() => revoke.mutate(key.id)}>
                Revoke
              </Button>
            )}
          </li>
        ))}
        {data && data.keys.length === 0 ? (
          <li className="py-2 text-sm text-gray-500">No API keys yet.</li>
        ) : null}
      </ul>
      <form
        className="mt-2 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(name, { onSuccess: () => setName('') });
        }}
      >
        <Field label="Key name">
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Zapier" required />
        </Field>
        <Button type="submit" disabled={create.isPending}>
          Create key
        </Button>
      </form>
      {create.data ? (
        <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
          Copy this token now — it is shown only once:{' '}
          <code className="break-all font-mono">{create.data.token}</code>
        </p>
      ) : null}
      <ErrorNote error={create.error ?? revoke.error} />
    </Card>
  );
}

function WebhooksCard() {
  const { data } = useWebhooks();
  const { create, update, remove } = useWebhookMutations();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Card title="Outbound webhooks">
      <p className="mb-2 text-xs text-gray-500">
        POSTs CRM events as JSON, signed with HMAC-SHA256 in <code className="rounded bg-gray-100 px-1">X-CRM-Signature</code>.
      </p>
      <ul className="divide-y divide-gray-100">
        {data?.webhooks.map((hook) => (
          <li key={hook.id} className="py-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium text-gray-900">{hook.url}</p>
                <p className="text-xs text-gray-500">
                  {hook.events.length === 0 ? 'all events' : hook.events.join(', ')}
                  {' · secret '}
                  <code className="font-mono">{hook.secret.slice(0, 8)}…</code>
                  {hook.enabled ? '' : ' · disabled'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="secondary" onClick={() => setExpandedId(expandedId === hook.id ? null : hook.id)}>
                  Deliveries
                </Button>
                <Button variant="secondary" onClick={() => update.mutate({ id: hook.id, enabled: !hook.enabled })}>
                  {hook.enabled ? 'Disable' : 'Enable'}
                </Button>
                <Button variant="danger" onClick={() => remove.mutate(hook.id)}>
                  Delete
                </Button>
              </div>
            </div>
            {expandedId === hook.id ? <DeliveryList webhookId={hook.id} /> : null}
          </li>
        ))}
        {data && data.webhooks.length === 0 ? (
          <li className="py-2 text-sm text-gray-500">No webhooks yet.</li>
        ) : null}
      </ul>

      <form
        className="mt-2 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { url, events: events as (typeof webhookEventTypes)[number][], enabled: true },
            {
              onSuccess: () => {
                setUrl('');
                setEvents([]);
              },
            },
          );
        }}
      >
        <div className="flex items-end gap-2">
          <Field label="Endpoint URL">
            <input
              className={`${inputClass} w-96`}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/crm-hook"
              required
            />
          </Field>
          <Button type="submit" disabled={create.isPending}>
            Add webhook
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {webhookEventTypes.map((event) => (
            <label key={event} className="flex items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={events.includes(event)}
                onChange={(e) =>
                  setEvents((prev) => (e.target.checked ? [...prev, event] : prev.filter((x) => x !== event)))
                }
              />
              {event}
            </label>
          ))}
          <span className="text-xs text-gray-400">(none checked = all events)</span>
        </div>
      </form>
      <ErrorNote error={create.error ?? update.error ?? remove.error} />
    </Card>
  );
}

function DeliveryList(props: { webhookId: string }) {
  const { data } = useWebhookDeliveries(props.webhookId);
  return (
    <ul className="mt-2 space-y-1 rounded border border-gray-100 bg-gray-50 p-2">
      {data?.deliveries.map((d) => (
        <li key={d.id} className="text-xs text-gray-600">
          <span className={d.status === 'delivered' ? 'font-medium text-green-700' : 'font-medium text-red-700'}>
            {d.status}
          </span>
          {' · '}
          {d.event}
          {d.statusCode ? ` · HTTP ${d.statusCode}` : ''}
          {d.error ? ` · ${d.error}` : ''}
          {' · '}
          {new Date(d.createdAt).toLocaleString()}
        </li>
      ))}
      {data && data.deliveries.length === 0 ? (
        <li className="text-xs text-gray-500">No deliveries yet.</li>
      ) : null}
    </ul>
  );
}

function ImportExportCard() {
  const importCsv = useImportCsv();
  const [entityType, setEntityType] = useState<ImportEntityType>('contact');
  const [csv, setCsv] = useState('');

  return (
    <Card title="Import / export">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Import CSV</h3>
          <div className="mb-2 flex items-end gap-2">
            <Field label="Entity">
              <select
                className={inputClass}
                value={entityType}
                onChange={(e) => setEntityType(e.target.value as ImportEntityType)}
              >
                <option value="contact">Contacts</option>
                <option value="account">Accounts</option>
                <option value="lead">Leads</option>
              </select>
            </Field>
            <Button
              disabled={importCsv.isPending || csv.trim() === ''}
              onClick={() => importCsv.mutate({ entityType, csv })}
            >
              Import
            </Button>
          </div>
          <textarea
            className={`${inputClass} h-32 font-mono text-xs`}
            placeholder={'firstName,lastName,email\nAda,Lovelace,ada@example.com'}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
          />
          {importCsv.data ? (
            <div className="mt-1 text-xs text-gray-600">
              <p className="text-green-700">{importCsv.data.created} created</p>
              {importCsv.data.skipped.map((s) => (
                <p key={s.row} className="text-amber-700">
                  row {s.row}: {s.reason}
                </p>
              ))}
            </div>
          ) : null}
          <ErrorNote error={importCsv.error} />
        </div>
        <div>
          <h3 className="mb-1 text-sm font-semibold text-gray-700">Export CSV</h3>
          <div className="flex flex-wrap gap-2">
            {(['account', 'contact', 'deal', 'lead', 'project'] as const).map((t) => (
              <a
                key={t}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                href={`/api/export/${t}`}
                download
              >
                {t}s.csv
              </a>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function IntegrationsPage() {
  const { data } = useIntegrations();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Integrations</h1>

      <Card title="Chat notifications">
        <ChatIntegrationRow kind="slack" label="Slack" />
        <ChatIntegrationRow kind="teams" label="Microsoft Teams" />
        <p className="mt-1 text-xs text-gray-500">
          Workflows can post here via the "Post to Slack/Teams" action.
        </p>
      </Card>

      <ApiKeysCard />
      <WebhooksCard />
      <ImportExportCard />

      <Card title="Data enrichment">
        <p className="text-sm text-gray-700">
          Provider: <strong>{data?.enrichmentProvider ?? '…'}</strong>
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Use the ✨ Enrich button on account and contact pages. Enrichment fills empty fields only and
          suggests LinkedIn profiles; swap in a live provider (Clearbit, Apollo, People Data Labs) by
          implementing the same provider interface.
        </p>
      </Card>
    </div>
  );
}
