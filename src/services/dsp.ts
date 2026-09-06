/**
 * dsp.ts — minimal DSP kernel for Wick's PPG pipeline.
 *
 * This is a direct port of the three SciPy calls the FYP service relied on:
 *   scipy.signal.butter(order, [low, high], btype='band')   -> butterBandpass()
 *   scipy.signal.filtfilt(b, a, x)                          -> filtfilt()
 *   scipy.signal.find_peaks(x, distance=..., prominence=...) -> findPeaks()
 *
 * Written from scratch rather than pulled from `fili`, because fili's bandpass
 * is parameterised by centre-frequency + bandwidth, which is only an
 * approximation of butter()'s [low, high] cutoffs — and the enforced-break
 * lock in Desk Mode depends on these numbers being trustworthy.
 * `npm run verify:ppg` checks the port against synthetic signals of known BPM.
 */

/* ── complex helpers ──────────────────────────────────────────────── */

type C = { re: number; im: number };

const c = (re: number, im = 0): C => ({ re, im });
const cadd = (a: C, b: C): C => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a: C, b: C): C => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a: C, b: C): C => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cscale = (a: C, s: number): C => ({ re: a.re * s, im: a.im * s });

function cdiv(a: C, b: C): C {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

/** Principal square root of a complex number. */
function csqrt(a: C): C {
  const m = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (m + a.re) / 2));
  const im = Math.sign(a.im || 1) * Math.sqrt(Math.max(0, (m - a.re) / 2));
  return { re, im };
}

const cexpI = (theta: number): C => ({ re: Math.cos(theta), im: Math.sin(theta) });

/** Coefficients (highest power first) of the monic polynomial with these roots. */
function polyFromRoots(roots: C[]): C[] {
  let coeffs: C[] = [c(1)];
  for (const r of roots) {
    const next: C[] = new Array(coeffs.length + 1).fill(null).map(() => c(0));
    for (let i = 0; i < coeffs.length; i++) {
      next[i] = cadd(next[i], coeffs[i]);
      next[i + 1] = csub(next[i + 1], cmul(coeffs[i], r));
    }
    coeffs = next;
  }
  return coeffs;
}

/* ── filter design ────────────────────────────────────────────────── */

export interface Filter {
  b: number[];
  a: number[];
}

/**
 * Digital Butterworth bandpass, equivalent to
 * `scipy.signal.butter(order, [lowHz, highHz] / nyquist, btype='band')`.
 * The resulting filter is order*2 (an order-4 design gives 8 poles).
 */
export function butterBandpass(order: number, lowHz: number, highHz: number, fs: number): Filter {
  const nyq = fs / 2;
  const wLow = Math.min(Math.max(lowHz / nyq, 1e-6), 0.99);
  const wHigh = Math.min(Math.max(highHz / nyq, wLow + 1e-6), 0.99);

  // Pre-warp for the bilinear transform (SciPy normalises to fs = 2).
  const warpedLow = 4 * Math.tan((Math.PI * wLow) / 2);
  const warpedHigh = 4 * Math.tan((Math.PI * wHigh) / 2);

  // Analog Butterworth lowpass prototype: poles only, unit gain.
  const protoPoles: C[] = [];
  for (let m = -order + 1; m < order; m += 2) {
    const e = cexpI((Math.PI * m) / (2 * order));
    protoPoles.push(c(-e.re, -e.im));
  }

  // Lowpass -> bandpass.
  const bw = warpedHigh - warpedLow;
  const wo = Math.sqrt(warpedLow * warpedHigh);
  const bpPoles: C[] = [];
  for (const p of protoPoles) {
    const pl = cscale(p, bw / 2);
    const root = csqrt(csub(cmul(pl, pl), c(wo * wo)));
    bpPoles.push(cadd(pl, root), csub(pl, root));
  }
  const bpZeros: C[] = new Array(order).fill(null).map(() => c(0));
  const kBp = Math.pow(bw, order);

  // Bilinear transform (fs = 2 -> fs2 = 4).
  const fs2 = 4;
  const toZ = (s: C) => cdiv(c(fs2 + s.re, s.im), c(fs2 - s.re, -s.im));
  const zZeros = bpZeros.map(toZ);
  const zPoles = bpPoles.map(toZ);
  for (let i = 0; i < bpPoles.length - bpZeros.length; i++) zZeros.push(c(-1));

  let num = c(1);
  let den = c(1);
  for (const z of bpZeros) num = cmul(num, c(fs2 - z.re, -z.im));
  for (const p of bpPoles) den = cmul(den, c(fs2 - p.re, -p.im));
  const kZ = kBp * cdiv(num, den).re;

  const b = polyFromRoots(zZeros).map((x) => x.re * kZ);
  const a = polyFromRoots(zPoles).map((x) => x.re);
  return { b, a };
}

