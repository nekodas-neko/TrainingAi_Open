// Checks a built release APK before native-release.yml uploads it (#2840, docs/native-testing.md).
// Every check fails the job: a wrong package, certificate or version code would give the owner an
// APK that cannot install over the app on the phone, and missing backup rules would send the
// session token and the health database to Google.
//
//   node scripts/verify-release-apk.mjs --apk app.apk --package com.trainingai.app \
//     --version-code 123 --cert <sha256> --require-exclusions "root:app_webview file:SQLite ..."
//
// --require-exclusions is the floor the workflow pins itself (`domain:path`, separated by spaces,
// commas or newlines): the APK must carry all of them in all three lists, on top of whatever the
// built code's private-backups.cjs lists. It is required, so a ref cannot lower the floor.
//
// Tools come from --apksigner / --apkanalyzer / --aapt2 or APKSIGNER / APKANALYZER / AAPT2.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect, invoke } from './verify-android-upgrade.mjs';

const require = createRequire(import.meta.url);

/** The `@xml/<name>` (or `@<hex id>`) an attribute of the merged manifest points at. */
export function manifestReference(manifest, attribute) {
  const match = manifest.match(new RegExp(`android:${attribute}="(@[^"]+)"`));
  return match ? match[1] : null;
}

/** The resource name (`trainingai_backup_rules`) behind a reference, using `aapt2 dump resources`. */
export function xmlResourceName(reference, resourcesDump) {
  if (!reference) return null;
  const named = reference.match(/^@xml\/(.+)$/);
  if (named) return named[1];
  const id = reference.match(/^@(?:0x)?([0-9a-f]{8})$/i);
  if (!id) return null;
  const line = resourcesDump
    .split('\n')
    .find((entry) => new RegExp(`resource 0x${id[1]} xml/`, 'i').test(entry));
  return line ? line.replace(/^.*xml\//, '').trim() : null;
}

/** The packaged path of `xml/<name>` (the release build may shorten it) from `aapt2 dump resources`. */
export function xmlResourcePath(name, resourcesDump) {
  const lines = resourcesDump.split('\n');
  const at = lines.findIndex((line) => new RegExp(`resource 0x[0-9a-f]+ xml/${name}\\s*$`, 'i').test(line));
  if (at < 0) return null;
  for (const line of lines.slice(at + 1, at + 6)) {
    const file = line.match(/\(file\)\s+(\S+\.xml)/);
    if (file) return file[1];
    if (/resource 0x/.test(line)) break;
  }
  return null;
}

/** Every `<exclude domain= path=>` in an XML fragment, as `domain:path` strings. */
export function excludedPaths(xml) {
  return [...xml.matchAll(/<exclude\b([^>]*)>/g)]
    .map(([, attributes]) => {
      const domain = attributes.match(/\bdomain="([^"]*)"/)?.[1];
      const path = attributes.match(/\bpath="([^"]*)"/)?.[1];
      return domain && path ? `${domain}:${path}` : null;
    })
    .filter(Boolean);
}

/** The part of a data-extraction-rules file inside one section, or '' when it has none. */
export function section(xml, name) {
  return xml.match(new RegExp(`<${name}\\b[\\s\\S]*?</${name}>`))?.[0] ?? '';
}

/** `domain:path` entries (separated by whitespace or commas) as [domain, path] pairs. */
export function parseExclusions(text) {
  return String(text ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((entry) => {
      const at = entry.indexOf(':');
      if (at < 1 || at === entry.length - 1) throw new Error(`Bad required exclusion '${entry}', expected domain:path.`);
      return [entry.slice(0, at), entry.slice(at + 1)];
    });
}

/** The required exclusions plus the built code's own, without repeats. */
export function mergeExclusions(required, own) {
  const seen = new Map();
  for (const [domain, path] of [...required, ...own]) seen.set(`${domain}:${path}`, [domain, path]);
  return [...seen.values()];
}

/** The problems with a packaged backup configuration; empty when every exclusion is in all three lists. */
export function backupProblems({ manifest, fullBackupXml, extractionXml, exclusions }) {
  const problems = [];
  const lists = [
    ['full-backup-content', excludedPaths(fullBackupXml ?? '')],
    ['data-extraction-rules cloud-backup', excludedPaths(section(extractionXml ?? '', 'cloud-backup'))],
    ['data-extraction-rules device-transfer', excludedPaths(section(extractionXml ?? '', 'device-transfer'))],
  ];
  if (!manifestReference(manifest, 'fullBackupContent')) problems.push('The manifest has no android:fullBackupContent.');
  if (!manifestReference(manifest, 'dataExtractionRules')) problems.push('The manifest has no android:dataExtractionRules.');
  for (const [domain, path] of exclusions) {
    for (const [label, found] of lists) {
      if (!found.includes(`${domain}:${path}`)) problems.push(`${label} does not exclude ${domain} ${path}.`);
    }
  }
  return problems;
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function main() {
  const apk = resolve(option('--apk', ''));
  const expectedPackage = option('--package', 'com.trainingai.app');
  const expectedCode = Number(option('--version-code'));
  const expectedCert = String(option('--cert', '')).replace(/:/g, '').toUpperCase();
  const signer = option('--apksigner', process.env.APKSIGNER ?? 'apksigner');
  const analyzer = option('--apkanalyzer', process.env.APKANALYZER ?? 'apkanalyzer');
  const aapt2 = option('--aapt2', process.env.AAPT2 ?? 'aapt2');
  const required = parseExclusions(option('--require-exclusions', ''));
  if (!required.length) throw new Error('--require-exclusions is required: the workflow pins the backup floor.');
  if (!Number.isSafeInteger(expectedCode) || expectedCode < 1) throw new Error('--version-code must be a positive integer.');
  if (!/^[A-F0-9]{64}$/.test(expectedCert)) throw new Error('--cert must be a SHA-256 digest.');

  const failures = [];
  const built = inspect(apk, signer, analyzer);
  if (built.package !== expectedPackage) failures.push(`The package is ${built.package}, not ${expectedPackage}.`);
  if (built.versionCode !== expectedCode) failures.push(`The version code is ${built.versionCode}, not ${expectedCode}.`);
  if (built.certificates.length !== 1 || built.certificates[0] !== expectedCert) {
    failures.push(`The certificate is ${built.certificates.join(', ')}, not ${expectedCert}.`);
  }

  const manifest = invoke(analyzer, ['manifest', 'print', apk]);
  const resources = invoke(aapt2, ['dump', 'resources', apk]);
  const read = (attribute) => {
    const name = xmlResourceName(manifestReference(manifest, attribute), resources);
    const path = name && xmlResourcePath(name, resources);
    return path ? invoke(analyzer, ['files', 'cat', '--file', path, apk]) : '';
  };
  const { exclusions: own } = require('../src/integrations/auth/private-backups.cjs');
  const exclusions = mergeExclusions(required, own);
  failures.push(
    ...backupProblems({
      manifest,
      fullBackupXml: read('fullBackupContent'),
      extractionXml: read('dataExtractionRules'),
      exclusions,
    }),
  );

  if (failures.length) {
    for (const failure of failures) console.error(`::error::${failure}`);
    process.exitCode = 1;
    return;
  }
  console.info(
    JSON.stringify({ package: built.package, versionCode: built.versionCode, certificate: built.certificates[0], backupExclusions: exclusions.length }, null, 2),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  }
}
