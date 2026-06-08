import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateRoomSchema, type RoomDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { Modal } from './Modal.js';

export function RoomManagement({ canManage }: { canManage: boolean }) {
  const [rooms, setRooms] = useState<RoomDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRooms(await api.listRooms());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(id: string) {
    if (!window.confirm('Lokaal verwijderen? Lessen behouden hun andere gegevens.')) return;
    try {
      await api.deleteRoom(id);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Lokalen</h2>
        {canManage && (
          <button type="button" onClick={() => setOpen(true)}>
            + Lokaal toevoegen
          </button>
        )}
      </div>
      <p className="muted">
        Koppel een lokaal aan een les om te zien wat er per lokaal gepland is.
      </p>

      {error && <p className="error">{error}</p>}
      {!rooms && <p className="muted">Laden…</p>}
      {rooms && rooms.length === 0 && <p className="muted">Nog geen lokalen ingevoerd.</p>}
      {rooms && rooms.length > 0 && (
        <ul className="material-list">
          {rooms.map((r) => (
            <li key={r.id}>
              <strong>{r.name}</strong>
              {canManage && (
                <button type="button" className="linkbtn danger" onClick={() => remove(r.id)}>
                  Verwijderen
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <Modal title="Lokaal toevoegen" onClose={() => setOpen(false)}>
          <RoomForm
            onCreated={() => {
              setOpen(false);
              void refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function RoomForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateRoomSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de naam');
      return;
    }
    setBusy(true);
    try {
      await api.createRoom(parsed.data.name);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="room-name">Naam lokaal (bijv. &ldquo;Studio 2&rdquo;)</label>
      <input id="room-name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Lokaal toevoegen'}
      </button>
    </form>
  );
}
