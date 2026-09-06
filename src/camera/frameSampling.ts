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
  /**
   * Fraction of sampled pixels whose colour looks like skin, 0–1.
   *
   * This is how Desk Mode knows somebody is actually in front of the camera.
   * VisionCamera 5's real face detector is iOS-only (`createObjectOutput`
   * throws on Android), so presence has to be derived from the pixels we are
   * already reading. It is a heuristic, not face recognition — it answers
   * "is a skin-coloured surface filling the sampling region", which is exactly
   * the precondition rPPG needs, and nothing more.
   */
  skinFraction: number;
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
  let skin = 0;
  let count = 0;

  for (let y = y0; y < y1; y += stride) {
    const rowStart = y * bytesPerRow;
    for (let x = x0; x < x1; x += stride) {
      const i = rowStart + x * bpp;
      if (i + 2 >= data.length) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const v = data[i + offset];
      sum += v;
      sumSq += v * v;
      sumAll += r + g + b;

      // Normalised rg-chromaticity skin test. Dividing out total intensity
      // makes it far less sensitive to lighting and to skin tone than a raw
      // RGB threshold — the ratios cluster similarly across complexions, while
      // absolute brightness does not.
      const total = r + g + b;
      if (total > 90) {
        const rn = r / total;
        const gn = g / total;
        if (rn > 0.33 && rn < 0.5 && gn > 0.26 && gn < 0.363 && r > g && g > b) {
          skin++;
        }
      }
      count++;
    }
  }

  if (count === 0) return null;
  const mean = sum / count;
  return {
    mean,
    brightness: sumAll / (count * 3),
    variance: Math.max(0, sumSq / count - mean * mean),
    skinFraction: skin / count,
  };
}

/* ── Framing / quality checks (plain JS, run on the JS thread) ─────── */

export type FramingIssue =
  | 'too_dark'
  | 'too_bright'
  | 'no_finger'
  | 'unstable'
  | 'no_face'
  | 'multiple_faces'
  | null;

/**
 * Minimum skin coverage of the sampling region for a person to count as present.
 * A face filling the centre box clears this comfortably; a wall, a ceiling or an
 * empty chair does not.
 */
export const SKIN_PRESENCE_THRESHOLD = 0.3;

/** True when the recent samples look like a person, not a room. */
export function facePresent(samples: FrameSample[]): boolean {
  if (samples.length === 0) return false;
  const recent = samples.slice(-15);
  const avg = recent.reduce((s, x) => s + x.skinFraction, 0) / recent.length;
  return avg >= SKIN_PRESENCE_THRESHOLD;
}

/**
 * Setup check for face rPPG.
 *
 * Presence is checked FIRST and is not negotiable. An earlier version tested
 * only brightness and drift, which meant a well-lit wall passed and the session
 * went on to report a heart rate for it. Light is a quality condition; a person
 * being there is a correctness one.
 *
 * @param faceCount from the real face detector where one exists (iOS). Pass
 *                  null on platforms without it — presence then rests on the
 *                  skin heuristic alone, and multi-person detection is skipped.
 */
export function checkFaceFraming(samples: FrameSample[], faceCount: number | null): FramingIssue {
  if (faceCount !== null) {
    if (faceCount === 0) return 'no_face';
    if (faceCount > 1) return 'multiple_faces';
  } else if (!facePresent(samples)) {
    return 'no_face';
  }
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
  no_face: 'Wick cannot see your face — prop the phone so you are in view.',
  multiple_faces: 'More than one person in frame. Wick only reads you.',
};

function mean(v: number[]) {
  return v.reduce((a, b) => a + b, 0) / v.length;
}
