import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const credentials = JSON.parse(readFileSync(resolve('credentials.json'), 'utf8')).android
  .keystore;
const expected = (process.env.ANDROID_EXPECTED_CERT_SHA256 ?? '')
  .replace(/:/g, '')
  .toLowerCase();
if (!/^[a-f0-9]{64}$/.test(expected))
  throw new Error('Configure the installed Android signing certificate SHA-256.');
const result = spawnSync(
  'keytool',
  [
    '-exportcert',
    '-alias',
    credentials.keyAlias,
    '-keystore',
    credentials.keystorePath,
    '-storepass:env',
    'ANDROID_VERIFY_STORE_PASSWORD',
  ],
  {
    env: { ...process.env, ANDROID_VERIFY_STORE_PASSWORD: credentials.keystorePassword },
    windowsHide: true,
  },
);
if (result.status !== 0)
  throw new Error('Could not inspect the configured Android signing certificate.');
const actual = new X509Certificate(result.stdout).fingerprint256
  .replace(/:/g, '')
  .toLowerCase();
if (actual !== expected)
  throw new Error('Signing certificate differs from the installed Android app. Build stopped.');
console.info('Android signing certificate matches the installed app.');
