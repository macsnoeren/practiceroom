import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateDeviceSchema, type DeviceDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { usePresence } from '../usePresence.js';
import { Modal } from './Modal.js';

interface PairingCode {
  code: string;
  expiresAt: string;
}

function CodeBox({ code, expiresAt }: PairingCode) {
  return (
    <div className="codebox">
      <div className="muted">Koppelcode (open de camera-app en voer deze in):</div>
      <div className="code">{code}</div>
      <div className="muted">
        Geldig tot {new Date(expiresAt).toLocaleTimeString()}. Camera-app:{' '}
        <code>http://localhost:5174</code>
      </div>
    </div>
  );
}

export function DeviceManagement() {
  const [devices, setDevices] = useState<DeviceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<(PairingCode & { deviceId: string }) | null>(null);
  const [open, setOpen] = useState(false);
  const { online, statuses } = usePresence();

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
      <div className="row">
        <h2>Camera&rsquo;s &amp; microfoons</h2>
        <button
          type="button"
          onClick={() => {
            setActiveCode(null);
            setOpen(true);
          }}
        >
          + Apparaat toevoegen
        </button>
      </div>

      {error && <p className="error">{error}</p>}

      {/* Pairing code shown after regenerating it for an existing device. */}
      {activeCode && <CodeBox code={activeCode.code} expiresAt={activeCode.expiresAt} />}

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

      {open && (
        <Modal title="Apparaat toevoegen" onClose={() => setOpen(false)}>
          <AddDeviceForm onCreated={refresh} />
        </Modal>
      )}
    </div>
  );
}

function AddDeviceForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [created, setCreated] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
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
      setCreated({ code: result.pairingCode, expiresAt: result.pairingExpiresAt });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  // After creation, show the pairing code to enter in the camera app.
  if (created) {
    return (
      <div>
        <p className="muted">Apparaat toegevoegd. Open de camera-app en voer deze koppelcode in:</p>
        <CodeBox code={created.code} expiresAt={created.expiresAt} />
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="dev-name">Naam apparaat (bijv. &ldquo;Lokaal 1 — voorkant&rdquo;)</label>
      <input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Apparaat toevoegen'}
      </button>
    </form>
  );
}
