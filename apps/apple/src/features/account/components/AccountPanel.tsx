import { ActivityIndicator, Button, Text, View } from 'react-native';
import { useAccountContext } from '../AccountProvider';
import { AppleSignInButton } from './AppleSignInButton';
import type { AppStyles } from '../../../shared/theme/useAppTheme';

export function AccountPanel({ styles: s, dark }: { styles: AppStyles; dark: boolean }) {
  const account = useAccountContext();
  const accountStatus = {
    loading: 'Loading account…',
    signedOut: 'Not signed in',
    signingIn: 'Signing in…',
    checking: 'Checking account…',
    signedIn: account.state.profile ? 'Signed in' : 'Session saved. Account verification needed.',
    storageError: 'Sign-in storage needs attention',
  }[account.state.status];
  return (
    <View style={s.card}>
      <Text style={s.heading}>TrainingAi account</Text>
      {account.reason ? (
        <Text style={s.muted}>{account.reason}</Text>
      ) : (
        <>
          <Text style={s.label}>{accountStatus}</Text>
          {['loading', 'signingIn', 'checking'].includes(account.state.status) && (
            <ActivityIndicator accessibilityLabel="Checking account sign-in" />
          )}
          {account.state.profile && (
            <>
              <Text style={s.label}>
                {account.state.profile.name ?? account.state.profile.email}
              </Text>
              <Text style={s.muted}>{account.state.profile.email}</Text>
              {account.state.profile.timezone && (
                <Text style={s.small}>{account.state.profile.timezone}</Text>
              )}
            </>
          )}
          {account.state.message && (
            <Text accessibilityRole="alert" style={s.muted}>
              {account.state.message}
            </Text>
          )}
          {account.state.status === 'signedOut' && (
            <>
              {account.appleAvailable && (
                <AppleSignInButton
                  dark={dark}
                  onPress={() => {
                    void account.signInWithApple();
                  }}
                />
              )}
              <Button
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
                <Text style={s.small}>Connect Apple to this account</Text>
                <AppleSignInButton
                  dark={dark}
                  connecting
                  onPress={() => {
                    void account.signInWithApple();
                  }}
                />
              </>
            )}
          {account.state.profile?.signInProviders.includes('apple') && (
            <Text style={s.small}>Apple connected</Text>
          )}
          {account.state.status === 'signingIn' && (
            <Button
              title="Cancel sign-in"
              onPress={() => {
                void account.cancel();
              }}
            />
          )}
          {account.state.status === 'storageError' && (
            <Button
              title="Retry clearing sign-in"
              onPress={() => {
                void account.signOut();
              }}
            />
          )}
          {account.state.hasSession && (
            <>
              <Button
                title="Retry account check"
                disabled={account.state.status === 'checking'}
                onPress={() => {
                  void account.retry();
                }}
              />
              <Button
                title="Sign out"
                onPress={() => {
                  void account.signOut();
                }}
              />
            </>
          )}
          <Text style={s.small}>
            Apple Health readings stay on this device. Signing in does not upload them.
          </Text>
        </>
      )}
    </View>
  );
}
