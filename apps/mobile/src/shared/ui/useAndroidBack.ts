import { useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
export function useAndroidBack(onBack?: () => void) {
  const action = useRef(onBack);
  action.current = onBack;
  const enabled = !!onBack;
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      action.current?.();
      return true;
    });
    return () => listener.remove();
  }, [enabled]);
}
