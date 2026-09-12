/**
 * metro.config.js
 *
 * Only one thing is customised here, and it exists for one reason.
 *
 * Expo Router web server-renders the app first (app.json sets
 * `"web": { "output": "static" }`). During that pass there is no `window`, but
 * `@react-native-async-storage/async-storage` resolves to a web build that is a
 * bare wrapper around `window.localStorage` — and Supabase Auth reads its
 * persisted session at module scope, so importing src/lib/supabaseClient.ts was
 * enough to crash the server render with:
 *
 *     ReferenceError: window is not defined
 *
 * The fix is to hand web a drop-in replacement that guards every access
 * (src/lib/webAsyncStorage.ts). It is scoped to `platform === 'web'` so Android
 * and iOS keep resolving the real, native-backed AsyncStorage untouched.
 *
 * To remove this later: delete this file and src/lib/webAsyncStorage.ts. Nothing
 * else in the app depends on either.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const ASYNC_STORAGE = '@react-native-async-storage/async-storage';

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === ASYNC_STORAGE) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/lib/webAsyncStorage.ts'),
    };
  }

  // Everything else resolves exactly as Expo configured it.
  return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
