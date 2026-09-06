/**
 * soundscapeService — White Noise & Soundscapes for focus sessions (Pillar 2).
 *
 * Loops are short generated WAVs (see scripts/generate-sounds.js) rather than
 * streamed audio: no network during a session, no licensing, and a tiny memory
 * footprint.
 *
 * Uses expo-audio, which replaced expo-av from SDK 54 onward. Its player is a
 * synchronous object rather than an async handle, so the whole module gets
 * simpler: create, set `loop`, set `volume`, `play()`, `remove()`.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

export type SoundscapeId = 'silent' | 'rain' | 'ocean' | 'forest' | 'fan';

export const SOUNDSCAPES: { id: SoundscapeId; label: string; icon: string }[] = [
  { id: 'rain', label: 'Rain', icon: '🌧' },
  { id: 'ocean', label: 'Ocean', icon: '🌊' },
  { id: 'forest', label: 'Forest', icon: '🌲' },
  { id: 'fan', label: 'Fan', icon: '💨' },
  { id: 'silent', label: 'Silent', icon: '🤍' },
];

const SOURCES: Record<Exclude<SoundscapeId, 'silent'>, number> = {
  rain: require('../../assets/sounds/rain.wav'),
  ocean: require('../../assets/sounds/ocean.wav'),
  forest: require('../../assets/sounds/forest.wav'),
  fan: require('../../assets/sounds/fan.wav'),
};

let player: AudioPlayer | null = null;
let current: SoundscapeId = 'silent';
let configured = false;

async function configure() {
  if (configured) return;
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    // A focus soundscape should sit under whatever else the user has running,
    // not seize the audio session from it.
    interruptionMode: 'mixWithOthers',
  });
  configured = true;
}

export async function playSoundscape(id: SoundscapeId, volume: number): Promise<void> {
  if (id === current && player) {
    player.volume = clamp(volume);
    return;
  }
  await stopSoundscape();
  current = id;
  if (id === 'silent') return;

  await configure();
  const next = createAudioPlayer(SOURCES[id]);
  next.loop = true;
  next.volume = clamp(volume);
  next.play();
  player = next;
}

export function setSoundscapeVolume(volume: number): void {
  if (player) player.volume = clamp(volume);
}

export async function stopSoundscape(): Promise<void> {
  if (!player) return;
  const p = player;
  player = null;
  current = 'silent';
  try {
    p.pause();
    p.remove();
  } catch {
    // Already released — nothing to do.
  }
}

function clamp(v: number) {
  return Math.max(0, Math.min(1, v));
}
