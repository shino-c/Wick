/**
 * verify-ppg — sanity-checks the hand-written SciPy port in src/services/dsp.ts
 * against synthetic pulse signals of known heart rate.
 *
 *   node --experimental-strip-types scripts/verify-ppg.mjs
 *   (or just `npm run verify:ppg` on Node >= 23, where stripping is on by default)
 *
 * Run this before trusting Desk Mode's enforced-break lock: that lock fires off
 * these numbers, and a mis-designed filter would shift every BPM silently.
 */
import { butterBandpass, filtfilt, findPeaks } from '../src/services/dsp.ts';

const FPS = 30;

/** Synthetic finger-PPG: DC offset + slow drift + pulse train + sensor noise. */
function synth(bpm, seconds, { noise = 0.0, jitterMs = 0 } = {}) {
  const n = Math.round(FPS * seconds);
  const out = [];
  let phase = 0;
  let rng = 42;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;

  for (let i = 0; i < n; i++) {
    const t = i / FPS;
    const period = 60 / bpm + (jitterMs / 1000) * rand();
    phase += 1 / (FPS * period);
    // Sharp systolic upstroke + dicrotic notch, roughly PPG-shaped.
    const pulse =
      Math.sin(2 * Math.PI * phase) + 0.35 * Math.sin(4 * Math.PI * phase + 0.9);
    const drift = 0.6 * Math.sin(2 * Math.PI * 0.05 * t); // breathing / hand drift
    out.push(128 + 4 * pulse + drift + noise * rand());
  }
  return out;
}

function heartRateOf(signal, fps) {
  const mean = signal.reduce((a, b) => a + b, 0) / signal.length;
  const filtered = filtfilt(butterBandpass(4, 0.7, 3.5, fps), signal.map((v) => v - mean));
  const peaks = findPeaks(filtered, Math.floor(fps * 0.4), 0.01);
  const ibi = [];
  for (let i = 1; i < peaks.length; i++) ibi.push(((peaks[i] - peaks[i - 1]) / fps) * 1000);
  const valid = ibi.filter((v) => v > 300 && v < 2000);
  const meanIbi = valid.reduce((a, b) => a + b, 0) / valid.length;
  const diffs = valid.slice(1).map((v, i) => v - valid[i]);
  return {
    bpm: 60000 / meanIbi,
    rmssd: Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length),
    peaks: peaks.length,
  };
}

const cases = [
  { bpm: 55, seconds: 30, opts: {} },
  { bpm: 72, seconds: 30, opts: {} },
  { bpm: 95, seconds: 30, opts: {} },
  { bpm: 120, seconds: 20, opts: {} },
  { bpm: 72, seconds: 30, opts: { noise: 0.5 } },
  { bpm: 72, seconds: 30, opts: { noise: 0.3, jitterMs: 40 } },
  { bpm: 72, seconds: 12, opts: {} }, // one rPPG burst length
];

let failures = 0;
console.log('  expected   measured   err     rmssd    peaks   case');
for (const { bpm, seconds, opts } of cases) {
  const r = heartRateOf(synth(bpm, seconds, opts), FPS);
  const err = Math.abs(r.bpm - bpm);
  const ok = err <= 3; // ±3 BPM tolerance
  if (!ok) failures++;
  const tag = Object.keys(opts).length ? JSON.stringify(opts) : 'clean';
  console.log(
    `${ok ? '  ok ' : '  FAIL'}  ${String(bpm).padStart(5)}   ${r.bpm.toFixed(1).padStart(8)}   ${err
      .toFixed(1)
      .padStart(4)}   ${r.rmssd.toFixed(1).padStart(6)}   ${String(r.peaks).padStart(4)}   ${seconds}s ${tag}`
  );
}

// The bandpass must actually reject out-of-band energy.
const dcOnly = new Array(FPS * 20).fill(0).map((_, i) => 100 + 5 * Math.sin(2 * Math.PI * 0.1 * (i / FPS)));
const rejected = filtfilt(
  butterBandpass(4, 0.7, 3.5, FPS),
  dcOnly.map((v) => v - 100)
);
const residual = Math.max(...rejected.slice(FPS * 2, -FPS * 2).map(Math.abs));
const bandOk = residual < 0.2;
if (!bandOk) failures++;
console.log(`\n  ${bandOk ? 'ok  ' : 'FAIL'} 0.1 Hz drift attenuated to ${residual.toFixed(4)} (< 0.2)`);

console.log(failures === 0 ? '\nAll PPG checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
