import { useState } from 'react';

const ACK_KEY = 'pr_cookie_ack';

function alreadyAcknowledged(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Informative cookie notice. {APP_NAME} only uses functional cookies/storage,
 * so this is an acknowledgement (not a consent gate). The choice is remembered
 * in local storage.
 */
export function CookieBanner() {
  const [hidden, setHidden] = useState(alreadyAcknowledged);

  if (hidden) return null;

  function accept() {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      // storage unavailable; just close for this session
    }
    setHidden(true);
  }

  return (
    <div className="cookie-banner" role="region" aria-label="Cookiemelding">
      <p>
        Wij gebruiken alleen functionele cookies die nodig zijn om in te loggen en je voorkeuren te
        onthouden. Geen tracking. Lees meer in onze <a href="/cookies">cookieverklaring</a>.
      </p>
      <button type="button" onClick={accept}>
        Akkoord
      </button>
    </div>
  );
}
