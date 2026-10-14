const { withAndroidManifest } = require('expo/config-plugins');

// Android 11+ hides other apps from this one unless the manifest names them in <queries>. "Sync
// now" opens Oura by its package name, which needs Oura to be visible. The morning hand-off
// (#2909) names the same package from its own module's manifest; Gradle merges the two, and this
// plugin adds the entry only when the app manifest does not already have it, so re-running
// prebuild or landing both never lists it twice here.
const OURA_PACKAGE = 'com.ouraring.oura';

function addPackageQuery(manifest, packageName) {
  const root = manifest.manifest;
  const queries = (root.queries = root.queries ?? []);
  const listed = queries.some((query) =>
    (query.package ?? []).some((entry) => entry.$?.['android:name'] === packageName),
  );
  if (listed) return manifest;
  if (queries.length === 0) queries.push({});
  queries[0].package = [...(queries[0].package ?? []), { $: { 'android:name': packageName } }];
  return manifest;
}

module.exports = function withOuraPackageVisibility(config) {
  return withAndroidManifest(config, (mod) => {
    addPackageQuery(mod.modResults, OURA_PACKAGE);
    return mod;
  });
};
module.exports.addPackageQuery = addPackageQuery;
module.exports.OURA_PACKAGE = OURA_PACKAGE;
