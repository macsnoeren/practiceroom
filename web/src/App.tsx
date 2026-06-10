import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { APP_NAME, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from './api.js';
import { AuthScreen } from './components/AuthScreen.js';
import { AppShell } from './components/AppShell.js';
import { SiteFooter } from './components/SiteFooter.js';
import { SiteSetup } from './components/SiteSetup.js';
import { SiteAdminApp } from './components/SiteAdminApp.js';

type AuthState =
  | { kind: 'loading' }
  | { kind: 'authenticated'; user: UserDto }
  | { kind: 'anon'; needsSetup: boolean };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ kind: 'authenticated', user }))
      .catch(async (err: unknown) => {
        if (!(err instanceof ApiError)) console.error(err);
        // Not logged in: if there is no site administrator yet, offer setup.
        const needsSetup = await api
          .setupStatus()
          .then((s) => !s.exists)
          .catch(() => false);
        setAuth({ kind: 'anon', needsSetup });
      });
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    setAuth({ kind: 'anon', needsSetup: false });
  }

  const setAuthed = (user: UserDto) => setAuth({ kind: 'authenticated', user });

  if (auth.kind === 'loading') {
    return (
      <div className="auth-page">
        <p className="muted">Laden…</p>
      </div>
    );
  }

  if (auth.kind === 'anon') {
    if (auth.needsSetup) return <SiteSetup onAuthenticated={setAuthed} />;
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img className="brand-logo" src="/practice-room-logo.png" alt={APP_NAME} />
          </div>
          <AuthScreen onAuthenticated={setAuthed} />
        </div>
        <SiteFooter />
      </div>
    );
  }

  const { user } = auth;

  // A site administrator who hasn't entered a school yet sees the site dashboard.
  if (user.role === 'superadmin' && !user.activeSchoolId) {
    return <SiteAdminApp user={user} onLogout={logout} onEnter={setAuthed} />;
  }

  // Everyone else (and a superadmin who has entered a school) sees the school app.
  return (
    <BrowserRouter>
      <AppShell
        user={user}
        onLogout={logout}
        onUserUpdate={setAuthed}
        onLeaveSchool={
          user.role === 'superadmin'
            ? () =>
                api
                  .leaveSchool()
                  .then(setAuthed)
                  .catch(() => undefined)
            : undefined
        }
      />
    </BrowserRouter>
  );
}
