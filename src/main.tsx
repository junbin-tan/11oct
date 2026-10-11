import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-800.css';
import { App } from './App';
import './styles.css';

const CtfApp = lazy(() => import('./ctf/CtfApp'));
const Writeup = lazy(() => import('./writeup/Writeup'));
const path = window.location.pathname.replace(/\/+$/, '');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {path === '/capture-the-flag' ? <Suspense fallback={<p>Loading Capture the Flag…</p>}><CtfApp /></Suspense>
      : path === '/writeup' ? <Suspense fallback={<p>Loading…</p>}><Writeup /></Suspense>
      : <App />}
  </StrictMode>,
);
