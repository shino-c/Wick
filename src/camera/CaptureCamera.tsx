/**
 * CaptureCamera — the only component in the app that mounts a camera.
 *
 * VisionCamera, its worklets bridge and react-native-worklets are native
 * modules that do not exist in Expo Go or on a simulator. Rather than crash
 * there, this module resolves them at runtime and reports `cameraAvailable`.
 * When it's false the whole app falls back to src/camera/simulator.ts.
 *
 * Two outputs are attached:
 *   • a frame output, which reduces each frame to one number (frameSampling.ts)
 *   • an object output with type 'face', which gives a bounding box per face
 *
 * The face output is what makes the readings trustworthy. It supplies the
 * sampling ROI, it proves a person is actually in frame, and it detects a
 * second face so a burst can be dropped when someone walks in behind you.
 *
 * Power behaviour: the session is torn down (`isActive={false}`) the instant a
 * burst ends, so between Desk Mode bursts the camera hardware is genuinely off.
 */
import React from 'react';
import { AppState, View } from 'react-native';
import { sampleFrame, type Channel, type FrameSample, type Roi } from './frameSampling';
import { PREVIEW_SIZE } from './config';

// Metro resolves require() statically, so these must be literal paths and each
// one needs its own guard — a dynamic require(name) fails at bundle time.
let VisionCameraLib: any = null;
let VisionCameraWorklets: any = null;
let Worklets: any = null;

try {
  VisionCameraLib = require('react-native-vision-camera');
} catch {
  // Expo Go or a simulator without the native module: fall back to simulation.
}
try {
  VisionCameraWorklets = require('react-native-vision-camera-worklets');
} catch {
  // Frame outputs need this; without it we can render a preview but not sample.
}
try {
  Worklets = require('react-native-worklets');
} catch {
  // Same.
}

export const cameraAvailable: boolean =
  Boolean(
    VisionCameraLib?.Camera &&
      VisionCameraLib?.useFrameOutput &&
      VisionCameraWorklets &&
      Worklets?.scheduleOnRN
  ) && process.env.EXPO_PUBLIC_WICK_FORCE_SIMULATION !== '1';

export async function requestCameraPermission(): Promise<boolean> {
  if (!cameraAvailable) return false;
  return VisionCameraLib.VisionCamera.requestCameraPermission();
}

export function getCameraPermission(): string {
  if (!cameraAvailable) return 'denied';
  return VisionCameraLib.VisionCamera.cameraPermissionStatus;
}

/** Normalised 0–1 camera-space box, as reported by the face detector. */
export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CaptureCameraProps {
  facing: 'front' | 'back';
  active: boolean;
  torch?: boolean;
  channel: Channel;
  /** Static ROI. Ignored when `trackFaces` supplies a live face box. */
  roi: Roi;
  stride: number;
  /** Called on the JS thread, once per frame, with the reduced sample. */
  onSample: (sample: FrameSample) => void;
  /** Enables the face detector. Desk Mode uses it; the finger scan doesn't. */
  trackFaces?: boolean;
  /** Called whenever the detected face set changes. Empty array = nobody in frame. */
  onFaces?: (faces: FaceBox[]) => void;
  /**
   * 'none'      — camera runs with no visible output (finger scan while idle)
   * 'full'      — plain preview, fills the container
   * 'face-crop' — preview scaled and offset so only the face box is visible
   */
  preview?: 'none' | 'full' | 'face-crop';
  /** The box to centre on in face-crop mode. */
  faceBox?: FaceBox | null;
  size?: number;
}

export function CaptureCamera(props: CaptureCameraProps) {
  if (!cameraAvailable) return null;
  return <RealCaptureCamera {...props} />;
}

/**
 * Only ever mounted when the native modules resolved, so every hook below is
 * called unconditionally within this component.
 */
