import React, { type ReactNode } from 'react';

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends React.Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // eslint-disable-next-line no-console
    console.error('Erreur React non récupérée', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="card max-w-xl p-6">
          <h1 className="text-xl font-bold mb-2">Revendo a rencontré une erreur.</h1>
          <p className="text-sm text-slate-300 mb-4">
            Rechargez l'application. Si le problème revient, notez les détails techniques ci-dessous.
          </p>
          <button className="btn-primary" onClick={() => window.location.reload()}>
            Recharger l'application
          </button>
          <details className="mt-4 text-xs text-slate-400 whitespace-pre-wrap">
            <summary>Détails techniques</summary>
            {this.state.error.stack ?? this.state.error.message}
          </details>
        </div>
      </div>
    );
  }
}
