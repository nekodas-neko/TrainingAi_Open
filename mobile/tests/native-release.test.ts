import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MOBILE_CALLBACKS } from '../src/features/account/session.ts';
import {
  backupProblems,
  declaredPermissions,
  excludedPaths,
  foregroundServices,
  manifestReference,
  mergeExclusions,
  parseExclusions,
  parseNames,
  parseServices,
  permissionProblems,
  serviceTypeBits,
  xmlFromTree,
  xmlResourceName,
  xmlResourcePath,
} from '../scripts/verify-release-apk.mjs';
import { invoke } from '../scripts/verify-android-upgrade.mjs';
import { OLD_APP_CHANNELS, removeOldAppChannels } from '../src/integrations/notifications/old-app-channels.ts';

const require = createRequire(import.meta.url);
const { exclusions } = require('../src/integrations/auth/private-backups.cjs');
const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')).expo;

async function configFor(env: Record<string, string | undefined>) {
  const saved = { ...process.env };
  for (const key of ['APP_VARIANT', 'EAS_BUILD_PROFILE', 'ANDROID_VERSION_CODE']) delete process.env[key];
  Object.assign(process.env, env);
  try {
    const { default: build } = await import(`../app.config.js?${Math.random()}`);
    return build({ config: { ...appJson, plugins: [] } });
  } finally {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, saved);
  }
}

test('the android-preview profile builds the real app ID with the version code it is given', async () => {
  const config = await configFor({ EAS_BUILD_PROFILE: 'android-preview', ANDROID_VERSION_CODE: '4242' });
  assert.equal(config.android.package, 'com.trainingai.app');
  assert.equal(config.android.versionCode, 4242);
  assert.equal(config.extra.androidDevelopment, false);
  assert.equal(config.name, appJson.name);
});

test('the real app answers to the sign-in callback the server sends it to', async () => {
  const config = await configFor({ EAS_BUILD_PROFILE: 'android-preview' });
  const schemes = config.android.intentFilters.flatMap((f: { data: { scheme: string }[] }) => f.data.map((d) => d.scheme));
  assert.ok(MOBILE_CALLBACKS.android.startsWith(`${schemes[0]}:/`), 'the callback scheme is not registered');
  assert.equal(schemes[0], config.android.package);
});

test('a development or side-by-side build never takes the real ID', async () => {
  assert.equal((await configFor({})).android.package, 'com.trainingai.app.dev');
  assert.equal((await configFor({ EAS_BUILD_PROFILE: 'development' })).android.package, 'com.trainingai.app.dev');
  const side = await configFor({ APP_VARIANT: 'side-by-side', EAS_BUILD_PROFILE: 'android-preview', ANDROID_VERSION_CODE: '7' });
  assert.equal(side.android.package, 'com.trainingai.app.preview');
  assert.equal(side.android.versionCode, 7);
  assert.equal((await configFor({})).android.versionCode, undefined);
});

const FULL = `<?xml version="1.0"?>\n<full-backup-content>\n${exclusions.map(([d, p]: string[]) => `<exclude domain="${d}" path="${p}"/>`).join('\n')}\n</full-backup-content>`;
const lists = exclusions.map(([d, p]: string[]) => `<exclude domain="${d}" path="${p}"/>`).join('\n');
const EXTRACTION = `<data-extraction-rules>\n<cloud-backup>\n${lists}\n</cloud-backup>\n<device-transfer>\n${lists}\n</device-transfer>\n</data-extraction-rules>`;
const MANIFEST = '<application android:fullBackupContent="@xml/trainingai_backup_rules" android:dataExtractionRules="@xml/trainingai_data_extraction_rules">';

test('backups leave out the session token, the health database and the other private stores', () => {
  const listed = exclusions.map(([domain, path]: string[]) => `${domain}:${path}`);
  for (const entry of [
    'root:app_webview',
    'sharedpref:oura_ble.xml',
    'sharedpref:SecureStore',
    'sharedpref:SecureStore.xml',
    'sharedpref:trainingai_home_widgets.xml',
    'sharedpref:workout-status.xml',
    // fitnessai.sqlite, its -wal and -shm: expo-sqlite keeps them in filesDir/SQLite.
    'file:SQLite',
  ]) assert.ok(listed.includes(entry), `${entry} is backed up`);
});

test('the packaged-rules check passes when every exclusion is in all three lists', () => {
  assert.deepEqual(backupProblems({ manifest: MANIFEST, fullBackupXml: FULL, extractionXml: EXTRACTION, exclusions }), []);
});

