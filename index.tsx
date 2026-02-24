/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

// 1. Polyfill process pour éviter "ReferenceError: process is not defined"
// Cela arrive quand on utilise des bibliothèques conçues pour Node.js dans le navigateur.
if (typeof process === 'undefined') {
  (window as unknown as { process: { env: Record<string, string> } }).process = { env: { API_KEY: '' } };
}

// 2. Ignorer les erreurs "ResizeObserver loop limit exceeded"
// Ce sont des erreurs bénignes de mise en page qui peuvent apparaître comme "Uncaught" mais ne cassent pas l'app.
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop limit exceeded' || e.message.includes('ResizeObserver')) {
    e.stopImmediatePropagation();
    // e.preventDefault(); // Optionnel selon le navigateur
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);