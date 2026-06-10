import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { BrandingSlot, SchoolSettingsDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes } from '../format.js';

/** Admin settings: the intro/outro clip and watermark text applied to every
 * combined lesson video. */
export function SettingsManagement() {
  const [settings, setSettings] = useState<SchoolSettingsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSettings(await api.getSettings());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <p className="error">{error}</p>;
  if (!settings) return <p className="muted">Laden…</p>;

  return (
    <>
      <div className="card">
        <h2>Watermerk op de video</h2>
        <p className="muted">
          Deze tekst wordt over elke samengestelde lesvideo getoond, bijv. een melding dat de video
          niet verspreid mag worden.
        </p>
        <OverlayForm settings={settings} onSaved={setSettings} />
      </div>

      <div className="card">
        <h2>Intro- en outrovideo</h2>
        <p className="muted">
          Optioneel: een korte video die vóór (intro) en ná (outro) elke lesvideo wordt geplakt.
        </p>
        <BrandingSlotRow slot="intro" label="Intro" settings={settings} onChange={setSettings} />
        <BrandingSlotRow slot="outro" label="Outro" settings={settings} onChange={setSettings} />
        <p className="muted">
          Nieuwe lesvideo&rsquo;s gebruiken deze instellingen; al samengestelde video&rsquo;s
          veranderen niet.
        </p>
      </div>
    </>
  );
}

function OverlayForm({
  settings,
  onSaved,
}: {
  settings: SchoolSettingsDto;
  onSaved: (s: SchoolSettingsDto) => void;
}) {
  const [text, setText] = useState(settings.overlayText ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus('saving');
    try {
      onSaved(await api.updateSettings({ overlayText: text.trim() || null }));
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="overlay">Watermerktekst (max. 200 tekens)</label>
      <input
        id="overlay"
        value={text}
        maxLength={200}
        placeholder="Bijv. Niet verspreiden — eigendom van …"
        onChange={(e) => {
          setText(e.target.value);
          setStatus('idle');
        }}
      />
      <button type="submit" disabled={status === 'saving'}>
        {status === 'saving' ? 'Opslaan…' : 'Opslaan'}
      </button>
      {status === 'saved' && <span className="success"> Opgeslagen.</span>}
      {status === 'error' && <span className="error"> Opslaan mislukt.</span>}
    </form>
  );
}

function BrandingSlotRow({
  slot,
  label,
  settings,
  onChange,
}: {
  slot: BrandingSlot;
  label: string;
  settings: SchoolSettingsDto;
  onChange: (s: SchoolSettingsDto) => void;
}) {
  const clip = settings[slot];
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setProgress(0);
    try {
      onChange(await api.uploadBranding(slot, file, setProgress));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uploaden mislukt');
    } finally {
      setProgress(null);
    }
  }

  async function remove() {
    setError(null);
    try {
      onChange(await api.deleteBranding(slot));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="branding-row">
      <div className="row">
        <strong>{label}</strong>
        {clip ? (
          <span className="tag tag-ok">ingesteld · {formatBytes(clip.sizeBytes)}</span>
        ) : (
          <span className="tag">geen</span>
        )}
      </div>
      <div className="row">
        <input
          type="file"
          accept="video/*"
          disabled={progress !== null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {clip && (
          <button type="button" className="linkbtn danger" onClick={() => void remove()}>
            Verwijderen
          </button>
        )}
      </div>
      {progress !== null && <p className="muted">Uploaden… {progress}%</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
