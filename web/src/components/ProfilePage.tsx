import { useEffect, useState, type FormEvent } from 'react';
import QRCode from 'qrcode';
import type { UpdateProfileInput, UserDto } from '@practiceroom/shared';
import { ApiError, api } from '../api.js';

export function ProfilePage({
  user,
  onUpdated,
}: {
  user: UserDto;
  onUpdated: (u: UserDto) => void;
}) {
  return (
    <div className="profile-grid">
      <ProfileForm user={user} onUpdated={onUpdated} />
      <TwoFactorCard user={user} onUpdated={onUpdated} />
    </div>
  );
}

function ProfileForm({ user, onUpdated }: { user: UserDto; onUpdated: (u: UserDto) => void }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    const payload: UpdateProfileInput = {};
    if (name !== user.name) payload.name = name;
    if (email !== user.email) payload.email = email;
    if (newPassword) {
      payload.newPassword = newPassword;
      payload.currentPassword = currentPassword;
    }
    if (Object.keys(payload).length === 0) {
      setStatus('Niets gewijzigd.');
      return;
    }

    setBusy(true);
    try {
      const updated = await api.updateProfile(payload);
      onUpdated(updated);
      setCurrentPassword('');
      setNewPassword('');
      setStatus('Profiel opgeslagen.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Opslaan mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Mijn gegevens</h2>
      <form onSubmit={submit}>
        <label htmlFor="pf-name">Naam</label>
        <input id="pf-name" value={name} onChange={(e) => setName(e.target.value)} />
        <label htmlFor="pf-email">E-mail</label>
        <input
          id="pf-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />

        <h3>Wachtwoord wijzigen</h3>
        <p className="muted">Laat leeg om je wachtwoord ongewijzigd te laten.</p>
        <label htmlFor="pf-current">Huidig wachtwoord</label>
        <input
          id="pf-current"
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
        />
        <label htmlFor="pf-new">Nieuw wachtwoord (min. 8 tekens)</label>
        <input
          id="pf-new"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />

        {error && <p className="error">{error}</p>}
        {status && <p className="success">{status}</p>}
        <button type="submit" disabled={busy}>
          {busy ? 'Bezig…' : 'Opslaan'}
        </button>
      </form>
    </div>
  );
}

function TwoFactorCard({ user, onUpdated }: { user: UserDto; onUpdated: (u: UserDto) => void }) {
  const [setup, setSetup] = useState<{ otpauthUrl: string; secret: string } | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!setup) {
      setQr(null);
      return;
    }
    let active = true;
    QRCode.toDataURL(setup.otpauthUrl)
      .then((url) => {
        if (active) setQr(url);
      })
      .catch(() => {
        if (active) setQr(null);
      });
    return () => {
      active = false;
    };
  }, [setup]);

  async function refreshUser() {
    const me = await api.me();
    onUpdated(me);
  }

  async function startSetup() {
    setError(null);
    setBusy(true);
    try {
      setSetup(await api.twoFactorSetup());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Instellen mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function enable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.twoFactorEnable(code.trim());
      setSetup(null);
      setCode('');
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Activeren mislukt');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.twoFactorDisable(code.trim());
      setCode('');
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Uitschakelen mislukt');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>Tweestapsverificatie</h2>

      {user.totpEnabled ? (
        <>
          <p>
            <span className="tag tag-ok">● ingeschakeld</span>
          </p>
          <p className="muted">
            Voer een code uit je authenticator-app in om tweestapsverificatie uit te schakelen.
          </p>
          <form onSubmit={disable}>
            <label htmlFor="tf-disable">Code</label>
            <input
              id="tf-disable"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" className="danger" disabled={busy}>
              {busy ? 'Bezig…' : 'Uitschakelen'}
            </button>
          </form>
        </>
      ) : setup ? (
        <>
          <p className="muted">
            Scan de QR-code met een authenticator-app (bijv. Google Authenticator of 1Password) en
            voer daarna de getoonde code in.
          </p>
          {qr && <img className="qr" src={qr} alt="QR-code voor tweestapsverificatie" />}
          <p className="muted">
            Lukt scannen niet? Voer deze sleutel handmatig in:
            <br />
            <code>{setup.secret}</code>
          </p>
          <form onSubmit={enable}>
            <label htmlFor="tf-code">Code uit de app</label>
            <input
              id="tf-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && <p className="error">{error}</p>}
            <div className="row">
              <button type="submit" disabled={busy}>
                {busy ? 'Bezig…' : 'Activeren'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setSetup(null);
                  setCode('');
                  setError(null);
                }}
              >
                Annuleren
              </button>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className="muted">
            Voeg een extra beveiligingslaag toe: na je wachtwoord vraagt het systeem dan een code
            uit een authenticator-app.
          </p>
          {error && <p className="error">{error}</p>}
          <button type="button" onClick={startSetup} disabled={busy}>
            {busy ? 'Bezig…' : 'Tweestapsverificatie instellen'}
          </button>
        </>
      )}
    </div>
  );
}
