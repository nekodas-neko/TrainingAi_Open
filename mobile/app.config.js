const mobileConfig = ({ config }) => {
  const development = !process.env.EAS_BUILD_PROFILE || ['development', 'android-development'].includes(process.env.EAS_BUILD_PROFILE);
  const packageName = development ? 'com.trainingai.app.dev' : 'com.trainingai.app';
  return {
    ...config,
    android: {
      ...config.android,
      package: packageName,
      permissions: [
        'android.permission.health.READ_SLEEP',
        'android.permission.health.READ_HEART_RATE',
        'android.permission.health.READ_RESTING_HEART_RATE',
        'android.permission.health.READ_HEART_RATE_VARIABILITY',
        'android.permission.health.READ_STEPS',
        'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
        'android.permission.health.READ_WEIGHT',
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
