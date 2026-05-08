import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class TradeErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[TRADE ERROR BOUNDARY] Component crash caught:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 rounded-xl bg-red-950/40 border border-red-800/50 text-red-200 text-sm flex flex-col gap-2 my-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-red-400">
              ⚠️ {this.props.fallbackTitle || 'Panel Render Error'}
            </span>
            <button
              onClick={this.handleReset}
              className="px-2.5 py-1 text-xs bg-red-900/60 hover:bg-red-800 border border-red-700 rounded text-red-100 transition-colors"
            >
              Retry
            </button>
          </div>
          <p className="text-xs text-red-300/80 font-mono truncate">
            {this.state.error?.message || 'An unexpected rendering error occurred'}
          </p>
        </div>
      );
    }

    return this.props.children;
  }
}

export default TradeErrorBoundary;
