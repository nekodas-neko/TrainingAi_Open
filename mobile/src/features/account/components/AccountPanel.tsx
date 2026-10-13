import { deviceHealthName } from '../../../integrations/device-health/platform';
import {
  AppText,
  AppButton,
  Card,
  LoadingIndicator,
  AppleSignInButton,
} from '../../../shared/ui';
import { useAccountContext } from '../AccountProvider';

export function AccountPanel() {
  const account = useAccountContext();
  const accountStatus = {
    loading: 'Loading account…',
    signedOut: 'Not signed in',
    signingIn: 'Signing in…',
    checking: 'Checking account…',
    signedIn: account.state.profile
      ? 'Signed in'
      : 'Session saved. Account verification needed.',
    storageError: 'Sign-in storage needs attention',
  }[account.state.status];
  return (
    <Card>
      <AppText variant="heading">TrainingAi account</AppText>
      {account.reason ? (
        <AppText tone="muted">{account.reason}</AppText>
      ) : (
        <>
          <AppText variant="label">{accountStatus}</AppText>
          {['loading', 'signingIn', 'checking'].includes(account.state.status) && (
            <LoadingIndicator accessibilityLabel="Checking account sign-in" />
          )}
          {account.state.profile && (
            <>
              <AppText variant="label">
                {account.state.profile.name ?? account.state.profile.email}
              </AppText>
              <AppText tone="muted">{account.state.profile.email}</AppText>
              {account.state.profile.timezone && (
                <AppText variant="caption" tone="muted">
                  {account.state.profile.timezone}
                </AppText>
              )}
            </>
          )}
          {account.state.message && (
            <AppText accessibilityRole="alert" tone="muted">
              {account.state.message}
            </AppText>
          )}
          {account.state.status === 'signedOut' && (
            <>
              {account.appleAvailable && (
                <AppleSignInButton
                  onPress={() => {
                    void account.signInWithApple();
                  }}
                />
              )}
              <AppButton
                title="Sign in with Google or email"
                onPress={() => {
                  void account.signIn();
                }}
              />
            </>
          )}
          {account.state.status === 'signedIn' &&
            account.state.profile &&
            !account.state.profile.signInProviders.includes('apple') &&
            account.appleAvailable && (
              <>
                <AppText variant="caption" tone="muted">
                  Connect Apple to this account
                </AppText>
                <AppleSignInButton
                  connecting
                  onPress={() => {
                    void account.signInWithApple();
                  }}
                />
              </>
            )}
          {account.state.profile?.signInProviders.includes('apple') && (
            <AppText variant="caption" tone="muted">
              Apple connected
            </AppText>
          )}
          {account.state.status === 'signingIn' && (
            <AppButton
              title="Cancel sign-in"
              variant="ghost"
              onPress={() => {
                void account.cancel();
              }}
            />
          )}
          {account.state.status === 'storageError' && (
            <AppButton
              title="Retry clearing sign-in"
              onPress={() => {
                void account.signOut();
              }}
            />
          )}
          {account.state.hasSession && (
            <>
              <AppButton
                title="Retry account check"
                variant="secondary"
                disabled={account.state.status === 'checking'}
                onPress={() => {
                  void account.retry();
                }}
              />
              <AppButton
                title="Sign out"
                variant="danger"
                onPress={() => {
                  void account.signOut();
                }}
              />
            </>
          )}
          <AppText variant="caption" tone="muted">
            Manage health-data syncing separately in More → {deviceHealthName}.
          </AppText>
        </>
      )}
    </Card>
  );
}
