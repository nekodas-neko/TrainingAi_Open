// Checks a built release APK before native-release.yml uploads it (#2840, docs/native-testing.md).
// Every check fails the job: a wrong package, certificate or version code would give the owner an
// APK that cannot install over the app on the phone, and missing backup rules would send the
// session token and the health database to Google.
//
//   node scripts/verify-release-apk.mjs --apk app.apk --package com.trainingai.app \
//     --version-code 123 --cert <sha256> --require-exclusions "root:app_webview file:SQLite ..." \
//     --require-permissions "android.permission.CAMERA ..." \
//     --require-foreground-services "expo.modules.location.services.LocationTaskService:location ..."
//
// --require-exclusions is the floor the workflow pins itself (`domain:path`, separated by spaces,
// commas or newlines): the APK must carry all of them in all three lists, on top of whatever the
// built code's private-backups.cjs lists. It is required, so a ref cannot lower the floor.
//
// --require-permissions and --require-foreground-services are the workflow's second floor (#3722):
// every permission named must be a <uses-permission> of the merged manifest, and every
// `class:type` must be a <service> declared with that foreground-service type. A permission that
// goes missing (a library or the Expo template stops declaring it) would otherwise show up as a
// setting the owner can no longer grant. --forbid-permissions names ones that must be absent.
// Both are floors, not the whole list: the APK may declare more, and the output prints all of it.
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
  // apkanalyzer prints an unresolved reference as `@ref/0x7f150010`; older tools print `@7f150010`.
  const id = reference.match(/^@(?:ref\/)?(?:0x)?([0-9a-f]{8})$/i);
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

/**
 * The text XML behind `aapt2 dump xmltree --file <path> <apk>`. A packaged resource XML is compiled
 * binary, so `apkanalyzer files cat` returns bytes no text match can read; aapt2 prints it as an
 * indented tree (`E: exclude (line=3)` / `A: domain="root" (Raw: "root")`). Only elements and
 * quoted plain attributes come back, which is all `excludedPaths` and `section` read.
 */
export function xmlFromTree(dump) {
  const out = [];
  const open = [];
  let pending = null;
  const flush = () => {
    if (!pending) return;
    out.push(`<${pending.name}${pending.attributes.map(([key, value]) => ` ${key}="${value}"`).join('')}>`);
    open.push(pending);
    pending = null;
  };
  for (const line of String(dump).split(/\r?\n/)) {
    const element = line.match(/^(\s*)E: ([\w.:-]+)/);
    if (element) {
      flush();
      const indent = element[1].length;
      while (open.length && open[open.length - 1].indent >= indent) out.push(`</${open.pop().name}>`);
      pending = { name: element[2], indent, attributes: [] };
      continue;
    }
    const attribute = line.match(/^\s*A: ([\w-]+)="([^"]*)"/);
    if (attribute && pending) pending.attributes.push([attribute[1], attribute[2]]);
  }
  flush();
  while (open.length) out.push(`</${open.pop().name}>`);
  return out.join('\n');
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

/** Whitespace- or comma-separated names. */
export function parseNames(text) {
  return String(text ?? '').split(/[\s,]+/).filter(Boolean);
}

/** Every `<uses-permission>` (and `-sdk-23`) name in `apkanalyzer manifest print` output. */
export function declaredPermissions(manifest) {
  return [
    ...new Set(
      [...String(manifest).matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*?\bandroid:name="([^"]+)"/g)].map(
        ([, name]) => name,
      ),
    ),
  ];
}

// android.content.pm.ServiceInfo's FOREGROUND_SERVICE_TYPE_* bits. apkanalyzer prints the packaged
// attribute as a number (`0x8`); a source manifest spells it (`location|connectedDevice`).
const SERVICE_TYPE_BITS = {
  dataSync: 0x1,
  mediaPlayback: 0x2,
  phoneCall: 0x4,
  location: 0x8,
  connectedDevice: 0x10,
  mediaProjection: 0x20,
  camera: 0x40,
  microphone: 0x80,
  health: 0x100,
  remoteMessaging: 0x200,
  systemExempted: 0x400,
  shortService: 0x800,
  mediaProcessing: 0x2000,
  specialUse: 0x40000000,
};

