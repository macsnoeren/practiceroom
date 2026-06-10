import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateLibraryItemSchema, type LibraryItemDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { formatBytes } from '../format.js';
import { Modal } from './Modal.js';
import { LibraryPlayer } from './LibraryPlayer.js';

/** The teacher's personal video library: upload files, save links, reuse them
 * later as extra lesson material. */
export function LibraryManagement() {
  const [items, setItems] = useState<LibraryItemDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'file' | 'link'>(null);
  const [editing, setEditing] = useState<LibraryItemDto | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.listLibrary());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(item: LibraryItemDto) {
    if (!confirm(`"${item.title}" verwijderen?`)) return;
    try {
      await api.deleteLibraryItem(item.id);
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Mijn videobibliotheek</h2>
        <div>
          <button type="button" onClick={() => setAdding('file')}>
            + Video uploaden
          </button>{' '}
          <button type="button" className="secondary" onClick={() => setAdding('link')}>
            + Link toevoegen
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {!items && !error && <p className="muted">Laden…</p>}
      {items && items.length === 0 && <p className="muted">Nog niets in je bibliotheek.</p>}

      {items && items.length > 0 && (
        <ul className="material-list">
          {items.map((item) => (
            <li key={item.id} className="material-item">
              <div className="material-body">
                <div>
                  <strong>{item.title}</strong>{' '}
                  <span className="tag">{item.kind === 'link' ? 'link' : 'video'}</span>
                  {item.status === 'uploading' && <span className="tag">bezig…</span>}
                  {item.description && <div className="muted">{item.description}</div>}
                  <div className="muted">
                    {item.kind === 'file' && item.sizeBytes > 0 ? formatBytes(item.sizeBytes) : ''}
                  </div>
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => setPreviewId(previewId === item.id ? null : item.id)}
                  >
                    {previewId === item.id ? 'Verbergen' : 'Bekijken'}
                  </button>
                  <button type="button" className="linkbtn" onClick={() => setEditing(item)}>
                    Bewerken
                  </button>
                  <button
                    type="button"
                    className="linkbtn danger"
                    onClick={() => void remove(item)}
                  >
                    Verwijderen
                  </button>
                </div>
              </div>
              {previewId === item.id &&
                (item.kind === 'link' ? (
                  <p>
                    <a href={item.url ?? '#'} target="_blank" rel="noreferrer">
                      {item.url}
                    </a>
                  </p>
                ) : item.status === 'ready' ? (
                  <LibraryPlayer itemId={item.id} />
                ) : (
                  <p className="muted">De upload is nog niet klaar.</p>
                ))}
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <Modal
          title={adding === 'file' ? 'Video uploaden' : 'Link toevoegen'}
          onClose={() => setAdding(null)}
        >
          {adding === 'file' ? (
            <UploadForm
              onDone={() => {
                setAdding(null);
                void refresh();
              }}
            />
          ) : (
            <LinkForm
              onDone={() => {
                setAdding(null);
                void refresh();
              }}
            />
          )}
        </Modal>
      )}

      {editing && (
        <Modal title="Bewerken" onClose={() => setEditing(null)}>
          <EditForm
            item={editing}
            onDone={() => {
              setEditing(null);
              void refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function LinkForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = CreateLibraryItemSchema.safeParse({
      title,
      description: description || undefined,
      kind: 'link',
      url,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer de invoer');
      return;
    }
    setBusy(true);
    try {
      await api.createLibraryItem(parsed.data);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="lib-title">Titel</label>
      <input id="lib-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="lib-desc">Beschrijving</label>
      <textarea
        id="lib-desc"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor="lib-url">Link (https://…)</label>
      <input id="lib-url" value={url} onChange={(e) => setUrl(e.target.value)} />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Toevoegen'}
      </button>
    </form>
  );
}

function UploadForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError('Geef een titel op');
      return;
    }
    if (!file) {
      setError('Kies een videobestand');
      return;
    }
    setProgress(0);
    try {
      const item = await api.createLibraryItem({
        title: title.trim(),
        description: description || undefined,
        kind: 'file',
      });
      await api.uploadLibraryFile(item.id, file, setProgress);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uploaden mislukt');
      setProgress(null);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="up-title">Titel</label>
      <input id="up-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="up-desc">Beschrijving</label>
      <textarea
        id="up-desc"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <label htmlFor="up-file">Videobestand</label>
      <input
        id="up-file"
        type="file"
        accept="video/*"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      {progress !== null && <p className="muted">Uploaden… {progress}%</p>}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={progress !== null}>
        {progress !== null ? 'Bezig…' : 'Uploaden'}
      </button>
    </form>
  );
}

function EditForm({ item, onDone }: { item: LibraryItemDto; onDone: () => void }) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.updateLibraryItem(item.id, {
        title: title.trim() || undefined,
        description: description.trim() || null,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="ed-title">Titel</label>
      <input id="ed-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="ed-desc">Beschrijving</label>
      <textarea
        id="ed-desc"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Opslaan'}
      </button>
    </form>
  );
}
