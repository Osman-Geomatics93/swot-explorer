import '@/lib/zodConfig'; // must run first: stops Zod probing eval (blocked by the extension CSP)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { App } from '@/features/shell/App';
import { initTheme } from '@/state/theme';
import '@/styles/tokens.css';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="SWOT Explorer">
      <App layout="page" />
    </ErrorBoundary>
  </StrictMode>,
);
