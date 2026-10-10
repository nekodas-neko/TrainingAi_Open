import { useEffect, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import * as AppleAuthentication from 'expo-apple-authentication';

export function AppleSignInButton({
  onPress,
  connecting = false,
}: {
  onPress(): void;
  connecting?: boolean;
}) {
  const { theme } = useTheme();
  const dark = theme.mode === 'dark';
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let active = true;
    void AppleAuthentication.isAvailableAsync()
      .then((value) => {
        if (active) {
          setAvailable(value);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (!available) {
    return null;
  }
  return (
    <AppleAuthentication.AppleAuthenticationButton
      onPress={onPress}
      buttonType={
        connecting
          ? AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
          : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
      }
      buttonStyle={
        dark
          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
      }
      cornerRadius={theme.radii.control}
      style={{ height: theme.sizes.button, width: '100%' }}
    />
  );
}
