import { useState } from 'react';
import { APP_NAME, type UserDto } from '@practiceroom/shared';
import { AuthScreen } from './AuthScreen.js';
import { LandingPage } from './LandingPage.js';
import { SiteFooter } from './SiteFooter.js';

/** Everything a not-logged-in visitor sees: an inviting landing page, with the
 * login/register card a click away. */
export function PublicSite({ onAuthenticated }: { onAuthenticated: (user: UserDto) => void }) {
  const [view, setView] = useState<'landing' | 'auth'>('landing');

  if (view === 'landing') {
    return <LandingPage onGetStarted={() => setView('auth')} />;
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img className="brand-logo" src="/practice-room-logo.png" alt={APP_NAME} />
        </div>
        <AuthScreen onAuthenticated={onAuthenticated} />
        <p className="form-footer">
          <button type="button" className="linkbtn" onClick={() => setView('landing')}>
            ← Terug naar de startpagina
          </button>
        </p>
      </div>
      <SiteFooter />
    </div>
  );
}
