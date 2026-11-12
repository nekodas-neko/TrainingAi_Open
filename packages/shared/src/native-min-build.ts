// #3724. The oldest native app (`mobile/`) build the server still supports, as an Android
// versionCode. null means no minimum: every installed build keeps working.
//
// Raised only by a PR, never by an environment variable, so the number in force is always the one
// in the released code. `/api/version` serves it as `minSupportedNativeBuild`; a native build below
// it shows one blocking "too old" notice with the download link. Raise it only after the build
// that replaces the old one is published, or the notice points at nothing newer.
export const MIN_SUPPORTED_NATIVE_BUILD: number | null = null

/**
 * The headers the native app sends on every call: its versionCode and versionName, read from the
 * installed APK. The server treats both as untrusted text.
 */
export const APP_BUILD_HEADER = 'X-App-Build'
export const APP_VERSION_HEADER = 'X-App-Version'
