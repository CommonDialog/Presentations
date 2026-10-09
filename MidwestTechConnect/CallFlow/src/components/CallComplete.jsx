import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { formatDuration } from '../lib/format.js';

// How long the confirmation sits on screen before routing to History.
const AUTO_ROUTE_MS = 2500;

export default function CallComplete({ record, onDone }) {
  useEffect(() => {
    const id = setTimeout(onDone, AUTO_ROUTE_MS);
    return () => clearTimeout(id);
  }, [onDone]);

  return (
    <div className="card p-10 text-center space-y-4" role="status" aria-live="polite">
      <CheckCircle2 size={56} className="mx-auto text-green-600" aria-hidden="true" />
      <p className="text-2xl font-semibold">
        Call completed &mdash; {formatDuration(record.durationSeconds)}
      </p>
      <p className="text-lg text-muted">Notes saved.</p>
      <p className="text-sm text-muted">{record.businessName}</p>
      <button type="button" className="btn-outline !w-auto mx-auto" onClick={onDone}>
        View History
      </button>
    </div>
  );
}
