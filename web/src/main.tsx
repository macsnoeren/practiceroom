import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { tokenPageForPath } from './components/TokenPages.js';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// E-mail-link landing pages (verify / reset / invite) stand on their own and
// work regardless of login state, so they bypass the main app.
const tokenPage = tokenPageForPath(window.location.pathname);

createRoot(rootElement).render(<StrictMode>{tokenPage ?? <App />}</StrictMode>);
