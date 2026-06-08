import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CreateUserSchema, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';
import { Modal } from './Modal.js';

const ROLE_LABEL: Record<UserDto['role'], string> = {
  admin: 'Beheerder',
  teacher: 'Leraar',
  student: 'Student',
};

export function UserManagement({ canCreate }: { canCreate: boolean }) {
  const [users, setUsers] = useState<UserDto[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

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

  return (
    <div className="card">
      <div className="row">
        <h2>Gebruikers in jouw school</h2>
        {canCreate && (
          <button type="button" onClick={() => setOpen(true)}>
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
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>
                  <span className="tag">{ROLE_LABEL[u.role]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <Modal title="Gebruiker toevoegen" onClose={() => setOpen(false)}>
          <CreateUserForm
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

function CreateUserForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'teacher' | 'student'>('student');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = CreateUserSchema.safeParse({ name, email, password, role });
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
      <label htmlFor="cu-password">Wachtwoord (min. 8 tekens)</label>
      <input
        id="cu-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
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
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Toevoegen'}
      </button>
    </form>
  );
}