function RealCaptureCamera({
  facing,
  active,
  torch,
  channel,
  roi,
  stride,
  onSample,
  trackFaces = false,
  onFaces,
  preview = 'none',
  faceBox,
  size = PREVIEW_SIZE,
}: CaptureCameraProps) {
  const { Camera, useFrameOutput, useObjectOutput } = VisionCameraLib;
  const { scheduleOnRN } = Worklets;

  // Camera must also stop when the app is backgrounded — on iOS the OS
  // suspends it anyway, and leaving it "active" burns power on Android.
  const [foreground, setForeground] = React.useState(true);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  // Keep the latest callbacks in refs so the worklet identity — and with it the
  // whole frame output — isn't rebuilt on every parent render.
  const sink = React.useRef(onSample);
  sink.current = onSample;
  const deliver = React.useCallback((s: FrameSample) => sink.current(s), []);

  // The sampling ROI follows the face. Held in a ref so the frame processor
  // reads the newest box without being recreated each time the face moves.
  const roiRef = React.useRef<Roi>(roi);
  React.useEffect(() => {
    if (!trackFaces) roiRef.current = roi;
  }, [roi, trackFaces]);

  const faceSink = React.useRef(onFaces);
  faceSink.current = onFaces;

  const onObjectsScanned = React.useCallback(
    (objects: any[]) => {
      const boxes: FaceBox[] = (objects ?? [])
        .filter((o) => o?.boundingBox)
        .map((o) => ({
          x: o.boundingBox.x,
          y: o.boundingBox.y,
          width: o.boundingBox.width,
          height: o.boundingBox.height,
        }));

      if (trackFaces) {
        // Sample the middle of the largest face — the edges of the box slide on
        // and off skin as the head moves, which reads as noise.
        const primary = boxes.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
        roiRef.current = primary ? insetBox(primary) : { x: 0, y: 0, w: 0, h: 0 };
      }
      faceSink.current?.(boxes);
    },
    [trackFaces]
  );

  const objectOutput = useObjectOutput({
    types: trackFaces ? ['face'] : [],
    onObjectsScanned: trackFaces ? onObjectsScanned : undefined,
  });

  const onFrame = React.useCallback(
    (frame: any) => {
      'worklet';
      try {
        const box = roiRef.current;
        // Zero-area ROI means no face is in frame: emit nothing, so the burst
        // ends up short of frames and is discarded rather than filled with
        // readings taken off a wall.
        if (box.w > 0 && box.h > 0) {
          const sample = sampleFrame(frame, channel, box, stride);
          if (sample) scheduleOnRN(deliver, sample);
        }
      } finally {
        // Mandatory in VisionCamera 5. The frame is released here — nothing is
        // retained, encoded, or written anywhere.
        frame.dispose();
      }
    },
    [channel, stride, deliver, scheduleOnRN]
  );

  const frameOutput = useFrameOutput({
    // 'rgb' costs an extra conversion versus 'yuv', but it is what lets us read
    // a specific colour channel — the red/green distinction the PPG pipeline
    // depends on.
    pixelFormat: 'rgb',
    targetResolution: { width: 640, height: 480 },
    dropFramesWhileBusy: true,
    onFrame,
  });

  const outputs = React.useMemo(
    () => (trackFaces ? [frameOutput, objectOutput] : [frameOutput]),
    [frameOutput, objectOutput, trackFaces]
  );

  const isActive = active && foreground;

  return (
    <View style={containerStyle(preview, size)} pointerEvents="none">
      <View style={innerStyle(preview, size, faceBox)}>
        <Camera
          style={{ flex: 1 }}
          device={facing}
          isActive={isActive}
          outputs={outputs}
          constraints={[{ fps: 30 }]}
          // VisionCamera 5 renamed this from `torch`. The old name is silently
          // ignored, which is exactly how the flashlight ended up never firing.
          torchMode={torch ? 'on' : 'off'}
        />
      </View>
    </View>
  );
}

/** Sample the central portion of a face box. */
function insetBox(box: FaceBox): Roi {
  const inset = 0.18;
  return {
    x: clamp01(box.x + box.width * inset),
    y: clamp01(box.y + box.height * inset),
    w: clamp01(box.width * (1 - inset * 2)),
    h: clamp01(box.height * (1 - inset * 2)),
  };
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function containerStyle(preview: CaptureCameraProps['preview'], size: number) {
  if (preview === 'none') {
    // VisionCamera needs a real surface, so it can't be zero-sized. 1x1 and
    // transparent keeps the room off the screen entirely.
    return { width: 1, height: 1, opacity: 0 } as const;
  }
  if (preview === 'face-crop') {
    return {
      width: size,
      height: size,
      borderRadius: size / 2,
      overflow: 'hidden',
    } as const;
  }
  return { width: size, height: size, borderRadius: 16, overflow: 'hidden' } as const;
}

/**
 * In face-crop mode the preview is scaled up and shifted so the detected face
 * box lands in the middle of the circular window. Everything else is clipped by
 * the parent's overflow:hidden and never rendered.
 */
function innerStyle(
  preview: CaptureCameraProps['preview'],
  size: number,
  faceBox?: FaceBox | null
) {
  if (preview !== 'face-crop' || !faceBox || faceBox.width <= 0) {
    return { width: '100%', height: '100%' } as const;
  }
  // Scale so the face box roughly fills the window, clamped to sane bounds.
  const scale = Math.max(1.2, Math.min(4, 1 / Math.max(faceBox.width, faceBox.height)));
  const centreX = faceBox.x + faceBox.width / 2;
  const centreY = faceBox.y + faceBox.height / 2;
  return {
    width: '100%',
    height: '100%',
    transform: [
      { scale },
      { translateX: (0.5 - centreX) * size },
      { translateY: (0.5 - centreY) * size },
    ],
  } as const;
}
