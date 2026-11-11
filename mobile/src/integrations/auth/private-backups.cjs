const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const exclusions = [
  ['root', 'app_webview'],
  // The health database: expo-sqlite opens fitnessai.sqlite (and its -wal and -shm) in
  // filesDir/SQLite. The owner chose to keep it out of Google backups.
  ['file', 'SQLite'],
  ['sharedpref', 'oura_ble.xml'],
  ['sharedpref', 'SecureStore'],
  ['sharedpref', 'SecureStore.xml'],
  ['sharedpref', 'trainingai_home_widgets.xml'],
  ['sharedpref', 'workout-status.xml'],
  // What the Capacitor app leaves behind when the native app installs over it (#3728). Both sit
  // in databases/: its health store (@capacitor-community/sqlite names `trainingai` as
  // trainingaiSQLite.db, unencrypted) and the ring's raw archive. The native app never opens
  // them, and they stay on the phone until the rollback window closes, so they are named here to
  // keep them out of Google backups meanwhile. Each SQLite side file is its own path.
  ...['trainingaiSQLite.db', 'oura_raw.db'].flatMap((name) =>
    ['', '-journal', '-wal', '-shm'].map((suffix) => ['database', `${name}${suffix}`]),
  ),
];
const xml = exclusions
  .map(([domain, path]) => `    <exclude domain="${domain}" path="${path}" />`)
  .join('\n');
module.exports = function withPrivateBackups(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults);
    app.$['android:fullBackupContent'] = '@xml/trainingai_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/trainingai_data_extraction_rules';
    return mod;
  });
  return withDangerousMod(config, [
    'android',
    (mod) => {
      const directory = join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        join(directory, 'trainingai_backup_rules.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${xml}\n</full-backup-content>\n`,
      );
      writeFileSync(
        join(directory, 'trainingai_data_extraction_rules.xml'),
        `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${xml}\n  </cloud-backup>\n  <device-transfer>\n${xml}\n  </device-transfer>\n</data-extraction-rules>\n`,
      );
      return mod;
    },
  ]);
};
module.exports.exclusions = exclusions;
