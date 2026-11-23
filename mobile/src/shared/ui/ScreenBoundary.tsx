import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../../core/reporting/index.ts';
import { PageLayout } from './PageLayout';
import { StateCard } from './StateCard';

// The app had no error boundary: a screen that threw while drawing took the whole app down (#4099).
// This catches it, reports it, and shows the app's error card with a way back instead.
export class ScreenBoundary extends Component<
  { title: string; screen: string; onBack: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    reportError(error, { screen: this.props.screen });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <PageLayout title={this.props.title} onBack={this.props.onBack}>
        <StateCard
          error
          title="This screen could not open"
          message="Go back and try again. Anything you recorded is kept on this phone."
          action="Go back"
          onAction={this.props.onBack}
        />
      </PageLayout>
    );
  }
}
