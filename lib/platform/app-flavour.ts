/**
 * Which Android build this is, told from the Capacitor app ID (`App.getInfo().id`), which the web
 * layer already has: no new native call.
 *
 * #2390. TrainingAi Dev (`com.trainingai.app.dev`, #2367) installs beside the real app, but the
 * update card and Download APK read the rolling `apk-latest` release, whose APK is the REAL app's
 * (`com.trainingai.app`). Tapping it inside the Dev app offered the real app as its "update". The
 * ring's BLE key is safe (same signing key), but it bypasses the release train's "update the APK
 * only when the release says so". The Dev flavour shows neither entry.
 */
export const DEV_APP_ID = 'com.trainingai.app.dev'

/** True only for the Dev flavour. An unknown or missing ID is NOT dev: the real app, and the web
 *  build, keep today's behaviour. */
export function isDevAppId(appId: string | null | undefined): boolean {
  return appId === DEV_APP_ID
}
