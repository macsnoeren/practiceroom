import { useState, type FormEvent } from 'react';
import { LoginSchema, RegisterSchoolSchema, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';

type Mode = 'login' | 'register';

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [mode, setMode] = useState<Mode>('login');

  return (
    <div className="card">
      <div className="row">
        <h2>{mode === 'login' ? 'Inloggen' : 'Nieuwe muziekschool'}</h2>
        <button
          type="button"
          className="linkbtn"
          onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? 'Nieuwe school aanmaken' : 'Ik heb al een account'}
        </button>
      </div>
      {mode === 'login' ? (
        <LoginForm onAuthenticated={onAuthenticated} />
      ) : (
        <RegisterForm onAuthenticated={onAuthenticated} />
      )}
    </div>
  );
}

function LoginForm({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = LoginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }

    setBusy(true);
    try {
      onAuthenticated(await api.login(parsed.data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Inloggen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="login-email">E-mail</label>
      <input
        id="login-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
      />
      <label htmlFor="login-password">Wachtwoord</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Inloggen'}
      </button>
    </form>
  );
}

function RegisterForm({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [schoolName, setSchoolName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = RegisterSchoolSchema.safeParse({ schoolName, adminName, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }

    setBusy(true);
    try {
      const result = await api.registerSchool(parsed.data);
      onAuthenticated(result.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registreren mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor="reg-school">Naam muziekschool</label>
      <input id="reg-school" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
      <label htmlFor="reg-name">Jouw naam (admin)</label>
      <input id="reg-name" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
      <label htmlFor="reg-email">E-mail</label>
      <input
        id="reg-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
      />
      <label htmlFor="reg-password">Wachtwoord (min. 8 tekens)</label>
      <input
        id="reg-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'School aanmaken'}
      </button>
    </form>
  );
}
