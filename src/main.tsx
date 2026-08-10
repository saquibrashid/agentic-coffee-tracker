import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import {
  applyTheme,
  prefersDark,
  readStoredPreference,
  resolveTheme,
} from './services/theme/theme';
import './styles/globals.css';

// The inline script in index.html has already done this before first paint.
// Repeating it here covers the cases that script cannot: a dev-server reload
// that replaces the document, and any entry point that is not index.html.
applyTheme(resolveTheme(readStoredPreference(), prefersDark()));

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Missing #root element');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
