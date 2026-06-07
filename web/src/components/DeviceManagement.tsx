import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateDeviceSchema, type DeviceDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { usePresence } from '../usePresence.js';

interface ActiveCode {
  deviceId: string;
  code: string;
  expiresAt: string;
}

export function DeviceManagement() {
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<ActiveCode | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const { online, statuses, startRecording, stopRecording } = usePresence();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setDevices(await api.listDevices());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function addDevice(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateDeviceSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de naam');
      return;
    }
    setBusy(true);
    try {
      const result = await api.createDevice(parsed.data.name);
      setActiveCode({
        deviceId: result.device.id,
        code: result.pairingCode,
        expiresAt: result.pairingExpiresAt,
      });
      setName('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function regenerate(id: string) {
    setError(null);
    try {
      const result = await api.regeneratePairingCode(id);
      setActiveCode({ deviceId: id, code: result.pairingCode, expiresAt: result.pairingExpiresAt });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Koppelcode genereren mislukt');
    }
  }

  async function revoke(id: string) {
    if (!window.confirm('Koppeling intrekken? Het apparaat moet daarna opnieuw koppelen.')) return;
    try {
      await api.revokeDevice(id);
      if (activeCode?.deviceId === id) setActiveCode(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Intrekken mislukt');
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Apparaat definitief verwijderen?')) return;
    try {
      await api.deleteDevice(id);
      if (activeCode?.deviceId === id) setActiveCode(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <h2>Camera's & microfoons</h2>
      <p className="muted">
        Registreer een apparaat, open daarna de camera-app en voer de koppelcode in.
      </p>

      <form onSubmit={addDevice}>
        <label htmlFor="dev-name">Naam apparaat (bijv. "Lokaal 1 — voorkant")</label>
        <input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Apparaat toevoegen'}
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {activeCode && (
        <div className="codebox">
          <div className="muted">Koppelcode (open de camera-app en voer deze in):</div>
          <div className="code">{activeCode.code}</div>
          <div className="muted">
            Geldig tot {new Date(activeCode.expiresAt).toLocaleTimeString()}. Camera-app:{' '}
            <code>http://localhost:5174</code>
          </div>
        </div>
      )}

      {!devices && !error && <p className="muted">Laden…</p>}
      {devices && devices.length === 0 && <p className="muted">Nog geen apparaten.</p>}
      {devices && devices.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>Status</th>
              <th>Live</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => {
              const isOnline = online.has(d.id);
              const state = statuses[d.id];
              return (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>
                    {d.paired ? (
                      <span className="tag tag-ok">gekoppeld</span>
                    ) : (
                      <span className="tag">niet gekoppeld</span>
                    )}
                  </td>
                  <td>
                    {isOnline ? (
                      <span className="tag tag-ok">● online{state ? ` (${state})` : ''}</span>
                    ) : (
                      <span className="tag">offline</span>
                    )}
                  </td>
                  <td className="actions">
                    {isOnline && (
                      <>
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => startRecording([d.id])}
                        >
                          Start (test)
                        </button>
                        <button
                          type="button"
                          className="linkbtn"
                          onClick={() => stopRecording([d.id])}
                        >
                          Stop (test)
                        </button>
                      </>
                    )}
                    {!d.paired && (
                      <button type="button" className="linkbtn" onClick={() => regenerate(d.id)}>
                        Koppelcode
                      </button>
                    )}
                    {d.paired && (
                      <button type="button" className="linkbtn" onClick={() => revoke(d.id)}>
                        Intrekken
                      </button>
                    )}
                    <button type="button" className="linkbtn danger" onClick={() => remove(d.id)}>
                      Verwijderen
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
