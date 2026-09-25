import { Component, type ErrorInfo, type ReactNode } from 'react';
import { smartBus } from '@/lib/smart-bus';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

export class ErrorBoundary extends Component<Props, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
    smartBus.emit({
      type: 'client-error',
      kind: 'render',
      message: error.message,
      detail: `${error.stack ?? ''}\n\nComponent stack:${info.componentStack ?? ''}`,
    });
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
