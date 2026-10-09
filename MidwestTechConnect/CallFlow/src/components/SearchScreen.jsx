import { MapPin, Phone, Search as SearchIcon } from 'lucide-react';
import { CATEGORIES, categoryLabel } from '../data/businesses.js';

export default function SearchScreen({ query, results, onQueryChange, onSearch, onSelect, onCall }) {
  function submit(e) {
    e.preventDefault();
    onSearch(query);
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="business-search" className="block text-2xl font-bold tracking-tight">
          What kind of business are you looking for?
        </label>
        <div className="flex gap-2">
          <input
            id="business-search"
            type="search"
            autoComplete="off"
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Plumber, pizza, dentist..."
            className="tap flex-1 rounded-xl border-2 border-line bg-surface px-4 text-lg
                       focus:outline-none focus:border-primary focus-visible:ring-4 focus-visible:ring-blue-200"
          />
          <button type="submit" className="btn-primary !w-auto px-5" aria-label="Search">
            <SearchIcon size={22} aria-hidden="true" />
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick searches">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`pill ${query === cat ? 'pill-active' : ''}`}
              onClick={() => onSearch(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </form>

      {results && results.length === 0 && (
        <p className="text-muted text-center py-10">
          No businesses found for &ldquo;{query}&rdquo;. Try one of the quick searches above.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="space-y-3" aria-label="Search results">
          {results.map((b) => (
            <li key={b.id} className="card p-4 flex items-center gap-4">
              <button
                type="button"
                className="flex-1 text-left tap rounded-lg -m-2 p-2 hover:bg-page focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200"
                onClick={() => onSelect(b)}
              >
                <div className="font-semibold text-lg leading-tight">{b.name}</div>
                <div className="text-sm text-muted">{categoryLabel(b.category)}</div>
                <div className="mt-1 text-sm flex flex-wrap gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1">
                    <Phone size={14} aria-hidden="true" />
                    {b.phone}
                  </span>
                  <span className="inline-flex items-center gap-1 text-muted">
                    <MapPin size={14} aria-hidden="true" />
                    {b.location}
                  </span>
                </div>
              </button>
              <button
                type="button"
                className="btn-primary !w-auto px-4 py-3 text-base"
                onClick={() => onCall(b)}
                aria-label={`Call ${b.name}`}
              >
                <Phone size={20} aria-hidden="true" />
                Call
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
