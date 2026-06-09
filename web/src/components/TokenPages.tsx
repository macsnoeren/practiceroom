import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { APP_NAME } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';

function tokenFromUrl(): string {
  return new URLSearchParams(window.location.search).get('token') ?? '';
}

/** Centered, branded shell matching the auth page. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-mark" src="/practice-room-logo.png" alt="" />
          {APP_NAME}
        </div>
        <div className="card">{children}</div>
      </div>
    </div>
  );
}

export function VerifyEmailPage() {
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = tokenFromUrl();
    if (!token) {
      setState('error');
      setMessage('Geen verificatietoken gevonden.');
      return;
    }
    api
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((err: unknown) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Verifiëren mislukt.');
      });
  }, []);

  return (
    <Shell>
      <h2>E-mailadres bevestigen</h2>
      {state === 'busy' && <p className="muted">Bezig met verifiëren…</p>}
      {state === 'ok' && <p className="success">Je e-mailadres is bevestigd. Bedankt!</p>}
      {state === 'error' && <p className="error">{message}</p>}
      <a className="linkbtn" href="/">
        Naar PracticeRoom
      </a>
    </Shell>
  );
}

export function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = tokenFromUrl();
    if (!token) {
      setError('Geen herstellink gevonden.');
      return;
    }
    if (password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens zijn.');
      return;
    }
    if (password !== confirm) {
      setError('De wachtwoorden komen niet overeen.');
      return;
    }

    setBusy(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Herstellen mislukt.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h2>Nieuw wachtwoord instellen</h2>
      {done ? (
        <>
          <p className="success">Je wachtwoord is gewijzigd. Je kunt nu inloggen.</p>
          <a className="linkbtn" href="/">
            Naar inloggen
          </a>
        </>
      ) : (
        <form onSubmit={submit}>
          <label htmlFor="rp-password">Nieuw wachtwoord (min. 8 tekens)</label>
          <input
            id="rp-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <label htmlFor="rp-confirm">Herhaal wachtwoord</label>
          <input
            id="rp-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Bezig…' : 'Wachtwoord opslaan'}
          </button>
        </form>
      )}
    </Shell>
  );
}

export function AcceptInvitePage() {
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = tokenFromUrl();
    if (!token) {
      setInvalid('Geen uitnodiging gevonden.');
      setLoading(false);
      return;
    }
    api
      .getInvite(token)
      .then((preview) => {
        setName(preview.name);
        setEmail(preview.email);
      })
      .catch((err: unknown) => {
        setInvalid(err instanceof ApiError ? err.message : 'Uitnodiging ongeldig.');
      })
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const token = tokenFromUrl();
    if (password.length < 8) {
      setError('Wachtwoord moet minimaal 8 tekens zijn.');
      return;
    }
    if (password !== confirm) {
      setError('De wachtwoorden komen niet overeen.');
      return;
    }

    setBusy(true);
    try {
      await api.acceptInvite(token, password, name.trim() || undefined);
      // The session cookie is now set; load the app as the new user.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Activeren mislukt.');
      setBusy(false);
    }
  }

  return (
    <Shell>
      <h2>Account activeren</h2>
      {loading && <p className="muted">Laden…</p>}
      {invalid && <p className="error">{invalid}</p>}
      {!loading && !invalid && (
        <form onSubmit={submit}>
          <p className="muted">
            Welkom! Stel een wachtwoord in voor <strong>{email}</strong>.
          </p>
          <label htmlFor="ai-name">Naam</label>
          <input id="ai-name" value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="ai-password">Wachtwoord (min. 8 tekens)</label>
          <input
            id="ai-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
          <label htmlFor="ai-confirm">Herhaal wachtwoord</label>
          <input
            id="ai-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
          />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy}>
            {busy ? 'Bezig…' : 'Account activeren'}
          </button>
        </form>
      )}
    </Shell>
  );
}

/** Renders the token landing page for the current path, or null otherwise. */
export function tokenPageForPath(pathname: string): ReactNode | null {
  switch (pathname) {
    case '/verify-email':
      return <VerifyEmailPage />;
    case '/reset-password':
      return <ResetPasswordPage />;
    case '/accept-invite':
      return <AcceptInvitePage />;
    default:
      return null;
  }
}
