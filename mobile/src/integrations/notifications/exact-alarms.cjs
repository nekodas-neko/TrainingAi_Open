const { withAndroidManifest } = require('expo/config-plugins');

// expo-notifications sets an exact alarm only when the app may (canScheduleExactAlarms); otherwise
// Doze can hold a rest-complete alert for minutes (#3062). Same pair as the current app's manifest:
// USE_EXACT_ALARM is granted at install on Android 13+, SCHEDULE_EXACT_ALARM covers 12 and 12L.
// If the phone still refuses, expo falls back to an inexact alarm and the in-app cue is unchanged.
const EXACT_ALARM_PERMISSIONS = [
  { 'android:name': 'android.permission.USE_EXACT_ALARM' },
  { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM', 'android:maxSdkVersion': '32' },
];

function addExactAlarmPermissions(manifest) {
  const root = manifest.manifest;
  const permissions = (root['uses-permission'] = root['uses-permission'] ?? []);
  for (const wanted of EXACT_ALARM_PERMISSIONS) {
    const existing = permissions.find(
      (entry) => entry.$?.['android:name'] === wanted['android:name'],
    );
    if (existing) existing.$ = { ...existing.$, ...wanted };
    else permissions.push({ $: { ...wanted } });
  }
  return manifest;
}

module.exports = function withExactAlarms(config) {
  return withAndroidManifest(config, (mod) => {
    addExactAlarmPermissions(mod.modResults);
    return mod;
  });
};
module.exports.addExactAlarmPermissions = addExactAlarmPermissions;
