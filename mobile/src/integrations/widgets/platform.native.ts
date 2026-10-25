import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { guardHomeWidgets, type GuardedHomeWidgets } from './guarded';
import type { HomeWidgets } from './types';

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<HomeWidgets>('HomeWidgets') : null;

// Absent on iOS and on builds made before the module existed.
export const homeWidgets: GuardedHomeWidgets | null = native ? guardHomeWidgets(native) : null;
