import { useState, type FormEvent } from 'react';
import { APP_NAME, SiteAdminSetupSchema, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';

/** One-time creation of the first site-wide administrator (shown only while no
 * superadmin exists yet). */
export function SiteSetup({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = SiteAdminSetupSchema.safeParse({ name, email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Controleer je invoer');
      return;
    }
    setBusy(true);
    try {
      onAuthenticated(await api.setupSiteAdmin(parsed.data));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aanmaken mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-logo" src="/practice-room-logo.png" alt={APP_NAME} />
        </div>
        <div className="card">
          <h2>Sitebeheerder aanmaken</h2>
          <p className="muted">
            Er is nog geen sitebeheerder. Maak eenmalig het beheerdersaccount voor de hele site aan.
          </p>
          <form onSubmit={submit}>
            <label htmlFor="su-name">Naam</label>
            <input id="su-name" value={name} onChange={(e) => setName(e.target.value)} />
            <label htmlFor="su-email">E-mail</label>
            <input
              id="su-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <label htmlFor="su-password">Wachtwoord (min. 8 tekens)</label>
            <input
              id="su-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? 'Bezig…' : 'Aanmaken'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
