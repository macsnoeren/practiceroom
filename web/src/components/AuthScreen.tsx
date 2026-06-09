import { useState, type FormEvent } from 'react';
import { LoginSchema, RegisterSchoolSchema, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';

type Mode = 'login' | 'register' | 'forgot';

const TITLES: Record<Mode, string> = {
  login: 'Inloggen',
  register: 'Nieuwe muziekschool',
  forgot: 'Wachtwoord vergeten',
};

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [mode, setMode] = useState<Mode>('login');

  return (
    <div className="card">
      <div className="row">
        <h2>{TITLES[mode]}</h2>
        {mode !== 'forgot' && (
          <button
            type="button"
            className="linkbtn"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Registreren' : 'Ik heb al een account'}
          </button>
        )}
      </div>
      {mode === 'login' && (
        <LoginForm onAuthenticated={onAuthenticated} onForgot={() => setMode('forgot')} />
      )}
      {mode === 'register' && <RegisterForm onAuthenticated={onAuthenticated} />}
      {mode === 'forgot' && <ForgotPasswordForm onBack={() => setMode('login')} />}
    </div>
  );
}

function LoginForm({
  onAuthenticated,
  onForgot,
}: {
  onAuthenticated: (user: UserDto) => void;
  onForgot: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const parsed = LoginSchema.safeParse({
      email,
      password,
      code: code.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }

    setBusy(true);
    try {
      onAuthenticated(await api.login(parsed.data));
    } catch (err) {
      if (err instanceof ApiError && err.twofa) {
        // The account has 2FA: reveal the code field and ask for it.
        setNeedsCode(true);
        setError(needsCode ? err.message : null);
      } else {
        setError(err instanceof ApiError ? err.message : 'Inloggen mislukt');
      }
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
        disabled={needsCode}
      />
      <label htmlFor="login-password">Wachtwoord</label>
      <input
        id="login-password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        disabled={needsCode}
      />
      {needsCode && (
        <>
          <label htmlFor="login-code">Verificatiecode</label>
          <input
            id="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <p className="muted">Voer de code uit je authenticator-app in.</p>
        </>
      )}
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : needsCode ? 'Verifiëren' : 'Inloggen'}
      </button>
      {!needsCode && (
        <p className="form-footer">
          <button type="button" className="linkbtn" onClick={onForgot}>
            Wachtwoord vergeten?
          </button>
        </p>
      )}
    </form>
  );
}

function ForgotPasswordForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.forgotPassword(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Versturen mislukt');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <p className="success">
          Als er een account bij dit e-mailadres hoort, is er een herstellink verstuurd. Controleer
          je inbox.
        </p>
        <button type="button" className="linkbtn" onClick={onBack}>
          Terug naar inloggen
        </button>
      </>
    );
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">
        Vul je e-mailadres in en we sturen je een link om je wachtwoord te herstellen.
      </p>
      <label htmlFor="forgot-email">E-mail</label>
      <input
        id="forgot-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="username"
      />
      {error && <p className="error">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? 'Bezig…' : 'Herstellink versturen'}
      </button>
      <p className="form-footer">
        <button type="button" className="linkbtn" onClick={onBack}>
          Terug naar inloggen
        </button>
      </p>
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
