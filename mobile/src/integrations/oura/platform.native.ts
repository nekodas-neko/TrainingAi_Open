import { Linking, Platform } from 'react-native';
import { OURA_PACKAGE } from '../../features/devices/data/oura';

// Opening Oura's consent page, the Oura app and the Android settings pages its background sync
// needs. Android 11+ only lets the app see Oura because `oura-package-visibility.cjs` names its
// package in the manifest's <queries>.
export const ouraSettingsAvailable = Platform.OS === 'android';
export async function openOuraConsent(url: string, redirect: string) {
  return (await import('expo-web-browser')).openAuthSessionAsync(url, redirect);
}
async function intentLauncher() {
  try {
    return await import('expo-intent-launcher');
  } catch {
    // A build made before the module was added: fall back to plain links.
    return null;
  }
}
/** The Oura app by its package name, or its Play Store page (which offers Open) when it is not installed. */
export async function openOuraApp() {
  const urls = ['oura://'];
  if (Platform.OS === 'android') {
    const launcher = await intentLauncher();
    try {
      if (launcher) {
        launcher.openApplication(OURA_PACKAGE);
        return true;
      }
    } catch {
      // Not installed: try the links, then the store.
    }
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
export type OuraSettingsPage = 'oura-app-info' | 'device-care';
type SettingsIntent = { action: string; data?: string };
const PAGES: Record<OuraSettingsPage, SettingsIntent[]> = {
  // Oura's own App info page, where Battery and Permissions live; the app list, then Settings,
  // when this phone will not open it.
  'oura-app-info': [
    { action: 'android.settings.APPLICATION_DETAILS_SETTINGS', data: `package:${OURA_PACKAGE}` },
    { action: 'android.settings.MANAGE_APPLICATIONS_SETTINGS' },
    { action: 'android.settings.SETTINGS' },
  ],
  'device-care': [
    { action: 'android.intent.action.POWER_USAGE_SUMMARY' },
    { action: 'android.settings.SETTINGS' },
  ],
};
export async function openOuraSettings(page: OuraSettingsPage) {
  if (Platform.OS !== 'android') return false;
  const launcher = await intentLauncher();
  for (const { action, data } of PAGES[page]) {
    try {
      if (launcher) {
        // Resolves when the person comes back; throws at once when nothing handles the intent.
        await launcher.startActivityAsync(action, data ? { data } : undefined);
      } else {
        if (data) continue;
        await Linking.sendIntent(action);
      }
      return true;
    } catch {
      // Not on this phone; try the next page.
    }
  }
  return false;
}
