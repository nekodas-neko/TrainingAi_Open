import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';

export function AppleSignInButton({
  onPress,
  connecting = false,
  dark,
}: {
  onPress(): void;
  connecting?: boolean;
  dark: boolean;
}) {
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
      cornerRadius={6}
      style={{ height: 44, width: '100%' }}
    />
  );
}
