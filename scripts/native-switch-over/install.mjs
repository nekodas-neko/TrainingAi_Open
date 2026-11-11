#!/usr/bin/env node
// Switch-over install wrapper (#2840). Replaces the installed com.trainingai.app with a new build
// the only safe way: `adb install -r`, after a backup of the installed APK and a full verify.
// Runbook: docs/runbooks/native-switch-over.md. Used for the native app AND for the rollback.
//
// Dry-run by default: it reads the phone (read-only: package path, pull of base.apk, and the
// installed versionCode and granted permissions from `dumpsys package`) and writes the local
// backup folder, runs every check, then prints the install command instead of running it. After a
// real install it reads the versionCode and permissions again and records both (#3722).
// A real install needs --i-have-the-owners-yes. It never runs in CI.
//
// Refused outright, whatever else is passed: uninstall, `pm clear`, and -d (downgrade). Uninstalling
// destroys the Oura ring's BLE key, which cannot be recovered.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspect, invoke, verifyUpgrade } from '../../mobile/scripts/verify-android-upgrade.mjs';

export const PACKAGE = 'com.trainingai.app';
const FORBIDDEN_WORDS = ['uninstall', 'clear', 'downgrade', '-d', '--downgrade'];

export class Refusal extends Error {}

/** Refuses the dangerous verbs anywhere in the wrapper's own arguments. */
export function guardArgs(argv) {
  for (const arg of argv) {
    const lower = String(arg).toLowerCase();
    if (FORBIDDEN_WORDS.includes(lower) || /^-d($|=)/.test(lower))
      throw new Refusal(
        `Refused "${arg}": this wrapper never uninstalls, clears data or downgrades. ` +
          'Uninstalling destroys the ring key. If an install fails, stop and tell the Orchestrator.',
      );
  }
}

export function parseArgs(argv) {
  guardArgs(argv);
  const opts = { yes: false };
  const valueFlags = {
    '--apk': 'apk', '--serial': 'serial', '--adb': 'adb', '--apksigner': 'apksigner',
    '--apkanalyzer': 'apkanalyzer', '--backup-root': 'backupRoot',
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--i-have-the-owners-yes') opts.yes = true;
    else if (valueFlags[arg]) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Refusal(`${arg} needs a value.`);
      opts[valueFlags[arg]] = value;
    } else throw new Refusal(`Unknown argument "${arg}".`);
  }
  if (!opts.apk) throw new Refusal('Provide the replacement build with --apk <file>.');
  return opts;
}

/** Every adb call goes through here, so no path can reach a destructive verb. */
export function assertSafeAdb(args) {
  const words = args.map((a) => String(a).toLowerCase());
  if (words.some((w) => ['uninstall', 'clear', '-d', '--downgrade'].includes(w)))
    throw new Refusal(`Refused adb ${args.join(' ')}: destructive.`);
  const rest = words[0] === '-s' ? words.slice(2) : words;
  if (rest[0] === 'install' && !(rest.length === 3 && rest[1] === '-r'))
    throw new Refusal('The only install allowed is: adb [-s serial] install -r <apk>.');
  // The phone's shell is where every destructive command lives (pm uninstall, pm clear, rm, am).
  // Only the two reads below may reach it, spelled exactly.
  if (rest[0] === 'shell' && !SAFE_SHELL.some((allowed) => allowed.join(' ') === rest.slice(1).join(' ')))
    throw new Refusal(`Refused adb ${args.join(' ')}: the only shell commands allowed are the two read-only ones.`);
  if (!['devices', 'shell', 'pull', 'install'].includes(rest[0]))
    throw new Refusal(`Refused adb ${args.join(' ')}: not one of devices, shell (read-only), pull, install -r.`);
}

const SAFE_SHELL = [
  ['pm', 'path', PACKAGE],
  ['dumpsys', 'package', PACKAGE],
];

