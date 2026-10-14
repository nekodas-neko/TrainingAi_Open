export const ouraSettingsAvailable = false;
export async function openOuraConsent(
  _url: string,
  _redirect: string,
): Promise<{ type: string; url?: string }> {
  throw new Error('Connecting Oura requires the native mobile app.');
}
export async function openOuraApp() {
  return false;
}
export type OuraSettingsPage = 'apps' | 'battery' | 'device-care';
export async function openOuraSettings(_page: OuraSettingsPage) {
  return false;
}
