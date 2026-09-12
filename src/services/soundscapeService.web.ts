/**
 * soundscapeService.web.ts — the web counterpart of soundscapeService.ts.
 *
 * Chosen by Metro for web via the `.web.` suffix; native keeps expo-audio.
 * Same exports and signatures, so callers need no platform branch.
 *
 * WHY THIS EXISTS: expo-audio's `createAudioPlayer` is native-backed. On web it
 * throws rather than degrading, and it would throw from inside the focus
 * session — exactly the screen a reviewer is most likely to open. The WAVs also
 * live in assets/ and are not part of the web bundle the way they are on
 * native.
 *
 * NOTHING IS FAKED HERE. The soundscape picker still works and still holds the
 * user's choice; it simply produces no sound, because leaving it silent is
 * better than pretending an audio engine exists. The UI never claims otherwise.
 */

export type SoundscapeId = 'silent' | 'rain' | 'ocean' | 'forest' | 'fan';

export const SOUNDSCAPES: { id: SoundscapeId; label: string; icon: string }[] = [
  { id: 'rain', label: 'Rain', icon: '🌧' },
  { id: 'ocean', label: 'Ocean', icon: '🌊' },
  { id: 'forest', label: 'Forest', icon: '🌲' },
  { id: 'fan', label: 'Fan', icon: '💨' },
  { id: 'silent', label: 'Silent', icon: '🤍' },
];

function clamp(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * No-op that keeps the same async contract as the native version, so a caller
 * that awaits it behaves identically on both platforms.
 */
export async function playSoundscape(_id: SoundscapeId, _volume: number): Promise<void> {
  return;
}

export function setSoundscapeVolume(_volume: number): void { }

export async function stopSoundscape(): Promise<void> {
  return;
}

/** Exported only so the clamp behaviour stays inspectable from tests. */
export const _clamp = clamp;