test('the packaged-rules check names a missing exclusion, a missing list and a missing attribute', () => {
  const noSqlite = (xml: string) => xml.replaceAll('<exclude domain="file" path="SQLite"/>', '');
  const problems = backupProblems({ manifest: MANIFEST, fullBackupXml: noSqlite(FULL), extractionXml: noSqlite(EXTRACTION), exclusions });
  assert.equal(problems.length, 3);
  assert.ok(problems.every((p) => p.includes('file SQLite')));
  const cloudOnly = EXTRACTION.replace(/<device-transfer>[\s\S]*<\/device-transfer>/, '');
  assert.ok(backupProblems({ manifest: MANIFEST, fullBackupXml: FULL, extractionXml: cloudOnly, exclusions }).some((p) => p.includes('device-transfer')));
  const bare = backupProblems({ manifest: '<application>', fullBackupXml: '', extractionXml: '', exclusions });
  assert.ok(bare.some((p) => p.includes('fullBackupContent')) && bare.some((p) => p.includes('dataExtractionRules')));
});

test('references and paths are read from apkanalyzer and aapt2 output', () => {
  assert.equal(manifestReference(MANIFEST, 'fullBackupContent'), '@xml/trainingai_backup_rules');
  assert.equal(manifestReference('<application>', 'dataExtractionRules'), null);
  const dump = [
    'Package name=com.trainingai.app id=7f',
    '  type xml id=0e entryCount=2',
    '    resource 0x7f0e0000 xml/trainingai_backup_rules',
    '      () (file) res/Aa.xml type=XML',
    '    resource 0x7f0e0001 xml/trainingai_data_extraction_rules',
    '      () (file) res/Bb.xml type=XML',
  ].join('\n');
  assert.equal(xmlResourceName('@xml/trainingai_backup_rules', dump), 'trainingai_backup_rules');
  assert.equal(xmlResourceName('@7f0e0001', dump), 'trainingai_data_extraction_rules');
  // apkanalyzer's `manifest print` form (cmdline-tools 9.0, Nov 2026).
  assert.equal(xmlResourceName('@ref/0x7f0e0001', dump), 'trainingai_data_extraction_rules');
  assert.equal(xmlResourcePath('trainingai_backup_rules', dump), 'res/Aa.xml');
  assert.equal(xmlResourcePath('trainingai_data_extraction_rules', dump), 'res/Bb.xml');
  assert.equal(xmlResourcePath('missing', dump), null);
  assert.deepEqual(excludedPaths('<exclude path="x" domain="file" /><exclude domain="root"/>'), ['file:x']);
});

test('the workflow\'s required exclusions are parsed and held on top of the built code\'s own', () => {
  assert.deepEqual(parseExclusions('file:SQLite, sharedpref:SecureStore.xml\nroot:app_webview'), [
    ['file', 'SQLite'],
    ['sharedpref', 'SecureStore.xml'],
    ['root', 'app_webview'],
  ]);
  assert.throws(() => parseExclusions('SQLite'));
  // A ref whose plugin dropped SQLite still fails: the required floor is merged in.
  const lowered = exclusions.filter(([, path]: string[]) => path !== 'SQLite');
  const merged = mergeExclusions(parseExclusions('file:SQLite'), lowered);
  assert.ok(merged.some(([d, p]: string[]) => d === 'file' && p === 'SQLite'));
  assert.equal(merged.length, lowered.length + 1);
  const problems = backupProblems({ manifest: MANIFEST, fullBackupXml: FULL.replaceAll('<exclude domain="file" path="SQLite"/>', ''), extractionXml: EXTRACTION, exclusions: merged });
  assert.ok(problems.some((p: string) => p.includes('SQLite')));
});

