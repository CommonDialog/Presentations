import { useState, type DragEvent, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { BoardColumnDto, DealDto } from '@crm/shared';
import { useAccounts } from '../api/hooks.js';
import { useBoard, useCreateDeal, useForecast, useMoveDeal } from '../api/pipelineHooks.js';
import { Button, Card, ErrorNote, Field, inputClass } from '../components/ui.js';

function fmtMoney(n: number | null): string {
  if (n === null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function BoardPage() {
  const { data: board, isLoading } = useBoard();
  const { data: forecast } = useForecast();
  const move = useMoveDeal();
  const [showCreate, setShowCreate] = useState(false);
  const [pendingLoss, setPendingLoss] = useState<{ deal: DealDto; stageId: string } | null>(null);
  const [lossReason, setLossReason] = useState('');

  const onDrop = (e: DragEvent, column: BoardColumnDto) => {
    e.preventDefault();
    const dealId = e.dataTransfer.getData('text/deal-id');
    if (!dealId || !board) return;
    const deal = board.columns.flatMap((c) => c.deals).find((d) => d.id === dealId);
    if (!deal || deal.stageId === column.stage.id) return;
    if (column.stage.isLost) {
      setPendingLoss({ deal, stageId: column.stage.id });
      setLossReason('');
      return;
    }
    move.mutate({ id: dealId, stageId: column.stage.id });
  };

  const confirmLoss = () => {
    if (!pendingLoss || !lossReason.trim()) return;
    move.mutate({ id: pendingLoss.deal.id, stageId: pendingLoss.stageId, winLossReason: lossReason.trim() });
    setPendingLoss(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">
          Pipeline{board ? ` — ${board.pipeline.name}` : ''}
        </h1>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Close' : 'New deal'}</Button>
      </div>

      {forecast ? (
        <div className="flex flex-wrap gap-4 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-sm" data-testid="forecast">
          <span>
            Open: <strong>{forecast.openCount}</strong> deals · {fmtMoney(forecast.openAmount)}
          </span>
          <span>
            Weighted forecast: <strong>{fmtMoney(forecast.weightedForecast)}</strong>
          </span>
          <span className="text-emerald-700">
            Won: {forecast.wonCount} · {fmtMoney(forecast.wonAmount)}
          </span>
          <span className="text-gray-500">Lost: {forecast.lostCount}</span>
        </div>
      ) : null}

      {showCreate ? <CreateDealForm onDone={() => setShowCreate(false)} /> : null}
      <ErrorNote error={move.error} />
      {isLoading ? <p className="text-sm text-gray-500">Loading…</p> : null}

      {pendingLoss ? (
        <Card title={`Mark "${pendingLoss.deal.name}" as lost`}>
          <div className="flex items-end gap-2">
            <Field label="Loss reason (required)">
              <input
                className={inputClass}
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                autoFocus
              />
            </Field>
            <Button onClick={confirmLoss} disabled={!lossReason.trim()}>
              Confirm loss
            </Button>
            <Button variant="secondary" onClick={() => setPendingLoss(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      ) : null}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {board?.columns.map((column) => (
          <div
            key={column.stage.id}
            className="min-w-56 flex-1 rounded-lg bg-gray-200/70 p-2"
            data-testid={`column-${column.stage.name}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop(e, column)}
          >
            <div className="mb-2 px-1">
              <p className="text-sm font-semibold text-gray-700">
                {column.stage.name}
                <span className="ml-1 font-normal text-gray-500">({column.deals.length})</span>
              </p>
              <p className="text-xs text-gray-500">
                {fmtMoney(column.totalAmount)} · wt {fmtMoney(column.weightedAmount)}
              </p>
            </div>
            <div className="space-y-2">
              {column.deals.map((deal) => (
                <div
                  key={deal.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/deal-id', deal.id)}
                  className="cursor-grab rounded border border-gray-200 bg-white p-2 shadow-sm active:cursor-grabbing"
                >
                  <Link className="text-sm font-medium text-blue-700 hover:underline" to={`/deals/${deal.id}`}>
                    {deal.name}
                  </Link>
                  <p className="text-xs text-gray-600">{deal.accountName}</p>
                  <p className="text-xs text-gray-500">
                    {fmtMoney(deal.amount)} · {deal.effectiveProbability}%
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreateDealForm(props: { onDone: () => void }) {
  const create = useCreateDeal();
  const accounts = useAccounts({ page: 1 });
  const [form, setForm] = useState({ name: '', accountId: '', amount: '', expectedCloseDate: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.accountId) return;
    await create.mutateAsync({
      name: form.name,
      accountId: form.accountId,
      ...(form.amount ? { amount: Number(form.amount) } : {}),
      ...(form.expectedCloseDate ? { expectedCloseDate: form.expectedCloseDate } : {}),
    });
    props.onDone();
  };

  return (
    <Card title="New deal">
      <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
        <Field label="Deal name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            required
          />
        </Field>
        <Field label="Account">
          <select
            className={inputClass}
            value={form.accountId}
            onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
            required
          >
            <option value="">— choose —</option>
            {accounts.data?.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount">
          <input
            className={inputClass}
            type="number"
            min="0"
            value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          />
        </Field>
        <Field label="Expected close date">
          <input
            className={inputClass}
            type="date"
            value={form.expectedCloseDate}
            onChange={(e) => setForm((f) => ({ ...f, expectedCloseDate: e.target.value }))}
          />
        </Field>
        <div className="col-span-2">
          <Button type="submit" disabled={create.isPending}>
            Create deal
          </Button>
          <ErrorNote error={create.error} />
        </div>
      </form>
    </Card>
  );
}
