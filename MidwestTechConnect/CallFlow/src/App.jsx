import { useCallback, useEffect, useRef, useState } from 'react';
import { History as HistoryIcon, Search as SearchIcon } from 'lucide-react';
import SearchScreen from './components/SearchScreen.jsx';
import BusinessDetail from './components/BusinessDetail.jsx';
import ActiveCall from './components/ActiveCall.jsx';
import CallComplete from './components/CallComplete.jsx';
import HistoryScreen from './components/HistoryScreen.jsx';
import NoteDetail from './components/NoteDetail.jsx';
import { loadHistory, saveHistory } from './lib/storage.js';
import { searchBusinesses } from './data/businesses.js';

// Simulated ring time before the stub reports "Call Connected".
const DIAL_DELAY_MS = 1800;

export default function App() {
  const [screen, setScreen] = useState('search'); // search | detail | call | complete | history | note
  const [business, setBusiness] = useState(null);
  const [history, setHistory] = useState(() => loadHistory());
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [lastRecord, setLastRecord] = useState(null);

  // Search state lives here so "Back to results" keeps the list.
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = not searched yet

  // Call state machine: idle | dialing | connected | ended
  const [callState, setCallState] = useState('idle');
  const [seconds, setSeconds] = useState(0);
  const [notes, setNotes] = useState('');
  const [outcome, setOutcome] = useState(null);
  const startedAtRef = useRef(null);
  const dialTimerRef = useRef(null);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  // Tick the timer only while connected.
  useEffect(() => {
    if (callState !== 'connected') return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [callState]);

  useEffect(() => () => clearTimeout(dialTimerRef.current), []);

  function runSearch(text) {
    setQuery(text);
    setResults(searchBusinesses(text));
  }

  function clearAllHistory() {
    setHistory([]);
  }

  function openBusiness(b) {
    setBusiness(b);
    setScreen('detail');
  }

  function startCall(b) {
    if (callState !== 'idle') return; // guard against double-tap
    setBusiness(b);
    setNotes('');
    setOutcome(null);
    setSeconds(0);
    startedAtRef.current = new Date().toISOString();
    setCallState('dialing');
    setScreen('call');
    dialTimerRef.current = setTimeout(() => setCallState('connected'), DIAL_DELAY_MS);
  }

  function endCall() {
    clearTimeout(dialTimerRef.current);
    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      businessId: business.id,
      businessName: business.name,
      phone: business.phone,
      startedAt: startedAtRef.current,
      durationSeconds: seconds,
      outcome,
      notes: notes.trim(),
    };
    setHistory((h) => [record, ...h]);
    setLastRecord(record);
    setCallState('ended');
    setScreen('complete');
  }

  const finishComplete = useCallback(() => {
    setCallState('idle');
    setScreen('history');
  }, []);

  function openRecord(r) {
    setSelectedRecord(r);
    setScreen('note');
  }

  const inCall = screen === 'call';

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-surface border-b border-line">
        <div className="max-w-2xl mx-auto px-4 h-16 flex items-center justify-between">
          <button
            type="button"
            className="text-xl font-bold tracking-tight tap px-2 -ml-2 rounded-lg hover:bg-page disabled:opacity-60 disabled:hover:bg-transparent"
            onClick={() => setScreen('search')}
            disabled={inCall}
            aria-label="Call Flow home"
          >
            Call Flow
          </button>
          <nav className="flex items-center gap-1" aria-label="Primary">
            <button
              type="button"
              className={`tap px-3 rounded-lg inline-flex items-center gap-2 text-sm font-medium hover:bg-page disabled:opacity-40 ${
                screen === 'search' ? 'text-primary' : 'text-muted'
              }`}
              onClick={() => setScreen('search')}
              disabled={inCall}
            >
              <SearchIcon size={18} aria-hidden="true" />
              Search
            </button>
            <button
              type="button"
              className={`tap px-3 rounded-lg inline-flex items-center gap-2 text-sm font-medium hover:bg-page disabled:opacity-40 ${
                screen === 'history' || screen === 'note' ? 'text-primary' : 'text-muted'
              }`}
              onClick={() => setScreen('history')}
              disabled={inCall}
            >
              <HistoryIcon size={18} aria-hidden="true" />
              History
              {history.length > 0 && (
                <span className="ml-1 rounded-full bg-primary text-white text-xs px-2 py-0.5 leading-none">
                  {history.length}
                </span>
              )}
            </button>
          </nav>
        </div>
      </header>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6">
        {screen === 'search' && (
          <SearchScreen
            query={query}
            results={results}
            onQueryChange={setQuery}
            onSearch={runSearch}
            onSelect={openBusiness}
            onCall={startCall}
          />
        )}

        {screen === 'detail' && business && (
          <BusinessDetail business={business} onBack={() => setScreen('search')} onCall={startCall} />
        )}

        {screen === 'call' && business && (
          <ActiveCall
            business={business}
            callState={callState}
            seconds={seconds}
            notes={notes}
            onNotesChange={setNotes}
            outcome={outcome}
            onOutcomeChange={setOutcome}
            onEnd={endCall}
          />
        )}

        {screen === 'complete' && lastRecord && (
          <CallComplete record={lastRecord} onDone={finishComplete} />
        )}

        {screen === 'history' && (
          <HistoryScreen
            records={history}
            onOpen={openRecord}
            onSearch={() => setScreen('search')}
            onClear={clearAllHistory}
          />
        )}

        {screen === 'note' && selectedRecord && (
          <NoteDetail record={selectedRecord} onBack={() => setScreen('history')} />
        )}
      </main>
    </div>
  );
}
