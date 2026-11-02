#!/usr/bin/env node
// Switch-over install wrapper (#2840). Replaces the installed com.trainingai.app with a new build
// the only safe way: `adb install -r`, after a backup of the installed APK and a full verify.
// Runbook: docs/runbooks/native-switch-over.md. Used for the native app AND for the rollback.
//
// Dry-run by default: it reads the phone (read-only: package path, pull of base.apk) and writes the
// local backup folder, runs every check, then prints the install command instead of running it.
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
}

export function buildAdb(serial) {
  const prefix = serial ? ['-s', serial] : [];
  return {
    devices: () => ['devices'],
    packagePath: () => [...prefix, 'shell', 'pm', 'path', PACKAGE],
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

  // 2. Verify, before anything touches the phone.
  verifyUpgrade(installed, replacement);
  const problems = checkBackupRules(doManifest(apk));
  if (problems.length) throw new Refusal(`Backup rules: ${problems.join('; ')}. Do not install this build.`);

  fs.writeFileSync(
    join(dir, 'record.json'),
    JSON.stringify(
      {
        installed: { ...installed, apkSha256: createHash('sha256').update(fs.readFileSync(backupApk)).digest('hex') },
        replacement: { ...replacement, file: apk },
        verified: ['same package', 'same signing certificate', 'higher versionCode', 'backup rules'],
      },
      null,
      2,
    ),
  );
  log(`Backed up the installed app to ${dir} (versionCode ${installed.versionCode}, cert ${installed.certificates.join(',')}).`);
  log(`Verified: same package and certificate, versionCode ${installed.versionCode} -> ${replacement.versionCode}, backup rules ok.`);

  // 3. Install, only with the owner's yes.
  const install = cmd.install(apk);
  if (!opts.yes) {
    log(`DRY RUN. Would run: ${adbBin} ${install.join(' ')}\nRe-run with --i-have-the-owners-yes once the owner has said yes on the switch-over issue.`);
    return { installed: false, dir };
  }
  adb(install);
  log('Installed with adb install -r. Sign in, then run the smoke checks in the runbook.');
  return { installed: true, dir };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
