module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      ['module-resolver', { alias: { '@': './src' } }],
      // Reanimated 4 no longer ships its own babel plugin — worklet transforms
      // moved to react-native-worklets, and this must stay last in the list.
      'react-native-worklets/plugin',
    ],
  };
};
