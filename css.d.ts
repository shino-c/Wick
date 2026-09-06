// expo-router's web target lets a stylesheet be imported for its side effects
// (src/constants/theme.ts does this with global.css). TypeScript needs to be
// told those imports exist; without this the whole project fails to typecheck.
declare module '*.css';
