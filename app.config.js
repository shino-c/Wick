module.exports = {
  expo: {
    name: 'Wick',
    slug: 'wick',
    version: '1.0.0',
    orientation: 'portrait',
    scheme: 'wick',
    userInterfaceStyle: 'light',
    backgroundColor: '#FFFBEB',
    newArchEnabled: true,
    splash: {
      backgroundColor: '#FFFBEB',
      resizeMode: 'contain',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: false,
      bundleIdentifier: 'my.codenection.wick',
      infoPlist: {
        // VisionCamera 5 ships no config plugin, so the usage description is
        // declared here directly rather than through plugin props.
        NSCameraUsageDescription:
          'Wick reads your heart-rate variability from the camera during focus sessions and finger spot checks. Frames are analysed on your device and discarded immediately — nothing is recorded, saved, or uploaded.',
        UIBackgroundModes: [],
      },
    },
    android: {
      package: 'my.codenection.wick',
      adaptiveIcon: { backgroundColor: '#FFFBEB' },
      permissions: ['android.permission.CAMERA'],
      blockedPermissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.READ_MEDIA_VIDEO',
        'android.permission.WRITE_EXTERNAL_STORAGE',
      ],
    },
    plugins: [
      'expo-dev-client',
      'expo-font',
      [
        'expo-build-properties',
        {
          // Nitro modules (VisionCamera 5's runtime) need a modern toolchain.
          android: { minSdkVersion: 26, compileSdkVersion: 36, targetSdkVersion: 36 },
          ios: { deploymentTarget: '16.4' },
        },
      ],
    ],
  },
};
