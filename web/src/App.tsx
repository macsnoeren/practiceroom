import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { APP_NAME, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from './api.js';
import { AuthScreen } from './components/AuthScreen.js';
import { AppShell } from './components/AppShell.js';

type AuthState = { kind: 'loading' } | { kind: 'authenticated'; user: UserDto } | { kind: 'anon' };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ kind: 'authenticated', user }))
      .catch((err: unknown) => {
        if (!(err instanceof ApiError)) console.error(err);
        setAuth({ kind: 'anon' });
      });
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    setAuth({ kind: 'anon' });
  }

  if (auth.kind === 'loading') {
    return (
      <div className="auth-page">
        <p className="muted">Laden…</p>
      </div>
    );
  }

  if (auth.kind === 'anon') {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <img className="brand-mark" src="/practice-room-logo.png" alt="" />
            {APP_NAME}
          </div>
          <AuthScreen onAuthenticated={(user) => setAuth({ kind: 'authenticated', user })} />
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <AppShell
        user={auth.user}
        onLogout={logout}
        onUserUpdate={(user) => setAuth({ kind: 'authenticated', user })}
      />
    </BrowserRouter>
  );
}
