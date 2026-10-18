import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { isHandoffDebugBuild } from './debug-builds';
import type { AppHandoff } from './types';

// Absent on iOS and on builds made before the module existed.
export const appHandoff: AppHandoff | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<AppHandoff>('AppHandoff') : null;
// The hand-off test buttons show only in the Dev build (see debug-builds.ts), so a missing
// application id hides them rather than showing them in the real app.
const applicationId =
  requireOptionalNativeModule<{ applicationId: string }>('ExpoApplication')?.applicationId;
export const handoffDebugAvailable = !!appHandoff && isHandoffDebugBuild(applicationId);
