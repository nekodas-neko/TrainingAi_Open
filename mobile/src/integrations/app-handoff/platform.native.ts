import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import type { AppHandoff } from './types';

// Absent on iOS and on builds made before the module existed.
export const appHandoff: AppHandoff | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<AppHandoff>('AppHandoff') : null;
// The hand-off test buttons show in the development and side-by-side builds, never in the real app.
export const handoffDebugAvailable =
  !!appHandoff &&
  requireOptionalNativeModule<{ applicationId: string }>('ExpoApplication')?.applicationId !==
    'com.trainingai.app';
