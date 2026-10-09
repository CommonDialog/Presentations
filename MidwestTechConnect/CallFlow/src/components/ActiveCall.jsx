import { Phone, PhoneOff } from 'lucide-react';
import { formatClock } from '../lib/format.js';

export const OUTCOMES = ['Interested', 'Follow Up', 'No Answer', 'Not Interested', 'Completed'];

export default function ActiveCall({
  business,
  callState,
  seconds,
  notes,
  onNotesChange,
  outcome,
  onOutcomeChange,
  onEnd,
}) {
  const dialing = callState === 'dialing';

  return (
    <div className="space-y-5">
      <section className="card p-6 text-center space-y-3" aria-live="polite">
        <div
          className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center text-white ${
            dialing ? 'bg-primary animate-pulse' : 'bg-green-600'
          }`}
        >
          <Phone size={28} aria-hidden="true" />
        </div>

        {dialing ? (
          <>
            <p className="text-2xl font-semibold">Calling {business.name}...</p>
            <p className="text-muted">{business.phone}</p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold uppercase tracking-wide text-green-700">Call Connected</p>
            <p className="text-xl font-semibold">{business.name}</p>
            <p className="timer text-5xl font-bold" data-testid="call-timer">
              {formatClock(seconds)}
            </p>
          </>
        )}
      </section>

      <section className="card p-5 space-y-4">
        <label htmlFor="call-notes" className="block text-lg font-semibold">
          Call Notes
        </label>
        <textarea
          id="call-notes"
          rows={6}
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="Spoke with Susan. They can come Tuesday afternoon. Estimate is $175."
          className="w-full rounded-xl border-2 border-line bg-surface p-4 text-lg leading-relaxed resize-y
                     focus:outline-none focus:border-primary focus-visible:ring-4 focus-visible:ring-blue-200"
        />

        <div className="space-y-2">
          <p className="text-sm font-medium text-muted">Outcome</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Call outcome">
            {OUTCOMES.map((o) => {
              const active = outcome === o;
              return (
                <button
                  key={o}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`pill ${active ? 'pill-active' : ''}`}
                  onClick={() => onOutcomeChange(active ? null : o)}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <button type="button" className="btn-danger text-xl py-5" onClick={onEnd}>
        <PhoneOff size={24} aria-hidden="true" />
        End Call
      </button>
    </div>
  );
}
