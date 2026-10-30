import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class ModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Module failed to load', error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="empty-panel" role="alert">
          <h2>This module couldn’t open.</h2>
          <p>You can still open another module from the sidebar. Restart the app to retry this module.</p>
        </section>
      );
    }
    return this.props.children;
  }
}