// `aapt2 dump xmltree` output captured from build-tools 37.0.0 on the published Preview APK, 3 Nov
// 2026 (trimmed to two excludes per list). The packaged XML is binary, so this is the only text form.
const exclude = (indent: string, domain: string, path: string) => [
  `${indent}E: exclude (line=4)`,
  `${indent}  A: domain="${domain}" (Raw: "${domain}")`,
  `${indent}  A: path="${path}" (Raw: "${path}")`,
];
const FULL_BACKUP_TREE = [
  'E: full-backup-content (line=2)',
  ...exclude('    ', 'root', 'app_webview'),
  ...exclude('    ', 'sharedpref', 'SecureStore.xml'),
].join('\n');
const EXTRACTION_TREE = [
  'N: android=http://schemas.android.com/apk/res/android (line=2)',
  '  E: data-extraction-rules (line=2)',
  '      E: cloud-backup (line=3)',
  ...exclude('          ', 'root', 'app_webview'),
  ...exclude('          ', 'sharedpref', 'SecureStore.xml'),
  '      E: device-transfer (line=12)',
  ...exclude('          ', 'root', 'app_webview'),
  '          E: include (line=14)',
  '            A: http://schemas.android.com/apk/res/android:requireFlags(0x0101062b)=(type 0x11)0x1',
  '            A: domain="file" (Raw: "file")',
].join('\n');

test('the compiled backup rules read through aapt2 xmltree give the same exclusions as the source XML', () => {
  assert.deepEqual(excludedPaths(xmlFromTree(FULL_BACKUP_TREE)), ['root:app_webview', 'sharedpref:SecureStore.xml']);
  const xml = xmlFromTree(EXTRACTION_TREE);
  const problems = backupProblems({
    manifest: 'android:fullBackupContent="@ref/0x7f150010" android:dataExtractionRules="@ref/0x7f150011"',
    fullBackupXml: xmlFromTree(FULL_BACKUP_TREE),
    extractionXml: xml,
    exclusions: [
      ['root', 'app_webview'],
      ['sharedpref', 'SecureStore.xml'],
    ],
  });
  // device-transfer lacks SecureStore.xml in this fixture, and only there; its <include> is no exclusion.
  assert.deepEqual(problems, ['data-extraction-rules device-transfer does not exclude sharedpref SecureStore.xml.']);
  assert.equal(xmlFromTree(''), '');
});

test('a tool printing more than 1 MB is read in full, not reported as "Could not run"', () => {
  // `aapt2 dump resources` prints about 1.7 MB for the release APK.
  const out = invoke(process.execPath, ['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024))']);
  assert.equal(out.length, 3 * 1024 * 1024);
  assert.throws(() => invoke(process.execPath, ['-e', 'process.exit(3)']), /Could not run .* \(exit 3\)/);
});

// #3728: what the Capacitor app leaves in databases/ when the native app installs over it.
const OLD_DATABASES = ['trainingaiSQLite.db', 'oura_raw.db'].flatMap((name) =>
  ['', '-journal', '-wal', '-shm'].map((suffix) => `database:${name}${suffix}`),
);

test("backups leave out the old app's leftover databases, side files included", () => {
  const listed = exclusions.map(([domain, path]: string[]) => `${domain}:${path}`);
  for (const entry of OLD_DATABASES) assert.ok(listed.includes(entry), `${entry} is backed up`);
  // The name the old app's store has on disk: the plugin appends SQLite.db to `trainingai`.
  const service = readFileSync(new URL('../../lib/sqlite/sqlite-service.ts', import.meta.url), 'utf8');
  assert.match(service, /const DB_NAME = 'trainingai';/);
  const raw = readFileSync(
    new URL('../../android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt', import.meta.url),
    'utf8',
  );
  assert.match(raw, /DB_NAME = "oura_raw\.db"/);
  assert.match(raw, /getDatabasePath\(DB_NAME\)/);
});

test("the packaged-rules check fails an APK whose rules miss one of the old app's databases", () => {
  const without = (xml: string) => xml.replaceAll('<exclude domain="database" path="oura_raw.db-wal"/>', '');
  const problems = backupProblems({ manifest: MANIFEST, fullBackupXml: without(FULL), extractionXml: without(EXTRACTION), exclusions });
  assert.deepEqual(problems, [
    'full-backup-content does not exclude database oura_raw.db-wal.',
    'data-extraction-rules cloud-backup does not exclude database oura_raw.db-wal.',
    'data-extraction-rules device-transfer does not exclude database oura_raw.db-wal.',
  ]);
});

// The shape `apkanalyzer manifest print` gives: one attribute per line, the service type as a number.
const PRINTED_MANIFEST = `<manifest package="com.trainingai.app">
    <uses-permission
        android:name="android.permission.CAMERA" />
    <uses-permission
        android:name="android.permission.SYSTEM_ALERT_WINDOW" />
    <uses-permission
        android:name="android.permission.SCHEDULE_EXACT_ALARM"
        android:maxSdkVersion="32" />
    <uses-permission-sdk-23
        android:name="android.permission.BLUETOOTH_SCAN" />
    <permission
        android:name="com.trainingai.app.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION" />
    <application>
        <service
            android:name="expo.modules.location.services.LocationTaskService"
            android:exported="false"
            android:foregroundServiceType="0x8" />
        <service
            android:name="expo.modules.activityservice.ActivityForegroundService"
            android:foregroundServiceType="connectedDevice" />
        <service
            android:name="androidx.work.impl.background.systemjob.SystemJobService" />
    </application>
</manifest>`;

