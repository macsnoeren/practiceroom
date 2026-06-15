import { useEffect, useState, type FormEvent } from 'react';
import { PairDeviceSchema, type CropRect, type DeviceKind } from '@practiceroom/shared';
import { ApiError, cameraApi, clearToken, getToken, setToken } from './api.js';
import { CameraPreview } from './components/CameraPreview.js';
import { SpeakerView } from './components/SpeakerView.js';
import { useDeviceSocket } from './useDeviceSocket.js';
import { useFramePublisher } from './useFramePublisher.js';
import { useMicGain } from './useMicGain.js';
import { useMicLevel } from './useMicLevel.js';
import { useRecorder } from './useRecorder.js';

interface PairedDevice {
  id: string;
  name: string;
  kind: DeviceKind;
}

type State =
  | { kind: 'loading' }
  | { kind: 'unpaired' }
  | { kind: 'paired'; device: PairedDevice };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!getToken()) {
      setState({ kind: 'unpaired' });
      return;
    }
    cameraApi
      .me()
      .then((device) =>
        setState({ kind: 'paired', device: { id: device.id, name: device.name, kind: device.kind } }),
      )
      .catch(() => {
        clearToken();
        setState({ kind: 'unpaired' });
      });
  }, []);

  function unpair() {
    clearToken();
    setState({ kind: 'unpaired' });
  }

  const isSpeaker = state.kind === 'paired' && state.device.kind === 'speaker';

  return (
    <div className="container">
      <h1>PracticeRoom — {isSpeaker ? 'Speaker' : 'Camera'}</h1>

      {state.kind === 'loading' && <p className="muted">Laden…</p>}

      {state.kind === 'unpaired' && (
        <PairForm onPaired={(device) => setState({ kind: 'paired', device })} />
      )}

      {state.kind === 'paired' &&
        (isSpeaker ? (
          <SpeakerView device={state.device} onUnpair={unpair} />
        ) : (
          <PairedView device={state.device} onUnpair={unpair} />
        ))}
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
  const { connected, activeRecording, sendFrame, gainCommand, reportGain, reportLevel, reportCapturing } =
    useDeviceSocket();
  const [rawStream, setRawStream] = useState<MediaStream | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const gain = gainCommand ?? 1;
  const stream = useMicGain(rawStream, gain);
  const recorderState = useRecorder(stream, activeRecording, crop);
  useFramePublisher(stream, sendFrame, connected);
  useMicLevel(stream, reportLevel, connected);

  // Tell the control room which gain this camera is currently applying.
  useEffect(() => {
    if (connected) reportGain(gain);
  }, [connected, gain, reportGain]);

  const isRecording = recorderState === 'recording';

  // Report 'recording' to the server only once capture has actually begun.
  useEffect(() => {
    reportCapturing(isRecording);
  }, [isRecording, reportCapturing]);

  return (
    <>
      <div className="card row">
        <div>
          Gekoppeld als <strong>{device.name}</strong>
          <div className="muted">{connected ? '● verbonden met server' : '○ niet verbonden'}</div>
        </div>
        <button type="button" className="secondary" onClick={onUnpair} disabled={isRecording}>
          Ontkoppelen
        </button>
      </div>

      {isRecording && <div className="card recording">● Bezig met opnemen…</div>}
      {recorderState === 'finishing' && <div className="card">Opname afronden en uploaden…</div>}
      {recorderState === 'error' && (
        <div className="card recording">
          Opnemen mislukt — controleer of camera/microfoon-toegang is gegeven.
        </div>
      )}

      <div className="card">
        <CameraPreview onStream={setRawStream} onCrop={setCrop} disabled={isRecording} />
      </div>
    </>
  );
}

function PairForm({ onPaired }: { onPaired: (device: PairedDevice) => void }) {
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
      // The pair result has no kind; fetch it so a speaker shows the right UI.
      const me = await cameraApi.me().catch(() => null);
      onPaired({
        id: result.device.id,
        name: result.device.name,
        kind: me?.kind ?? 'camera',
      });
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
