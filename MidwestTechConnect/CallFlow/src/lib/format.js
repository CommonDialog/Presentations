export function pad(n) {
  return String(n).padStart(2, '0');
}

// Live timer: HH:MM:SS
export function formatClock(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

// History and confirmation: M:SS
export function formatDuration(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${pad(s)}`;
}

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function timeOfDay(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// "Today 2:14 PM", "Yesterday", or a short date.
export function formatRelative(iso, now = new Date()) {
  const d = new Date(iso);
  if (sameDay(d, now)) return `Today ${timeOfDay(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatFull(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
