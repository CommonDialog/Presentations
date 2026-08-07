import type { ReactNode } from 'react';
import type { Paginated } from '@crm/shared';

export function Field(props: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-gray-700">{props.label}</span>
      {props.children}
    </label>
  );
}

export const inputClass =
  'w-full rounded border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none';

export function Button(props: {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const styles = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700',
    secondary: 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
    danger: 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
  }[props.variant ?? 'primary'];
  return (
    <button
      type={props.type ?? 'button'}
      onClick={props.onClick}
      disabled={props.disabled}
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${styles}`}
    >
      {props.children}
    </button>
  );
}

export function ErrorNote(props: { error: unknown }) {
  if (!props.error) return null;
  const message = props.error instanceof Error ? props.error.message : String(props.error);
  return <p className="mt-2 text-sm text-red-600">{message}</p>;
}

export function Pager(props: {
  data: Paginated<unknown> | undefined;
  page: number;
  onPage: (p: number) => void;
}) {
  if (!props.data) return null;
  const pages = Math.max(1, Math.ceil(props.data.total / props.data.pageSize));
  return (
    <div className="mt-3 flex items-center gap-3 text-sm text-gray-600">
      <Button
        variant="secondary"
        disabled={props.page <= 1}
        onClick={() => props.onPage(props.page - 1)}
      >
        Prev
      </Button>
      <span>
        Page {props.page} of {pages} · {props.data.total} total
      </span>
      <Button
        variant="secondary"
        disabled={props.page >= pages}
        onClick={() => props.onPage(props.page + 1)}
      >
        Next
      </Button>
    </div>
  );
}

export function Card(props: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {props.title ? <h2 className="mb-3 text-base font-semibold text-gray-800">{props.title}</h2> : null}
      {props.children}
    </section>
  );
}
