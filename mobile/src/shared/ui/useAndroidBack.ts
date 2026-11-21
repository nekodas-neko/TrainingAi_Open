import { createContext, useContext, useEffect, useRef } from 'react';
import { BackHandler, Platform } from 'react-native';
/** False inside a layer that is drawn but not the active one (a screen sliding out). */
export const BackLayerContext = createContext(true);
export function useAndroidBack(onBack?: () => void) {
  const layerActive = useContext(BackLayerContext);
  const action = useRef(onBack);
  action.current = onBack;
  const enabled = !!onBack && layerActive;
  useEffect(() => {
    if (Platform.OS !== 'android' || !enabled) return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      action.current?.();
      return true;
    });
    return () => listener.remove();
  }, [enabled]);
}
