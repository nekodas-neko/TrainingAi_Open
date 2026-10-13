import { requireOptionalNativeModule } from 'expo';
export async function keepAwake(tag: string, enabled: boolean) {
  if (!requireOptionalNativeModule('ExpoKeepAwake')) return;
  const awake = await import('expo-keep-awake');
  if (enabled) await awake.activateKeepAwakeAsync(tag);
  else await awake.deactivateKeepAwake(tag);
}
