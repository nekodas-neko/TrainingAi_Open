export function resolveAndroidSigning(env) {
  const legacy = !env.KEYSTORE_B64 && !!env.LEGACY_KEYSTORE_B64;
  const base64 = legacy ? env.LEGACY_KEYSTORE_B64 : env.KEYSTORE_B64;
  const keystorePassword = legacy ? 'android' : env.KEYSTORE_PASSWORD;
  const keyAlias = legacy ? 'androiddebugkey' : env.KEY_ALIAS;
  const keyPassword = legacy ? 'android' : env.KEY_PASSWORD;
  if (!base64 || !keystorePassword || !keyAlias || !keyPassword) {
    throw new Error('Configure the existing Android signing credentials before building.');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new Error('The existing Android keystore is empty or malformed.');
  return { bytes, keystorePassword, keyAlias, keyPassword };
}
