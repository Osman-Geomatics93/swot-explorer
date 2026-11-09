import { Copy } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { toast } from '@/state/toast';
import { Button, Notice } from './ui';

interface State {
  error: Error | null;
  /** Which components the error passed through, for a bug report. */
  componentStack: string;
}

/** Keeps one failing panel from blanking the whole page, and offers the details for a bug report. */
export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, State> {
  override state: State = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? '' });
    console.error(`[${this.props.label}]`, error, info.componentStack);
  }

  private details() {
    const { error, componentStack } = this.state;
    return [
      `${this.props.label}: ${error?.message}`,
      `Version ${browser.runtime.getManifest().version} · ${navigator.userAgent}`,
      '',
      error?.stack ?? '',
      '',
      'Components:',
      componentStack.trim(),
    ].join('\n');
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="space-y-3 p-6">
        <Notice tone="error" title={`${this.props.label} stopped working`}>
          {this.state.error.message}
        </Notice>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => this.setState({ error: null, componentStack: '' })}>
            Try again
          </Button>
          <Button
            variant="ghost"
            icon={Copy}
            onClick={() =>
              void navigator.clipboard
                .writeText(this.details())
                .then(() => toast('Error details copied. Paste them in the chat.'))
                .catch(() => toast('Could not copy the details.', { tone: 'error' }))
            }
          >
            Copy error details
          </Button>
        </div>
      </div>
    );
  }
}
