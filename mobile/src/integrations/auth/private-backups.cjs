const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const exclusions = [
  ['root', 'app_webview'],
  ['sharedpref', 'oura_ble.xml'],
  ['sharedpref', 'SecureStore'],
  ['sharedpref', 'SecureStore.xml'],
  ['sharedpref', 'trainingai_home_widgets.xml'],
  ['sharedpref', 'workout-status.xml'],
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
