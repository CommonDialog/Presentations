import { ArrowLeft } from 'lucide-react';
import { formatDuration, formatFull } from '../lib/format.js';

export default function NoteDetail({ record, onBack }) {
  return (
    <div className="space-y-6">
      <button type="button" className="btn-outline !w-auto" onClick={onBack}>
        <ArrowLeft size={18} aria-hidden="true" />
        Back to history
      </button>

      <div className="card p-8 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{record.businessName}</h1>
          <p className="text-muted">{record.phone}</p>
        </div>

        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted">When</dt>
            <dd className="m-0 font-medium">{formatFull(record.startedAt)}</dd>
          </div>
          <div>
            <dt className="text-muted">Duration</dt>
            <dd className="m-0 font-medium timer">{formatDuration(record.durationSeconds)}</dd>
          </div>
          <div>
            <dt className="text-muted">Outcome</dt>
            <dd className="m-0 font-medium">{record.outcome ?? 'None'}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Call Notes</h2>
          {record.notes ? (
            <p className="whitespace-pre-wrap text-lg leading-relaxed">{record.notes}</p>
          ) : (
            <p className="text-muted italic">No notes were taken on this call.</p>
          )}
        </div>
      </div>
    </div>
  );
}
