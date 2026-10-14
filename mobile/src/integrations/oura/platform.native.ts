import { Linking, Platform } from 'react-native';
import { OURA_PACKAGE } from '../../features/devices/data/oura';

// Opening Oura's consent page, the Oura app and the Android settings pages its background sync needs.
export const ouraSettingsAvailable = Platform.OS === 'android';
export async function openOuraConsent(url: string, redirect: string) {
  return (await import('expo-web-browser')).openAuthSessionAsync(url, redirect);
}
/** The Oura app, or on Android its Play Store page (which offers Open) when no link reaches it. */
export async function openOuraApp() {
  const urls = ['oura://'];
  if (Platform.OS === 'android') {
    urls.push(
      `market://details?id=${OURA_PACKAGE}`,
      `https://play.google.com/store/apps/details?id=${OURA_PACKAGE}`,
    );
  }
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      // Try the next one.
    }
  }
  return false;
}
export type OuraSettingsPage = 'apps' | 'battery' | 'device-care';
const ACTIONS: Record<OuraSettingsPage, string[]> = {
  apps: ['android.settings.MANAGE_APPLICATIONS_SETTINGS'],
  battery: [
    'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    'android.settings.MANAGE_APPLICATIONS_SETTINGS',
  ],
  'device-care': ['android.intent.action.POWER_USAGE_SUMMARY', 'android.settings.SETTINGS'],
};
export async function openOuraSettings(page: OuraSettingsPage) {
  if (Platform.OS !== 'android') return false;
  for (const action of ACTIONS[page]) {
    try {
      await Linking.sendIntent(action);
      return true;
    } catch {
      // Not on this phone; try the next page.
    }
  }
  return false;
}
