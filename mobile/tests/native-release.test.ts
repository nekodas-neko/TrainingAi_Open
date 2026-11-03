import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MOBILE_CALLBACKS } from '../src/features/account/session.ts';
import {
  backupProblems,
  excludedPaths,
  manifestReference,
  mergeExclusions,
  parseExclusions,
  xmlFromTree,
  xmlResourceName,
  xmlResourcePath,
} from '../scripts/verify-release-apk.mjs';
import { invoke } from '../scripts/verify-android-upgrade.mjs';

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
