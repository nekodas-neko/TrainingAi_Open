import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { createReducedMotionStore } from './reducedMotionStore';

// Created when the app's code loads, so the phone has answered before most screens mount.
const store = createReducedMotionStore({
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  watch: (onChange) => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', onChange);
    return () => subscription.remove();
  },
});

export function useReducedMotion() {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
