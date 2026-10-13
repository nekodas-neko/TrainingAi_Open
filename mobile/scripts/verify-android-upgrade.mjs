import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}
function invoke(tool, args) {
  const options = { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    if (tool.endsWith('.jar')) return execFileSync('java', ['-jar', tool, ...args], options);
    if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(tool)) {
      const values = [tool, ...args];
      if (values.some((value) => /[%!^&|<>"\r\n]/.test(value)))
        throw new Error('Use SDK/APK paths without shell control characters.');
      return execFileSync(
        'cmd.exe',
        ['/d', '/s', '/c', '"' + values.map((value) => '"' + value + '"').join(' ') + '"'],
        options,
      );
    }
    return execFileSync(tool, args, options);
  } catch {
    throw new Error(
      `Could not run ${tool}. Install Android SDK command-line/build tools, and check that the APK is valid.`,
    );
  }
}
function inspect(apk, signer, analyzer) {
  if (!apk || !existsSync(apk)) throw new Error('Provide an existing APK file.');
  const output = invoke(signer, ['verify', '--print-certs', resolve(apk)]);
  const certificates = [
    ...new Set(
      [...output.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([a-f0-9]+)/gi)].map(
        (match) => match[1].toUpperCase(),
      ),
    ),
  ].sort();
  if (!certificates.length || certificates.some((value) => !/^[A-F0-9]{64}$/.test(value)))
    throw new Error('Could not identify the verified APK signing certificates.');
  const versionCode = Number(
    invoke(analyzer, ['manifest', 'version-code', resolve(apk)]).trim(),
  );
  if (!Number.isSafeInteger(versionCode) || versionCode < 1)
    throw new Error('The APK has an invalid version code.');
  return {
    certificates,
    package: invoke(analyzer, ['manifest', 'application-id', resolve(apk)]).trim(),
    versionCode,
  };
}
function main() {
  const signer = option('--apksigner', process.env.APKSIGNER ?? 'apksigner');
  const analyzer = option('--apkanalyzer', process.env.APKANALYZER ?? 'apkanalyzer');
  const existing = inspect(option('--existing'), signer, analyzer);
  const expectedPackage = option('--package', 'com.trainingai.app');
  if (
    !['com.trainingai.app', 'com.trainingai.app.dev'].includes(expectedPackage) ||
    existing.package !== expectedPackage
  )
    throw new Error('The baseline APK has the wrong TrainingAi package ID.');
  const candidate = option('--replacement');
  if (!candidate) {
    console.info(JSON.stringify(existing, null, 2));
    return;
  }
  const replacement = inspect(candidate, signer, analyzer);
  verifyUpgrade(existing, replacement);
  console.info(
    JSON.stringify(
      {
        binaryUpgradeCompatible: true,
        dataMigrationVerified: false,
        package: replacement.package,
        versionCode: replacement.versionCode,
        certificates: replacement.certificates,
      },
      null,
      2,
    ),
  );
}
export function verifyUpgrade(existing, replacement) {
  if (!Number.isSafeInteger(existing.versionCode) || existing.versionCode < 1)
    throw new Error('The baseline APK has an invalid version code.');
  if (existing.package !== replacement.package)
    throw new Error('The replacement uses a different package ID.');
  if (
    !existing.certificates.length ||
    existing.certificates.join(',') !== replacement.certificates.join(',')
  )
    throw new Error(
      'The replacement has a different signing certificate. Do not uninstall the existing app to work around this.',
    );
  if (
    !Number.isSafeInteger(replacement.versionCode) ||
    replacement.versionCode <= existing.versionCode
  )
    throw new Error('The replacement must use a version code higher than the existing APK.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
