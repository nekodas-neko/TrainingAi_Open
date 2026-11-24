import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportError } from '../../core/reporting/index.ts';
import { AppButton } from './AppButton';
import { ConfirmationCard } from './ConfirmationCard';
import { PageLayout } from './PageLayout';
import { StateCard } from './StateCard';

// The app had no error boundary: a screen that threw while drawing took the whole app down (#4099).
// This catches it, reports it, and shows the app's error card with a way back instead.
type Props = {
  title: string;
  screen: string;
  onBack: () => void;
  /**
   * Ends what the screen was showing without saving, when that is what keeps it failing (an
   * activity left by a crash). Offered after a confirm step; `onBack` runs once it has finished.
   */
  discardLabel?: string;
  onDiscard?: () => Promise<void>;
  children: ReactNode;
};
type State = { failed: boolean; confirming: boolean; busy: boolean; problem: string | null };
export class ScreenBoundary extends Component<Props, State> {
  state: State = { failed: false, confirming: false, busy: false, problem: null };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, _info: ErrorInfo) {
    reportError(error, { screen: this.props.screen });
  }
  private discard = async () => {
    if (this.state.busy || !this.props.onDiscard) return;
    this.setState({ busy: true, problem: null });
    try {
      await this.props.onDiscard();
      // The screen the person leaves to must not find this boundary still failed on the next visit.
      this.setState({ failed: false, confirming: false, busy: false });
      this.props.onBack();
    } catch (cause) {
      this.setState({
        busy: false,
        problem: cause instanceof Error ? cause.message : 'Could not discard it.',
      });
    }
  };
  render() {
    if (!this.state.failed) return this.props.children;
    const { onDiscard, discardLabel = 'Discard activity' } = this.props;
    return (
      <PageLayout title={this.props.title} onBack={this.props.onBack}>
        <StateCard
          error
          title="This screen could not open"
          message="Go back and try again. Anything you recorded is kept on this phone."
          action="Go back"
          onAction={this.props.onBack}
        />
        {onDiscard && !this.state.confirming && (
          <AppButton
            title={discardLabel}
            variant="secondary"
            onPress={() => this.setState({ confirming: true })}
          />
        )}
        {onDiscard && this.state.confirming && (
          <ConfirmationCard
            title="Discard this activity?"
            message="It has not been saved. Discarding ends it without saving, and you can then start another."
            danger
            confirmLabel="Discard"
            cancelLabel="Keep activity"
            busy={this.state.busy}
            onConfirm={() => void this.discard()}
            onCancel={() => this.setState({ confirming: false })}
          />
        )}
        {this.state.problem && (
          <StateCard error title="Could not discard" message={this.state.problem} />
        )}
      </PageLayout>
    );
  }
}