/**
 * The installed versionCode and the granted permissions, from `adb shell dumpsys package <id>`.
 * Install-time and runtime grants both print as `<name>: granted=true`. Returns nulls rather than
 * throwing when the output is not in that shape: the snapshot is a record, not a gate.
 */
export function parsePackageDump(output) {
  const text = String(output ?? '');
  const code = /\bversionCode=(\d+)/.exec(text)?.[1];
  const granted = [...text.matchAll(/^\s*([\w.]+): granted=true\b/gm)].map((m) => m[1]);
  return {
    versionCode: code ? Number(code) : null,
    versionName: /\bversionName=(\S+)/.exec(text)?.[1] ?? null,
    grantedPermissions: [...new Set(granted)].sort(),
  };
}

/** What a before/after pair says: permissions the phone no longer grants, and ones it newly does. */
export function comparePhoneState(before, after) {
  const was = new Set(before.grantedPermissions);
  const now = new Set(after.grantedPermissions);
  return {
    lost: before.grantedPermissions.filter((name) => !now.has(name)),
    gained: after.grantedPermissions.filter((name) => !was.has(name)),
  };
}

export function buildAdb(serial) {
  const prefix = serial ? ['-s', serial] : [];
  return {
    devices: () => ['devices'],
    packagePath: () => [...prefix, 'shell', 'pm', 'path', PACKAGE],
    packageDump: () => [...prefix, 'shell', 'dumpsys', 'package', PACKAGE],
    pull: (remote, local) => [...prefix, 'pull', remote, local],
    install: (apk) => [...prefix, 'install', '-r', apk],
  };
}

/** Backup rules must keep the session out of Google backups (docs/native-testing.md step 5). */
export function checkBackupRules(manifestText) {
  const allow = /android:allowBackup="(true|false)"/.exec(manifestText)?.[1];
  if (allow === 'false') return [];
  const problems = [];
  if (!/android:fullBackupContent=/.test(manifestText)) problems.push('no android:fullBackupContent rules');
  if (!/android:dataExtractionRules=/.test(manifestText)) problems.push('no android:dataExtractionRules');
  return problems.length
    ? [`allowBackup is not false and the manifest has ${problems.join(' and ')}`]
    : [];
}

export function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

export function installedBasePath(output) {
  const paths = output.split('\n').map((l) => l.trim().replace(/^package:/, '')).filter(Boolean);
  const base = paths.find((p) => p.endsWith('/base.apk'));
  if (!base) throw new Refusal(`${PACKAGE} is not installed on the phone (pm path printed nothing usable).`);
  return base;
}

