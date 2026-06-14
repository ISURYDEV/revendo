import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider, ConfirmProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import { installDemoBackend } from './demo/demoBackend';
import './index.css';

// Sur le web (Vercel / navigateur), le pont Electron `window.revendo` n'existe
// pas : on installe un backend de démonstration à données fictives. En desktop
// (Electron), `window.revendo` est déjà présent et cette fonction ne fait rien.
installDemoBackend();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <ToastProvider>
        <ConfirmProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ConfirmProvider>
      </ToastProvider>
    </HashRouter>
  </React.StrictMode>
);
