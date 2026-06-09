import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { tokenPageForPath } from './components/TokenPages.js';
import { infoPageForPath } from './components/InfoPages.js';
import { CookieBanner } from './components/CookieBanner.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// E-mail-link landing pages (verify / reset / invite) and the public info pages
// (privacy / cookies / terms / help) stand on their own and work regardless of
// login state, so they bypass the main app.
const path = window.location.pathname;
const standalonePage = tokenPageForPath(path) ?? infoPageForPath(path);

createRoot(rootElement).render(
  <StrictMode>
    {standalonePage ?? <App />}
    <CookieBanner />
  </StrictMode>,
);
