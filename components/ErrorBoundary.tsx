/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare state: ErrorBoundaryState;
  declare props: ErrorBoundaryProps;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-50 flex items-center justify-center p-4 font-sans">
          <div className="bg-white border border-zinc-200 rounded-3xl p-8 max-w-md w-full text-center shadow-xl">
            <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-100">
              <AlertTriangle className="text-red-500 w-8 h-8" strokeWidth={1.5} />
            </div>
            <h1 className="text-xl font-bold text-zinc-900 mb-2">Une erreur est survenue</h1>
            <p className="text-zinc-500 mb-8 text-sm leading-relaxed">
              L'application a rencontré un problème inattendu.
              <br />
              Nous avons bloqué le crash pour protéger vos données.
            </p>
            {this.state.error && (
                <div className="mb-6 p-3 bg-zinc-100 rounded-lg text-left overflow-auto max-h-32">
                    <p className="text-[10px] font-mono text-zinc-600 break-all">{this.state.error.toString()}</p>
                </div>
            )}
            <button 
                onClick={this.handleReload} 
                className="w-full inline-flex items-center justify-center rounded-full font-medium transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 active:scale-[0.98] bg-zinc-900 hover:bg-zinc-800 text-white shadow-sm px-5 py-3 text-sm"
            >
              <RefreshCcw size={16} className="mr-2" /> Recharger l'application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}