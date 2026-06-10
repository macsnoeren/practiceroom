import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  APP_NAME,
  UpdateUserSchema,
  type GlobalUserDto,
  type SchoolSummaryDto,
  type UpdateUserInput,
  type UserDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { useTheme } from '../useTheme.js';
import { Modal } from './Modal.js';
import { SiteFooter } from './SiteFooter.js';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Sitebeheerder',
  admin: 'Beheerder',
  teacher: 'Leraar',
  student: 'Student',
};

/** The site-wide administrator's dashboard: pick a school to enter, and manage
 * all users across schools. */
export function SiteAdminApp({
  user,
  onLogout,
  onEnter,
}: {
  user: UserDto;
  onLogout: () => void;
  onEnter: (updated: UserDto) => void;
}) {
  const { theme, toggle } = useTheme();

  return (
    <div className="site-admin">
      <header className="topbar">
        <div className="brand">
          <img className="brand-logo" src="/practice-room-logo.png" alt={APP_NAME} />
        </div>
        <div className="topbar-spacer" />
        <div className="topbar-user">
          <span className="tag">Sitebeheer</span>
          <button
            type="button"
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === 'dark' ? 'Licht thema' : 'Donker thema'}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <div className="who">
            <strong>{user.name}</strong>
            <small>Sitebeheerder</small>
          </div>
          <button type="button" className="secondary" onClick={onLogout}>
            Uitloggen
          </button>
        </div>
      </header>

      <main className="main">
        <div className="page">
          <div className="page-head">
            <h1>Sitebeheer</h1>
            <p>Kies een school om in te beheren, of beheer gebruikers over alle scholen heen.</p>
          </div>
          <SchoolsCard onEnter={onEnter} />
          <UsersCard meId={user.id} />
          <SiteFooter />
        </div>
      </main>
    </div>
  );
}

function SchoolsCard({ onEnter }: { onEnter: (updated: UserDto) => void }) {
  const [schools, setSchools] = useState<SchoolSummaryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setSchools(await api.listSchools());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function enter(id: string) {
    setError(null);
    try {
      onEnter(await api.enterSchool(id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Openen mislukt');
    }
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.createSchool(name);
      setNewName('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aanmaken mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Scholen</h2>
        <form onSubmit={create} className="inline-form">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Naam nieuwe school"
            aria-label="Naam nieuwe school"
          />
          <button type="submit" disabled={busy || !newName.trim()}>
            + School
          </button>
        </form>
      </div>
      {error && <p className="error">{error}</p>}
      {!schools && !error && <p className="muted">Laden…</p>}
      {schools && schools.length === 0 && <p className="muted">Er zijn nog geen scholen.</p>}
      {schools && schools.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>School</th>
              <th>Gebruikers</th>
              <th>Lessen</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {schools.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.userCount}</td>
                <td>{s.lessonCount}</td>
                <td className="actions">
                  <button type="button" onClick={() => void enter(s.id)}>
                    Openen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UsersCard({ meId }: { meId: string }) {
  const [users, setUsers] = useState<GlobalUserDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<GlobalUserDto | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setUsers(await api.adminListUsers());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(u: GlobalUserDto) {
    if (!confirm(`Gebruiker "${u.name}" verwijderen?`)) return;
    try {
      await api.adminDeleteUser(u.id);
      void refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <h2>Alle gebruikers</h2>
      {error && <p className="error">{error}</p>}
      {!users && !error && <p className="muted">Laden…</p>}
      {users && users.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th>School</th>
              <th>Rol</th>
              <th>Acties</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.schoolName ?? '—'}</td>
                <td>
                  <span className="tag">{ROLE_LABEL[u.role] ?? u.role}</span>
                </td>
                <td className="actions">
                  {u.role === 'superadmin' ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      <button type="button" className="linkbtn" onClick={() => setEditing(u)}>
                        Bewerken
                      </button>
                      {u.id !== meId && (
                        <button
                          type="button"
                          className="linkbtn danger"
                          onClick={() => void remove(u)}
                        >
                          Verwijderen
                        </button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <Modal title="Gebruiker bewerken" onClose={() => setEditing(null)}>
          <EditUserForm
            user={editing}
            onSaved={() => {
              setEditing(null);
              void refresh();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function EditUserForm({ user, onSaved }: { user: GlobalUserDto; onSaved: () => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState(user.role);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const input: UpdateUserInput = {};
    if (name !== user.name) input.name = name;
    if (email !== user.email) input.email = email;
    if (role !== user.role && role !== 'superadmin') input.role = role;
    if (password) input.password = password;

    const parsed = UpdateUserSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }
    setBusy(true);
    try {
      await api.adminUpdateUser(user.id, parsed.data);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="gu-name">Naam</label>
      <input id="gu-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="gu-email">E-mail</label>
      <input
        id="gu-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
      <label htmlFor="gu-role">Rol</label>
      <select
        id="gu-role"
        value={role}
        onChange={(e) => setRole(e.target.value as GlobalUserDto['role'])}
      >
        <option value="student">Student</option>
        <option value="teacher">Leraar</option>
        <option value="admin">Beheerder</option>
      </select>
      <label htmlFor="gu-password">Nieuw wachtwoord (optioneel)</label>
      <input
        id="gu-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Opslaan'}
      </button>
    </form>
  );
}
