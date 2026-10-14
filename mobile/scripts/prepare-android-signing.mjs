import { writeFileSync } from 'node:fs';
import { resolveAndroidSigning } from './android-signing.mjs';
const signing = resolveAndroidSigning(process.env);
writeFileSync('android-signing.keystore', signing.bytes, { mode: 0o600 });
writeFileSync('credentials.json', JSON.stringify({ android: { keystore: {
  keystorePath: 'android-signing.keystore', keystorePassword: signing.keystorePassword,
  keyAlias: signing.keyAlias, keyPassword: signing.keyPassword,
} } }), { mode: 0o600 });

