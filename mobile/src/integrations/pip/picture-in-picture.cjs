const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

// The workout's picture-in-picture window (#3064) needs MainActivity to declare support, as the
// current app's manifest does. Resizing into and out of the window also changes the screen size
// classes, so those must be handled config changes or Android recreates the activity and the
// workout screen reloads. Running prebuild again changes nothing.
const PIP_CONFIG_CHANGES = ['orientation', 'screenSize', 'smallestScreenSize', 'screenLayout'];

function enablePictureInPicture(manifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
  activity.$['android:supportsPictureInPicture'] = 'true';
  const current = (activity.$['android:configChanges'] ?? '').split('|').filter(Boolean);
  const missing = PIP_CONFIG_CHANGES.filter((change) => !current.includes(change));
  if (missing.length) activity.$['android:configChanges'] = [...current, ...missing].join('|');
  return manifest;
}

module.exports = function withPictureInPicture(config) {
  return withAndroidManifest(config, (mod) => {
    enablePictureInPicture(mod.modResults);
    return mod;
  });
};
module.exports.enablePictureInPicture = enablePictureInPicture;
module.exports.PIP_CONFIG_CHANGES = PIP_CONFIG_CHANGES;
