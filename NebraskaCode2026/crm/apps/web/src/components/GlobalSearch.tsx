import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { SearchEntityType, SearchResultDto } from '@crm/shared';
import { useAskSearch, useGlobalSearch } from '../api/searchHooks.js';

const typeLabels: Record<SearchEntityType, string> = {
  account: 'Accounts',
  contact: 'Contacts',
  deal: 'Deals',
  project: 'Projects',
  activity: 'Activities',
  email: 'Emails',
  document: 'Documents',
  ai_summary: 'AI summaries',
};

const typeOrder: SearchEntityType[] = [
  'account',
  'contact',
  'deal',
  'project',
  'activity',
  'email',
  'document',
  'ai_summary',
];

function groupResults(results: SearchResultDto[]): [SearchEntityType, SearchResultDto[]][] {
  return typeOrder
    .map((type): [SearchEntityType, SearchResultDto[]] => [
      type,
      results.filter((r) => r.type === type),
    ])
    .filter(([, rows]) => rows.length > 0);
}

export function GlobalSearch() {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const search = useGlobalSearch(debounced);
  const ask = useAskSearch();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text), 250);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const askResult = ask.data;
  const showAsk = askResult && ask.variables === text;
  const results = showAsk ? askResult.results : (search.data?.results ?? []);
  const grouped = groupResults(results);

  function openResult(result: SearchResultDto) {
    setOpen(false);
    setText('');
    ask.reset();
    if (result.url) navigate(result.url);
  }

  return (
    <div className="relative" ref={containerRef}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim().length >= 2) {
            ask.mutate(text);
            setOpen(true);
          }
        }}
      >
        <input
          className="w-64 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          placeholder="Search… (Enter asks AI)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            ask.reset();
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </form>

      {open && (text.trim().length >= 2 || ask.isPending) ? (
        <div className="absolute right-0 z-20 mt-1 max-h-[70vh] w-[28rem] overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {ask.isPending ? (
            <p className="px-3 py-2 text-sm text-gray-500">Asking AI…</p>
          ) : null}
          {showAsk ? (
            <p className="border-b border-gray-100 bg-blue-50 px-3 py-2 text-xs text-blue-900">
              {askResult.interpretation.summary}
            </p>
          ) : null}

          {grouped.map(([type, rows]) => (
            <div key={type}>
              <p className="bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                {typeLabels[type]}
              </p>
              <ul>
                {rows.map((result) => (
                  <li key={`${result.type}:${result.id}`}>
                    <button
                      type="button"
                      className="block w-full px-3 py-1.5 text-left hover:bg-gray-50"
                      onClick={() => openResult(result)}
                    >
                      <span className="block truncate text-sm font-medium text-gray-900">
                        {result.title}
                      </span>
                      {result.meta ? (
                        <span className="block truncate text-xs text-gray-500">{result.meta}</span>
                      ) : null}
                      {result.snippet ? (
                        <span className="block truncate text-xs text-gray-400">{result.snippet}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {showAsk && askResult.related.length > 0 ? (
            <div>
              <p className="bg-gray-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Related knowledge
              </p>
              <ul>
                {askResult.related.map((hit) => (
                  <li key={`${hit.entityType}:${hit.entityId}`} className="px-3 py-1.5">
                    <span className="block truncate text-xs text-gray-600">{hit.content}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!ask.isPending && grouped.length === 0 && (search.data || showAsk) ? (
            <p className="px-3 py-3 text-center text-sm text-gray-500">No matches.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
