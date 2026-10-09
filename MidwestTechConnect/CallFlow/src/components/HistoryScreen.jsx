import { PhoneCall, Trash2 } from 'lucide-react';
import { formatDuration, formatRelative } from '../lib/format.js';

export default function HistoryScreen({ records, onOpen, onSearch, onClear }) {
  function confirmClear() {
    if (window.confirm('Clear all call history? This cannot be undone.')) onClear();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Call History</h1>
        {records.length > 0 && (
          <button
            type="button"
            className="tap inline-flex items-center gap-2 px-3 rounded-lg text-sm text-muted hover:text-danger hover:bg-page"
            onClick={confirmClear}
          >
            <Trash2 size={16} aria-hidden="true" />
            Clear history
          </button>
        )}
      </div>

      {records.length === 0 ? (
        <div className="card p-10 text-center space-y-4">
          <PhoneCall size={40} className="mx-auto text-muted" aria-hidden="true" />
          <p className="text-lg text-muted">No calls yet.</p>
          <button type="button" className="btn-primary !w-auto mx-auto" onClick={onSearch}>
            Find a business
          </button>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-page text-sm text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Business</th>
                <th scope="col" className="px-4 py-3 font-medium">Time</th>
                <th scope="col" className="px-4 py-3 font-medium">Duration</th>
                <th scope="col" className="px-4 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open notes for ${r.businessName}`}
                  onClick={() => onOpen(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(r);
                    }
                  }}
                  className="border-t border-line cursor-pointer hover:bg-page focus:outline-none focus-visible:bg-blue-50"
                >
                  <td className="px-4 py-4 font-semibold">{r.businessName}</td>
                  <td className="px-4 py-4 text-muted whitespace-nowrap">{formatRelative(r.startedAt)}</td>
                  <td className="px-4 py-4 timer">{formatDuration(r.durationSeconds)}</td>
                  <td className="px-4 py-4">
                    {r.outcome ? (
                      <span className="inline-block rounded-full bg-blue-50 text-primary text-sm font-medium px-3 py-1">
                        {r.outcome}
                      </span>
                    ) : (
                      <span className="text-muted">&mdash;</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
