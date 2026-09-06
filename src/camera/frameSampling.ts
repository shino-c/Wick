/**
 * frameSampling.ts — the only code that ever touches pixels.
 *
 * Runs inside a VisionCamera frame processor (a worklet on the camera thread).
 * It reduces each frame to a SINGLE NUMBER — the mean intensity of one colour
 * channel inside a small region of interest — and returns it. The frame buffer
 * itself is never copied out, never written to disk, never sent anywhere; it is
 * released as soon as this function returns.
 *
 * Channel choice is the one real difference between the two capture modes:
 *   finger + flash -> RED   (strongest pulsatile component under torch light)
 *   face rPPG      -> GREEN (least sensitive to skin tone and lighting)
 * Everything downstream in ppgService is channel-agnostic and identical.
 */

export type Channel = 'red' | 'green' | 'blue';
export interface Roi {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameSample {
  /** Mean channel intensity, 0–255. This is the only value that leaves the frame. */
  mean: number;
  /** Mean of all three channels — used for the "too dark / blown out" check. */
  brightness: number;
  /** Spatial variance inside the ROI. High variance = not a flat skin surface. */
  variance: number;
}

/**
 * Extract one sample from a VisionCamera frame.
 *
 * Requires the frame output to be configured with `pixelFormat: 'rgb'`. Marked
 * as a worklet so it executes on the camera thread without a JS hop per frame.
 * Disposing the frame is the caller's job — see CaptureCamera.
 */
export function sampleFrame(frame: any, channel: Channel, roi: Roi, stride: number): FrameSample | null {
  'worklet';

  const width: number = frame.width;
  const height: number = frame.height;
  if (!width || !height) return null;

  // A GPU-only frame has no CPU-accessible buffer; skip it rather than throw.
  if (frame.hasPixelBuffer === false) return null;

  let buffer: ArrayBuffer;
  try {
    buffer = frame.getPixelBuffer();
  } catch {
    return null;
  }
  const data = new Uint8Array(buffer);

  // RGB vs RGBA differs by platform and format; derive it instead of assuming.
  const bytesPerRow: number = frame.bytesPerRow ?? width * 4;
  const bpp = Math.max(3, Math.round(bytesPerRow / width));
  const offset = channel === 'red' ? 0 : channel === 'green' ? 1 : 2;

  const x0 = Math.floor(roi.x * width);
  const y0 = Math.floor(roi.y * height);
  const x1 = Math.min(width, Math.floor((roi.x + roi.w) * width));
  const y1 = Math.min(height, Math.floor((roi.y + roi.h) * height));

  let sum = 0;
  let sumSq = 0;
  let sumAll = 0;
  let count = 0;

  for (let y = y0; y < y1; y += stride) {
    const rowStart = y * bytesPerRow;
    for (let x = x0; x < x1; x += stride) {
      const i = rowStart + x * bpp;
      if (i + 2 >= data.length) continue;
      const v = data[i + offset];
      sum += v;
      sumSq += v * v;
      sumAll += data[i] + data[i + 1] + data[i + 2];
      count++;
    }
  }

  if (count === 0) return null;
  const mean = sum / count;
  return {
    mean,
    brightness: sumAll / (count * 3),
    variance: Math.max(0, sumSq / count - mean * mean),
  };
}

/* ── Framing / quality checks (plain JS, run on the JS thread) ─────── */

export type FramingIssue = 'too_dark' | 'too_bright' | 'no_finger' | 'unstable' | null;

/** Setup check for face rPPG: enough light, and a reasonably flat, lit subject. */
export function checkFaceFraming(samples: FrameSample[]): FramingIssue {
  if (samples.length === 0) return 'unstable';
  const brightness = mean(samples.map((s) => s.brightness));
  if (brightness < 45) return 'too_dark';
  if (brightness > 235) return 'too_bright';

  // A wildly swinging ROI mean during the setup check means the subject is
  // moving in and out of frame — the timer shouldn't start on that.
  const means = samples.map((s) => s.mean);
  const drift = Math.max(...means) - Math.min(...means);
  if (drift > 40) return 'unstable';
  return null;
}

/** Coverage check for the finger spot check: lens fully covered, flash on. */
export function checkFingerCoverage(sample: FrameSample, minLevel: number): FramingIssue {
  if (sample.mean < minLevel) return 'no_finger';
  if (sample.mean > 252) return 'too_bright';
  // A covered lens is a near-flat red field; high spatial variance means the
  // camera is seeing the room, not a fingertip.
  if (sample.variance > 900) return 'no_finger';
  return null;
}

export const FRAMING_MESSAGE: Record<Exclude<FramingIssue, null>, string> = {
  too_dark: 'A little more light on your face, please.',
  too_bright: 'Too bright — try turning away from the window.',
  no_finger: 'Cover the rear camera and flash fully with your index finger.',
  unstable: 'Hold still and centre your face in frame.',
};

function mean(v: number[]) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
