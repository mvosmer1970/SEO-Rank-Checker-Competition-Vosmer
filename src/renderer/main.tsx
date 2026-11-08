import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { RankTrackerApi } from '../shared/types';
import { App } from './App';
import './styles.css';

declare global {
  interface Window {
    rankTracker: RankTrackerApi;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
