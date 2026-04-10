import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
    children: ReactNode;
    message?: string;
    layout?: 'fullscreen' | 'card';
    onReset?: () => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    public handleReset = () => {
        this.setState({ hasError: false, error: null });
        this.props.onReset?.();
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.layout === 'card') {
                return (
                    <div className="flex flex-col items-center justify-center p-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl min-h-[300px] max-w-lg mx-auto my-4 shadow-sm animate-in fade-in duration-300">
                        <div className="w-12 h-12 bg-rose-100 dark:bg-rose-900/30 text-rose-650 rounded-2xl flex items-center justify-center mb-4">
                            <svg className="w-6 h-6 text-rose-600 dark:text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">Component Error</h3>
                        <p className="text-xs text-slate-500 max-w-sm mb-4">
                            {this.props.message || "This component encountered an unexpected error."}
                        </p>
                        {this.state.error && (
                            <div className="w-full mb-4 p-3 bg-slate-100 dark:bg-slate-950 rounded text-left overflow-auto max-h-24">
                                <code className="text-[10px] text-rose-500 font-mono break-all">
                                    {this.state.error.toString()}
                                </code>
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button
                                onClick={this.handleReset}
                                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-indigo-650/15 active:scale-95"
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                );
            }

            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
                    <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-8 text-center border border-slate-200 dark:border-slate-700">
                        <div className="mx-auto w-16 h-16 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-6">
                            <svg className="w-8 h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                        </div>

                        <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
                            Something went wrong
                        </h1>

                        <p className="text-slate-600 dark:text-slate-400 mb-6">
                            {this.props.message || "The application encountered an unexpected error. We've logged the issue and are working to fix it."}
                        </p>

                        {this.state.error && (
                            <div className="mb-6 p-4 bg-slate-100 dark:bg-slate-900 rounded text-left overflow-auto max-h-32">
                                <code className="text-xs text-red-600 dark:text-red-500 font-mono break-all">
                                    {this.state.error.toString()}
                                </code>
                            </div>
                        )}

                        <div className="flex gap-4 justify-center">
                            <button
                                onClick={() => window.location.reload()}
                                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors shadow-lg shadow-indigo-500/30"
                            >
                                Reload Application
                            </button>
                            <button
                                onClick={() => {
                                    const encKey = localStorage.getItem('wealth-encryption-key-v3');
                                    const encSalt = localStorage.getItem('wealth-encryption-salt');
                                    localStorage.clear();
                                    if (encKey) localStorage.setItem('wealth-encryption-key-v3', encKey);
                                    if (encSalt) localStorage.setItem('wealth-encryption-salt', encSalt);
                                    window.location.reload();
                                }}
                                className="px-6 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium rounded-lg transition-colors"
                            >
                                Hard Reset
                            </button>
                        </div>

                        <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
                            If this persists, try the Hard Reset option (clears local settings).
                        </p>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
