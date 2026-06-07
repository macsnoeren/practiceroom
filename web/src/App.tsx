import { useEffect, useState } from 'react';
import { APP_NAME, type UserDto } from '@practiceroom/shared';
import { ApiError, api } from './api.js';
import { AuthScreen } from './components/AuthScreen.js';
import { UserManagement } from './components/UserManagement.js';
import { DeviceManagement } from './components/DeviceManagement.js';
import { LessonManagement } from './components/LessonManagement.js';
import { StudentLessons } from './components/StudentLessons.js';

type AuthState = { kind: 'loading' } | { kind: 'authenticated'; user: UserDto } | { kind: 'anon' };

export function App() {
  const [auth, setAuth] = useState<AuthState>({ kind: 'loading' });

  useEffect(() => {
    api
      .me()
      .then((user) => setAuth({ kind: 'authenticated', user }))
      .catch((err: unknown) => {
        // 401 simply means not logged in; anything else we also treat as anon.
        if (!(err instanceof ApiError)) console.error(err);
        setAuth({ kind: 'anon' });
      });
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    setAuth({ kind: 'anon' });
  }

  return (
    <div className="container">
      <h1>{APP_NAME}</h1>

      {auth.kind === 'loading' && <p className="muted">Laden…</p>}

      {auth.kind === 'anon' && (
        <AuthScreen onAuthenticated={(user) => setAuth({ kind: 'authenticated', user })} />
      )}

      {auth.kind === 'authenticated' && (
        <>
          <div className="card">
            <div className="row">
              <div>
                Ingelogd als <strong>{auth.user.name}</strong>{' '}
                <span className="tag">{auth.user.role}</span>
                <div className="muted">{auth.user.email}</div>
              </div>
              <button type="button" className="secondary" onClick={logout}>
                Uitloggen
              </button>
            </div>
          </div>

          {auth.user.role === 'student' ? (
            <StudentLessons />
          ) : (
            <>
              <LessonManagement isAdmin={auth.user.role === 'admin'} />
              <DeviceManagement />
              <UserManagement canCreate={auth.user.role === 'admin'} />
            </>
          )}
        </>
      )}
    </div>
  );
}