export function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const log = deps.log ?? console.info;
  if (env.CI || env.GITHUB_ACTIONS)
    throw new Refusal('This wrapper never runs in CI. It touches a real phone.');
  const opts = parseArgs(argv);
  const adbBin = opts.adb ?? 'adb';
  const adbRun = deps.adb ?? ((args) => execFileSync(adbBin, args, { encoding: 'utf8' }));
  const adb = (args) => {
    assertSafeAdb(args);
    return adbRun(args);
  };
  const signer = opts.apksigner ?? env.APKSIGNER ?? 'apksigner';
  const analyzer = opts.apkanalyzer ?? env.APKANALYZER ?? 'apkanalyzer';
  const doInspect = deps.inspect ?? inspect;
  const doManifest = deps.manifestPrint ?? ((apk) => invoke(analyzer, ['manifest', 'print', apk]));
  const fs = deps.fs ?? { existsSync, mkdirSync, writeFileSync, readFileSync };
  const cmd = buildAdb(opts.serial);

  const apk = resolve(opts.apk);
  if (!fs.existsSync(apk)) throw new Refusal(`The replacement APK ${apk} does not exist.`);

  // One phone only: with several attached, adb would pick for us.
  const devices = adb(cmd.devices())
    .split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
  if (opts.serial ? !devices.includes(opts.serial) : devices.length !== 1)
    throw new Refusal(
      `Expected exactly one connected phone (or --serial of one); adb sees: ${devices.join(', ') || 'none'}.`,
    );

  // 1. Back up what is installed now, and record it.
  const dir = join(resolve(opts.backupRoot ?? 'native-switch-over-backups'), stamp(deps.now ?? new Date()));
  fs.mkdirSync(dir, { recursive: true });
  const remote = installedBasePath(adb(cmd.packagePath()));
  const backupApk = join(dir, 'base.apk');
  adb(cmd.pull(remote, backupApk));
  const installed = doInspect(backupApk, signer, analyzer);
  if (installed.package !== PACKAGE) throw new Refusal(`The installed APK is ${installed.package}, not ${PACKAGE}.`);
  const replacement = doInspect(apk, signer, analyzer);
  // What the phone itself reports, before anything changes. `apk-latest` has offered newer builds
  // since the code was last read, so this is the number the replacement has to beat.
  const before = parsePackageDump(adb(cmd.packageDump()));
  if (before.versionCode === null)
    throw new Refusal('Could not read the installed versionCode from the phone (dumpsys package). Nothing was installed.');
  if (before.versionCode !== installed.versionCode)
    throw new Refusal(
      `The phone reports versionCode ${before.versionCode} but the APK pulled from it is ${installed.versionCode}. Nothing was installed.`,
    );

  // 2. Verify, before anything touches the phone.
  verifyUpgrade(installed, replacement);
  const problems = checkBackupRules(doManifest(apk));
  if (problems.length) throw new Refusal(`Backup rules: ${problems.join('; ')}. Do not install this build.`);

  const record = {
    installed: { ...installed, apkSha256: createHash('sha256').update(fs.readFileSync(backupApk)).digest('hex') },
    replacement: { ...replacement, file: apk },
    verified: ['same package', 'same signing certificate', 'higher versionCode', 'backup rules'],
    phone: { before },
  };
  const writeRecord = () => fs.writeFileSync(join(dir, 'record.json'), JSON.stringify(record, null, 2));
  writeRecord();
  log(`The phone reports versionCode ${before.versionCode} (${before.versionName ?? 'no version name'}) with ${before.grantedPermissions.length} permissions granted.`);
  log(`Backed up the installed app to ${dir} (versionCode ${installed.versionCode}, cert ${installed.certificates.join(',')}).`);
  log(`Verified: same package and certificate, versionCode ${installed.versionCode} -> ${replacement.versionCode}, backup rules ok.`);

  // 3. Install, only with the owner's yes.
  const install = cmd.install(apk);
  if (!opts.yes) {
    log(`DRY RUN. Would run: ${adbBin} ${install.join(' ')}\nRe-run with --i-have-the-owners-yes once the owner has said yes on the switch-over issue.`);
    return { installed: false, dir };
  }
  adb(install);
  // Read the phone again. The install has happened either way: a mismatch here is reported, loudly,
  // and never "fixed" by this script.
  const after = parsePackageDump(adb(cmd.packageDump()));
  const changes = comparePhoneState(before, after);
  record.phone.after = after;
  record.phone.changes = changes;
  writeRecord();
  log(`Installed with adb install -r. The phone now reports versionCode ${after.versionCode ?? 'unknown'} with ${after.grantedPermissions.length} permissions granted.`);
  if (after.versionCode !== replacement.versionCode)
    log(`WARNING: expected versionCode ${replacement.versionCode}. Stop and tell the Orchestrator; do not retry or uninstall.`);
  if (changes.lost.length) log(`No longer granted (re-grant in the runbook's "set up again" step): ${changes.lost.join(', ')}`);
  if (changes.gained.length) log(`Newly granted: ${changes.gained.join(', ')}`);
  log('Sign in, then carry on with the runbook.');
  return { installed: true, dir, before, after, changes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
