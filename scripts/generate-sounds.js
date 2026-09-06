/**
 * generate-sounds — writes the White Noise & Soundscapes loops used by Desk Mode.
 *
 * Run once after `npm install`:  npm run gen:sounds
 *
 * The generated .wav files ARE committed, so a fresh clone bundles without
 * anyone remembering to run this. Re-run it only to change the sounds; nothing
 * here needs licensing. Each file is a seamless 8-second loop: coloured
 * noise shaped per soundscape, then cross-faded head-to-tail so expo-av's
 * isLooping playback has no audible seam.
 */
const fs = require('fs');
const path = require('path');

const SR = 22050;
const SECONDS = 8;
const XFADE = Math.floor(SR * 0.5);
const OUT = path.join(__dirname, '..', 'assets', 'sounds');

let seed = 12345;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed / 0x7fffffff) * 2 - 1;
}

/** One-pole lowpass. alpha closer to 1 = darker. */
function lowpass(input, alpha) {
  const out = new Float64Array(input.length);
  let prev = 0;
  for (let i = 0; i < input.length; i++) {
    prev = prev * alpha + input[i] * (1 - alpha);
    out[i] = prev;
  }
  return out;
}

function highpass(input, alpha) {
  const lp = lowpass(input, alpha);
  return input.map((v, i) => v - lp[i]);
}

function whiteNoise(n) {
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = rand();
  return out;
}

const SOUNDSCAPES = {
  // Broadband hiss with sparse droplet transients on top.
  rain: (n) => {
    const base = highpass(lowpass(whiteNoise(n), 0.55), 0.995);
    for (let i = 0; i < n; i++) {
      if (rand() > 0.9993) {
        const len = Math.floor(SR * 0.03);
        for (let j = 0; j < len && i + j < n; j++) {
          base[i + j] += 0.6 * rand() * Math.exp(-j / (len * 0.3));
        }
      }
    }
    return base;
  },
  // Brown noise swelling on a slow 0.09 Hz breath — roughly a wave period.
  ocean: (n) => {
    const brown = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc = acc * 0.995 + rand() * 0.05;
      brown[i] = acc;
    }
    const shaped = lowpass(brown, 0.3);
    return shaped.map((v, i) => {
      const swell = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 0.09 * i) / SR));
      return v * 12 * swell;
    });
  },
  // Airy, quiet, with a soft high shimmer standing in for leaves.
  forest: (n) => {
    const bed = lowpass(whiteNoise(n), 0.9);
    const leaves = highpass(whiteNoise(n), 0.7);
    return bed.map((v, i) => {
      const gust = 0.5 + 0.5 * Math.sin((2 * Math.PI * 0.06 * i) / SR + 1.2);
      return v * 2.2 + leaves[i] * 0.12 * gust;
    });
  },
  // Steady motor hum plus bearing hiss — the classic focus fan.
  fan: (n) => {
    const hiss = lowpass(whiteNoise(n), 0.75);
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const hum =
        0.22 * Math.sin((2 * Math.PI * 110 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 55 * i) / SR);
      out[i] = hum + hiss[i] * 0.55;
    }
    return out;
  },
};

function normalise(buf, peak = 0.72) {
  let max = 0;
  for (const v of buf) max = Math.max(max, Math.abs(v));
  if (max === 0) return buf;
  const g = peak / max;
  return Float64Array.from(buf, (v) => v * g);
}

/** Cross-fade the tail into the head so the loop point is inaudible. */
function makeSeamless(buf) {
  const n = buf.length - XFADE;
  const out = new Float64Array(n);
  out.set(buf.subarray(0, n));
  for (let i = 0; i < XFADE; i++) {
    const t = i / XFADE;
    out[i] = out[i] * t + buf[n + i] * (1 - t);
  }
  return out;
}

function writeWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    data.writeInt16LE(Math.round(clipped * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SR, 24);
  header.writeUInt32LE(SR * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, data]));
}

fs.mkdirSync(OUT, { recursive: true });
const n = SR * SECONDS;
for (const [name, make] of Object.entries(SOUNDSCAPES)) {
  const file = path.join(OUT, `${name}.wav`);
  writeWav(file, makeSeamless(normalise(make(n))));
  console.log(`  ${name.padEnd(7)} -> assets/sounds/${name}.wav  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}
console.log('\nSoundscapes ready.');
