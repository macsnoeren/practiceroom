export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('nl-NL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateRange(startsOn: string, endsOn: string): string {
  const f = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString('nl-NL', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  return startsOn === endsOn ? f(startsOn) : `${f(startsOn)} – ${f(endsOn)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