/* ── filtering ────────────────────────────────────────────────────── */

/** Single-pass IIR, direct form II transposed (equivalent to scipy.signal.lfilter). */
export function lfilter({ b, a }: Filter, x: number[]): number[] {
  const n = Math.max(b.length, a.length);
  const bb = [...b, ...new Array(n - b.length).fill(0)];
  const aa = [...a, ...new Array(n - a.length).fill(0)];
  const a0 = aa[0];
  const z = new Array(n - 1).fill(0);
  const y = new Array(x.length).fill(0);

  for (let i = 0; i < x.length; i++) {
    const out = (bb[0] * x[i]) / a0 + z[0];
    for (let j = 1; j < n - 1; j++) {
      z[j - 1] = (bb[j] * x[i]) / a0 + z[j] - (aa[j] / a0) * out;
    }
    z[n - 2] = (bb[n - 1] * x[i]) / a0 - (aa[n - 1] / a0) * out;
    y[i] = out;
  }
  return y;
}

/**
 * Zero-phase forward-and-reverse filtering, matching scipy.signal.filtfilt's
 * default odd padding (padlen = 3 * max(len(a), len(b)) - 1).
 *
 * Note: SciPy additionally seeds each pass with lfilter_zi-derived initial
 * conditions. We rely on the odd padding alone to absorb the start-up
 * transient, which leaves interior samples — the only ones peak detection
 * cares about — effectively identical. verify:ppg guards this.
 */
export function filtfilt(filter: Filter, x: number[]): number[] {
  const padlen = Math.min(3 * Math.max(filter.a.length, filter.b.length) - 1, x.length - 1);
  if (padlen <= 0) return lfilter(filter, x);

  const head: number[] = [];
  for (let i = padlen; i >= 1; i--) head.push(2 * x[0] - x[i]);
  const tail: number[] = [];
  for (let i = 2; i <= padlen + 1; i++) tail.push(2 * x[x.length - 1] - x[x.length - i]);

  const ext = [...head, ...x, ...tail];
  const forward = lfilter(filter, ext);
  const backward = lfilter(filter, [...forward].reverse()).reverse();
  return backward.slice(padlen, padlen + x.length);
}

/* ── peak detection ───────────────────────────────────────────────── */

/**
 * Port of scipy.signal.find_peaks with `distance` and `prominence` set:
 * local maxima (plateau-aware) -> prominence filter -> greedy distance filter
 * that keeps the tallest peaks first.
 */
export function findPeaks(x: number[], distance: number, minProminence: number): number[] {
  const candidates: number[] = [];
  let i = 1;
  while (i < x.length - 1) {
    if (x[i] > x[i - 1]) {
      let j = i;
      while (j < x.length - 1 && x[j + 1] === x[i]) j++;
      if (x[j] > x[j + 1]) candidates.push(Math.floor((i + j) / 2));
      i = j + 1;
    } else {
      i++;
    }
  }

  const kept = candidates.filter((p) => prominence(x, p) >= minProminence);
  if (distance <= 1) return kept;

  const byHeight = [...kept].sort((p, q) => x[q] - x[p]);
  const keep = new Set(kept);
  for (const p of byHeight) {
    if (!keep.has(p)) continue;
    for (const q of kept) {
      if (q !== p && keep.has(q) && Math.abs(q - p) < distance) keep.delete(q);
    }
  }
  return kept.filter((p) => keep.has(p));
}

function prominence(x: number[], peak: number): number {
  let leftMin = x[peak];
  for (let i = peak - 1; i >= 0; i--) {
    if (x[i] > x[peak]) break;
    leftMin = Math.min(leftMin, x[i]);
  }
  let rightMin = x[peak];
  for (let i = peak + 1; i < x.length; i++) {
    if (x[i] > x[peak]) break;
    rightMin = Math.min(rightMin, x[i]);
  }
  return x[peak] - Math.max(leftMin, rightMin);
}
