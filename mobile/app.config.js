// Each Android build has its own application ID, so it installs beside the others instead of
// replacing one (docs/native-testing.md):
//   com.trainingai.app          the real app: only ever installed at the switch-over
//                               (EAS_BUILD_PROFILE=android-preview, built by native-release.yml)
//   com.trainingai.app.dev      development builds
//   com.trainingai.app.preview  the side-by-side build the owner runs next to the real app
//                               (APP_VARIANT=side-by-side, built by native-side-by-side.yml)
const mobileConfig = ({ config }) => {
  const sideBySide = process.env.APP_VARIANT === 'side-by-side';
  const development =
    !sideBySide &&
    (!process.env.EAS_BUILD_PROFILE ||
      ['development', 'android-development'].includes(process.env.EAS_BUILD_PROFILE));
  const packageName = sideBySide
    ? 'com.trainingai.app.preview'
    : development
      ? 'com.trainingai.app.dev'
      : 'com.trainingai.app';
  // Android refuses to install an update with a lower version code. The side-by-side build takes
  // a rising number from CI, and the real-ID release build takes the one native-release.yml is
  // given (it must beat the installed app's). A development build keeps the default.
  const versionCode = development ? undefined : Number(process.env.ANDROID_VERSION_CODE) || undefined;
  return {
    ...config,
    ...(sideBySide ? { name: 'TrainingAi Preview' } : {}),
    android: {
      ...config.android,
      package: packageName,
      ...(versionCode ? { versionCode } : {}),
      permissions: [
        'android.permission.health.READ_SLEEP',
        'android.permission.health.READ_HEART_RATE',
        'android.permission.health.READ_RESTING_HEART_RATE',
        'android.permission.health.READ_HEART_RATE_VARIABILITY',
        'android.permission.health.READ_STEPS',
        'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
        'android.permission.health.READ_WEIGHT',
        'android.permission.health.READ_EXERCISE',
        'android.permission.health.READ_HEALTH_DATA_HISTORY',
      ],
      intentFilters: [
        {
          action: 'VIEW',
          category: ['BROWSABLE', 'DEFAULT'],
          data: [{ scheme: packageName }],
        },
      ],
    },
    extra: { ...config.extra, androidDevelopment: development },
    plugins: [
      ...config.plugins,
      'react-native-health-connect',
      [
        'expo-build-properties',
        { android: { minSdkVersion: 26, usesCleartextTraffic: development } },
      ],
    ],
  };
};

export default mobileConfig;
