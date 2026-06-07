import { useEffect, useState, type FormEvent } from 'react';
import { PairDeviceSchema } from '@practiceroom/shared';
import { ApiError, cameraApi, clearToken, getToken, setToken } from './api.js';
import { CameraPreview } from './components/CameraPreview.js';
import { useDeviceSocket } from './useDeviceSocket.js';

type State =
  | { kind: 'loading' }
  | { kind: 'unpaired' }
  | { kind: 'paired'; device: { id: string; name: string } };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!getToken()) {
      setState({ kind: 'unpaired' });
      return;
    }
    cameraApi
      .me()
      .then((device) => setState({ kind: 'paired', device: { id: device.id, name: device.name } }))
      .catch(() => {
        clearToken();
        setState({ kind: 'unpaired' });
      });
  }, []);

  function unpair() {
    clearToken();
    setState({ kind: 'unpaired' });
  }

  return (
    <div className="container">
      <h1>PracticeRoom — Camera</h1>

      {state.kind === 'loading' && <p className="muted">Laden…</p>}

      {state.kind === 'unpaired' && (
        <PairForm onPaired={(device) => setState({ kind: 'paired', device })} />
      )}

      {state.kind === 'paired' && <PairedView device={state.device} onUnpair={unpair} />}
    </div>
  );
}

function PairedView({
  device,
  onUnpair,
}: {
  device: { id: string; name: string };
  onUnpair: () => void;
}) {
  const { connected, recordingRequested } = useDeviceSocket();

  return (
    <>
      <div className="card row">
        <div>
          Gekoppeld als <strong>{device.name}</strong>
          <div className="muted">{connected ? '● verbonden met server' : '○ niet verbonden'}</div>
        </div>
        <button type="button" className="secondary" onClick={onUnpair}>
          Ontkoppelen
        </button>
      </div>

      {recordingRequested && (
        <div className="card recording">
          ● Opname gevraagd door de leraar. (Het daadwerkelijk opnemen volgt in een latere fase.)
        </div>
      )}

      <div className="card">
        <CameraPreview />
      </div>
    </>
  );
}

function PairForm({ onPaired }: { onPaired: (device: { id: string; name: string }) => void }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = PairDeviceSchema.safeParse({ pairingCode: code });
    if (!parsed.success) {
      setError('Voer een geldige koppelcode in.');
      return;
    }

    setBusy(true);
    try {
      const result = await cameraApi.pair(parsed.data.pairingCode);
      setToken(result.token);
      onPaired(result.device);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Koppelen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Apparaat koppelen</h2>
      <p className="muted">
        Vraag een beheerder/leraar om dit apparaat toe te voegen in het dashboard en voer de
        koppelcode hieronder in.
      </p>
      <form onSubmit={submit}>
        <label htmlFor="code">Koppelcode</label>
        <input
          id="code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          placeholder="bijv. K7P2QX"
        />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Koppelen'}
        </button>
      </form>
    </div>
  );
}
