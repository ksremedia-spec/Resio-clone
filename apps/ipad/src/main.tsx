import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, HashRouter } from 'react-router';
import { StandaloneBoot } from './standalone/Boot';
import './ui/ui.css';
import { App } from './App';
import { SessionProvider } from './store/session';
import { queryClient } from './api/hooks';
import { ToastHost } from './ui/components';
import { pendingCount, processOutbox, startSyncEngine } from './store/sync';
import { shell } from './native';

void shell.init();
startSyncEngine();
if (import.meta.env.DEV) { void import('./store/db').then(({ db }) => { (window as any).__buildline = { db, processOutbox, pendingCount }; }); }

// Standalone build: the backend runs inside the page (see src/standalone) and routes use the URL hash
// so the app works when hosted at any path (e.g. an artifact URL).
export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
const Router = STANDALONE ? HashRouter : BrowserRouter;
const tree = (
  <QueryClientProvider client={queryClient}>
    <Router>
      <ToastHost>
        <SessionProvider>
          <App />
        </SessionProvider>
      </ToastHost>
    </Router>
  </QueryClientProvider>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>{STANDALONE ? <StandaloneBoot>{tree}</StandaloneBoot> : tree}</StrictMode>,
);
