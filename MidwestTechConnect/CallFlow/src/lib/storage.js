const KEY = 'callflow.history.v1';

export function loadHistory() {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistory(records) {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // Storage blocked or full. The in-memory list still works for the session.
  }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
