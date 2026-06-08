import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateHolidaySchema, type HolidayDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatDateRange } from '../format.js';

export function HolidayManagement() {
  const [holidays, setHolidays] = useState<HolidayDto[] | null>(null);
  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setHolidays(await api.listHolidays());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateHolidaySchema.safeParse({ name, startsOn, endsOn: endsOn || startsOn });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de gegevens');
      return;
    }
    setBusy(true);
    try {
      await api.createHoliday(parsed.data);
      setName('');
      setStartsOn('');
      setEndsOn('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Vakantie verwijderen?')) return;
    try {
      await api.deleteHoliday(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <h2>Vakantie toevoegen</h2>
      <p className="muted">
        Wekelijks herhalende lessen slaan vakantieweken automatisch over. Studenten zien de
        vakanties bij hun planning.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="hol-name">Naam (bijv. &ldquo;Herfstvakantie&rdquo;)</label>
        <input id="hol-name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="date-grid">
          <div>
            <label htmlFor="hol-start">Van</label>
            <input
              id="hol-start"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="hol-end">Tot en met</label>
            <input
              id="hol-end"
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Vakantie toevoegen'}
        </button>
      </form>

      <h3>Geplande vakanties</h3>
      {!holidays && <p className="muted">Laden…</p>}
      {holidays && holidays.length === 0 && <p className="muted">Nog geen vakanties ingevoerd.</p>}
      {holidays && holidays.length > 0 && (
        <ul className="material-list">
          {holidays.map((h) => (
            <li key={h.id}>
              <div>
                <strong>{h.name}</strong>
                <div className="muted">{formatDateRange(h.startsOn, h.endsOn)}</div>
              </div>
              <button type="button" className="linkbtn danger" onClick={() => remove(h.id)}>
                Verwijderen
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