test('permissions and foreground services are read from the printed manifest', () => {
  assert.deepEqual(declaredPermissions(PRINTED_MANIFEST), [
    'android.permission.CAMERA',
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.SCHEDULE_EXACT_ALARM',
    'android.permission.BLUETOOTH_SCAN',
  ]);
  assert.deepEqual(
    foregroundServices(PRINTED_MANIFEST).map(({ name, bits }) => [name.split('.').pop(), bits]),
    [['LocationTaskService', 0x8], ['ActivityForegroundService', 0x10]],
  );
  assert.equal(serviceTypeBits('location|connectedDevice'), 0x18);
  assert.equal(serviceTypeBits('24'), 0x18);
  assert.equal(serviceTypeBits('teleport'), null);
  assert.throws(() => parseServices('NoType'));
  assert.throws(() => parseServices('a.B:teleport'));
});

test('the permission check names a missing permission, a forbidden one and a wrong or missing service', () => {
  const services = parseServices(
    'expo.modules.location.services.LocationTaskService:location expo.modules.activityservice.ActivityForegroundService:connectedDevice',
  );
  const permissions = ['android.permission.CAMERA', 'android.permission.SYSTEM_ALERT_WINDOW'];
  assert.deepEqual(permissionProblems({ manifest: PRINTED_MANIFEST, permissions, services }), []);
  // "Display over other apps" gone, as it would be if Expo's template stopped declaring it.
  const noOverlay = PRINTED_MANIFEST.replace(/<uses-permission\s+android:name="android.permission.SYSTEM_ALERT_WINDOW" \/>/, '');
  assert.deepEqual(permissionProblems({ manifest: noOverlay, permissions, services }), [
    'The manifest does not declare the permission android.permission.SYSTEM_ALERT_WINDOW.',
  ]);
  assert.deepEqual(permissionProblems({ manifest: PRINTED_MANIFEST, forbidden: ['android.permission.CAMERA'] }), [
    'The manifest declares android.permission.CAMERA, which this app must not ask for.',
  ]);
  const wrongType = PRINTED_MANIFEST.replace('"0x8"', '"0x1"').replace(/<service\s+android:name="expo.modules.activityservice[^>]*>/, '');
  assert.deepEqual(permissionProblems({ manifest: wrongType, services }), [
    'The foreground service expo.modules.location.services.LocationTaskService has type 0x1, not location.',
    'The manifest has no foreground service expo.modules.activityservice.ActivityForegroundService.',
  ]);
});

const workflow = readFileSync(new URL('../../.github/workflows/native-release.yml', import.meta.url), 'utf8');
const pinnedBlock = (name: string) =>
  parseNames(workflow.match(new RegExp(`^  ${name}: \\|\\n((?: {4}\\S+\\n)+)`, 'm'))?.[1] ?? '');

test("the workflow's permission floor covers everything our own config and modules declare", async () => {
  const pinned = new Set(pinnedBlock('REQUIRED_PERMISSIONS'));
  assert.ok(pinned.has('android.permission.SYSTEM_ALERT_WINDOW'), '"Display over other apps" is not pinned');
  // Granted on old Android only, or implied there: the floor names what Android 12+ asks for.
  const legacy = new Set(['android.permission.BLUETOOTH', 'android.permission.BLUETOOTH_ADMIN', 'android.permission.SCHEDULE_EXACT_ALARM']);
  const config = await configFor({ EAS_BUILD_PROFILE: 'android-preview' });
  const modules = ['activity-service', 'app-handoff', 'workout-status'].flatMap((name) =>
    declaredPermissions(readFileSync(new URL(`../modules/${name}/android/src/main/AndroidManifest.xml`, import.meta.url), 'utf8')),
  );
  assert.ok(modules.includes('android.permission.SYSTEM_ALERT_WINDOW'), 'only the Expo template declares the overlay permission');
  for (const name of [...config.android.permissions, ...modules]) {
    assert.ok(pinned.has(name) || legacy.has(name), `${name} is declared but not pinned in native-release.yml`);
  }
  assert.deepEqual(pinnedBlock('FORBIDDEN_PERMISSIONS'), ['android.permission.ACCESS_BACKGROUND_LOCATION']);
  assert.ok(!pinned.has('android.permission.ACCESS_BACKGROUND_LOCATION'));
});

test("the workflow's foreground services are the two the code declares", () => {
  const services = parseServices(pinnedBlock('REQUIRED_FOREGROUND_SERVICES').join(' '));
  assert.deepEqual(services, [
    ['expo.modules.location.services.LocationTaskService', 'location'],
    ['expo.modules.activityservice.ActivityForegroundService', 'connectedDevice'],
  ]);
  const ours = readFileSync(new URL('../modules/activity-service/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.deepEqual(permissionProblems({ manifest: ours, services: [services[1]] }), []);
  const location = readFileSync(new URL('../node_modules/expo-location/android/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  assert.match(location, /android:name="\.services\.LocationTaskService"[\s\S]*?android:foregroundServiceType="location"/);
});

// #3728: the old app's notification channels, deleted by the real app only.
test("the old app's channels are deleted once, on the real app ID only, and never one the native app posts to", async () => {
  const run = async (applicationId: string | null, present: string[], failing: string[] = []) => {
    const deleted: string[] = [];
    let lists = 0;
    const removed = await removeOldAppChannels({
      applicationId,
      list: async () => (lists++, present.map((id) => ({ id }))),
      remove: async (id) => {
        if (failing.includes(id)) throw new Error('refused');
        deleted.push(id);
      },
    });
    return { removed, deleted, lists };
  };
  const onPhone = ['meal-reminders', 'scale-ble-v2', 'health-alerts', 'training-timers', 'training-reminders'];
  const first = await run('com.trainingai.app', onPhone);
  assert.deepEqual(first.deleted, ['meal-reminders', 'scale-ble-v2']);
  assert.deepEqual(first.removed, first.deleted);
  // The second start finds none of them and deletes nothing.
  assert.deepEqual((await run('com.trainingai.app', ['health-alerts', 'training-timers'])).deleted, []);
  // Preview and the Dev build never had them: the list is not even read.
  for (const id of ['com.trainingai.app.preview', 'com.trainingai.app.dev', null]) {
    assert.deepEqual(await run(id, onPhone), { removed: [], deleted: [], lists: 0 });
  }
  // One refusal does not stop the rest, and an unreadable list deletes nothing.
  assert.deepEqual((await run('com.trainingai.app', onPhone, ['meal-reminders'])).removed, ['scale-ble-v2']);
  assert.deepEqual(
    await removeOldAppChannels({ applicationId: 'com.trainingai.app', list: async () => { throw new Error('x'); }, remove: async () => undefined }),
    [],
  );
});

test("the old-channel list matches the old app's code and shares no id with the native app's channels", () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const quoted = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((m) => m[1]);
  const old = new Set([
    ...['lib/notifications.ts', 'lib/meal-reminders.ts', 'lib/supplement-reminders.ts', 'lib/day-review-reminders.ts', 'lib/workout-reminders.ts']
      .flatMap((path) => quoted(read(path), /_CHANNEL = '([^']+)'/g)),
    ...['MainActivity.java', 'oura/OuraRingService.kt', 'scale/ScaleBleService.kt', 'polar/PolarStrapService.kt']
      .flatMap((path) => quoted(read(`android/app/src/main/java/com/trainingai/app/${path}`), /CHANNEL_ID = "([^"]+)"/g)),
  ]);
  assert.deepEqual([...OLD_APP_CHANNELS].sort(), [...old].sort());
  const native = [
    ...quoted(read('mobile/src/integrations/notifications/platform.native.ts'), /(?:setNotificationChannelAsync\(|channelId: )'([^']+)'/g),
    ...quoted(read('mobile/modules/activity-service/android/src/main/java/expo/modules/activityservice/ActivityNotification.kt'), /CHANNEL_ID = "([^"]+)"/g),
    ...quoted(read('mobile/modules/workout-status/android/src/main/java/expo/modules/workoutstatus/WorkoutStatusNotifier.kt'), /CHANNEL_ID = "([^"]+)"/g),
  ];
  assert.ok(native.includes('health-alerts') && native.length >= 6);
  for (const id of native) assert.ok(!OLD_APP_CHANNELS.includes(id), `${id} is a native channel and would be deleted`);
});
