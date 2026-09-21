import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastHost>
          <SessionProvider>
            <App />
          </SessionProvider>
        </ToastHost>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