/** A foregroundServiceType value as its bits, or null when it names a type this script does not know. */
export function serviceTypeBits(value) {
  const text = String(value ?? '').trim();
  if (/^0x[0-9a-f]+$/i.test(text)) return Number.parseInt(text, 16);
  if (/^\d+$/.test(text)) return Number(text);
  let bits = 0;
  for (const name of text.split('|').map((part) => part.trim()).filter(Boolean)) {
    if (!Object.hasOwn(SERVICE_TYPE_BITS, name)) return null;
    bits |= SERVICE_TYPE_BITS[name];
  }
  return text ? bits : null;
}

/**
 * Every `<service>` with a foreground-service type.
 * @returns {{ name: string, type: string, bits: number | null }[]}
 */
export function foregroundServices(manifest) {
  const found = [];
  for (const [, attributes] of String(manifest).matchAll(/<service\b([^>]*)>/g)) {
    const name = attributes.match(/\bandroid:name="([^"]+)"/)?.[1];
    const type = attributes.match(/\bandroid:foregroundServiceType="([^"]+)"/)?.[1];
    if (name && type) found.push({ name, type, bits: serviceTypeBits(type) });
  }
  return found;
}

/** `class:type` entries (separated by whitespace or commas) as [class, type] pairs. */
export function parseServices(text) {
  return parseNames(text).map((entry) => {
    const at = entry.lastIndexOf(':');
    if (at < 1 || at === entry.length - 1) throw new Error(`Bad required service '${entry}', expected class:type.`);
    const type = entry.slice(at + 1);
    if (serviceTypeBits(type) === null) throw new Error(`Unknown foreground-service type '${type}' in '${entry}'.`);
    return [entry.slice(0, at), type];
  });
}

/**
 * The problems with the manifest's permissions and foreground services; empty when every floor holds.
 * @param {{ manifest: string, permissions?: string[], forbidden?: string[], services?: string[][] }} input
 */
export function permissionProblems({ manifest, permissions = [], forbidden = [], services = [] }) {
  const problems = [];
  const declared = new Set(declaredPermissions(manifest));
  for (const name of permissions) {
    if (!declared.has(name)) problems.push(`The manifest does not declare the permission ${name}.`);
  }
  for (const name of forbidden) {
    if (declared.has(name)) problems.push(`The manifest declares ${name}, which this app must not ask for.`);
  }
  const found = foregroundServices(manifest);
  for (const [name, type] of services) {
    const service = found.find((entry) => entry.name === name);
    const wanted = serviceTypeBits(type);
    if (!service) problems.push(`The manifest has no foreground service ${name}.`);
    else if (service.bits === null || (service.bits & wanted) !== wanted) {
      problems.push(`The foreground service ${name} has type ${service.type}, not ${type}.`);
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
  const permissions = parseNames(option('--require-permissions', ''));
  if (!permissions.length) throw new Error('--require-permissions is required: the workflow pins the permission floor.');
  const services = parseServices(option('--require-foreground-services', ''));
  if (!services.length) throw new Error('--require-foreground-services is required: the workflow pins the services.');
  const forbidden = parseNames(option('--forbid-permissions', ''));
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
  failures.push(...permissionProblems({ manifest, permissions, forbidden, services }));
  const resources = invoke(aapt2, ['dump', 'resources', apk]);
  const read = (attribute) => {
    const name = xmlResourceName(manifestReference(manifest, attribute), resources);
    const path = name && xmlResourcePath(name, resources);
    return path ? xmlFromTree(invoke(aapt2, ['dump', 'xmltree', '--file', path, apk])) : '';
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
    JSON.stringify(
      {
        package: built.package,
        versionCode: built.versionCode,
        certificate: built.certificates[0],
        backupExclusions: exclusions.length,
        permissions: declaredPermissions(manifest).sort(),
        foregroundServices: foregroundServices(manifest).map(({ name, type }) => `${name}:${type}`),
      },
      null,
      2,
    ),
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
