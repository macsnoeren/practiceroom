import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  CreateUserSchema,
  UpdateUserSchema,
  type UpdateUserInput,
  type UserDto,
} from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { Modal } from './Modal.js';

const ROLE_LABEL: Record<UserDto['role'], string> = {
  superadmin: 'Sitebeheerder',
  admin: 'Beheerder',
  teacher: 'Leraar',
  student: 'Student',
};

export function UserManagement({ canManage, me }: { canManage: boolean; me: UserDto }) {
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserDto | null>(null);

  const refresh = useCallback(async () => {
    setListError(null);
    try {
      setUsers(await api.listUsers());
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Laden mislukt');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(user: UserDto) {
    if (!confirm(`Gebruiker "${user.name}" verwijderen? Dit kan niet ongedaan worden gemaakt.`)) {
      return;
    }
    try {
      await api.deleteUser(user.id);
      void refresh();
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : 'Verwijderen mislukt');
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h2>Gebruikers in jouw school</h2>
        {canManage && (
          <button type="button" onClick={() => setCreating(true)}>
            + Gebruiker toevoegen
          </button>
        )}
      </div>

      {listError && <p className="error">{listError}</p>}
      {!users && !listError && <p className="muted">Laden…</p>}
      {users && users.length === 0 && <p className="muted">Nog geen gebruikers.</p>}
      {users && users.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Naam</th>
              <th>E-mail</th>
              <th>Rol</th>
              {canManage && <th>Acties</th>}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <span className="tag">{ROLE_LABEL[u.role]}</span>
                  {u.totpEnabled && <span className="tag tag-ok">2FA</span>}
                </td>
                {canManage && (
                  <td className="actions">
                    <button type="button" className="linkbtn" onClick={() => setEditing(u)}>
                      Bewerken
                    </button>
                    {u.id !== me.id && (
                      <button
                        type="button"
                        className="linkbtn danger"
                        onClick={() => void remove(u)}
                      >
                        Verwijderen
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <Modal title="Gebruiker toevoegen" onClose={() => setCreating(false)}>
          <CreateUserForm
            onCreated={() => {
              setCreating(false);
              void refresh();
            }}
          />
        </Modal>
      )}

      {editing && (
        <Modal title="Gebruiker bewerken" onClose={() => setEditing(null)}>
          <EditUserForm
            user={editing}
            isSelf={editing.id === me.id}
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

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // No password: the user is invited by e-mail to choose one themselves.
    const parsed = CreateUserSchema.safeParse({ name, email, role });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }

    setBusy(true);
    try {
      await api.createUser(parsed.data);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Toevoegen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="cu-name">Naam</label>
      <input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="cu-email">E-mail</label>
      <input
        id="cu-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
      <label htmlFor="cu-role">Rol</label>
      <select
        id="cu-role"
        value={role}
        onChange={(e) => setRole(e.target.value === 'teacher' ? 'teacher' : 'student')}
      >
        <option value="student">Student</option>
        <option value="teacher">Leraar</option>
      </select>
      <p className="muted">
        De gebruiker krijgt een e-mail met een link om zelf een wachtwoord in te stellen.
      </p>
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Uitnodigen'}
      </button>
    </form>
  );
}

function EditUserForm({
  user,
  isSelf,
  onSaved,
}: {
  user: UserDto;
  isSelf: boolean;
  onSaved: () => void;
}) {
  type AssignableRole = 'admin' | 'teacher' | 'student';
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<AssignableRole>(
    user.role === 'superadmin' ? 'admin' : user.role,
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const input: UpdateUserInput = {};
    if (name !== user.name) input.name = name;
    if (email !== user.email) input.email = email;
    if (!isSelf && role !== user.role) input.role = role;
    if (password) input.password = password;

    if (Object.keys(input).length === 0) {
      onSaved();
      return;
    }

    const parsed = UpdateUserSchema.safeParse(input);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }

    setBusy(true);
    try {
      await api.updateUser(user.id, parsed.data);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="eu-name">Naam</label>
      <input id="eu-name" value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="eu-email">E-mail</label>
      <input
        id="eu-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
      <label htmlFor="eu-role">Rol</label>
      <select
        id="eu-role"
        value={role}
        onChange={(e) => setRole(e.target.value as AssignableRole)}
        disabled={isSelf}
      >
        <option value="student">Student</option>
        <option value="teacher">Leraar</option>
        <option value="admin">Beheerder</option>
      </select>
      {isSelf && <p className="muted">Je kunt je eigen rol niet wijzigen.</p>}
      <label htmlFor="eu-password">Nieuw wachtwoord (optioneel, min. 8 tekens)</label>
      <input
        id="eu-password"
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
