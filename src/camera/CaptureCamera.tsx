/**
 * CaptureCamera — the only component in the app that mounts a camera.
 *
 * VisionCamera, its worklets bridge and react-native-worklets are native
 * modules that do not exist in Expo Go or on a simulator. Rather than crash
 * there, this module resolves them at runtime and reports `cameraAvailable`.
 * When it's false the whole app falls back to src/camera/simulator.ts.
 *
 * A frame output reduces each frame to one number (frameSampling.ts). On iOS an
 * object output is attached alongside it for real face detection; on Android
 * that API throws, so presence falls back to the skin-coverage heuristic that
 * frameSampling computes from the same pixels.
 *
 * Power behaviour: the session is torn down (`isActive={false}`) the instant a
 * burst ends, so between Desk Mode bursts the camera hardware is genuinely off.
 */
import React from 'react';
import { AppState, Platform, View } from 'react-native';
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

/**
 * VisionCamera 5's object output — and therefore its face detector — is iOS
 * only. On Android `createObjectOutput` throws outright:
 *
 *   throw Error("CameraObjectOutput is not available on Android!")
 *
 * So face detection is treated as an enhancement, never a dependency. Presence
 * is derived from skin coverage in the sampled pixels (frameSampling.ts), which
 * works on both platforms; where the detector exists it additionally sharpens
 * the ROI and catches a second person in frame.
 */
export const faceDetectionAvailable: boolean = Platform.OS === 'ios';

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
  /**
   * Capture resolution. Lower is cheaper on the ISP and on the RGB conversion,
   * and costs nothing in signal quality: every frame is reduced to the mean of
   * one channel over a region, which is resolution-independent.
   */
  targetWidth?: number;
  targetHeight?: number;
  /**
   * Camera-session errors, surfaced instead of swallowed. Without this,
   * VisionCamera's default handler console.errors them and the user sees a red
   * screen in dev and nothing at all in production.
   */
  onCameraError?: (error: Error) => void;
}

export function CaptureCamera(props: CaptureCameraProps) {
  if (!cameraAvailable) return null;
  // Platform.OS is constant for the life of the process, so picking a component
  // here keeps hook order stable inside each one.
  if (props.trackFaces && faceDetectionAvailable) {
    return <CaptureWithFaceDetector {...props} />;
  }
  return <RealCaptureCamera {...props} />;
}

/** iOS only. Adds the native face detector on top of the base capture. */
function CaptureWithFaceDetector(props: CaptureCameraProps) {
  const { useObjectOutput } = VisionCameraLib;
  const { onFaces, trackFaces } = props;

  const faceSink = React.useRef(onFaces);
  faceSink.current = onFaces;
  const boxRef = React.useRef<Roi | null>(null);

  const onObjectsScanned = React.useCallback((objects: any[]) => {
    const boxes: FaceBox[] = (objects ?? [])
      .filter((o) => o?.boundingBox)
      .map((o) => ({
        x: o.boundingBox.x,
        y: o.boundingBox.y,
        width: o.boundingBox.width,
        height: o.boundingBox.height,
      }));
    const primary = boxes.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
    boxRef.current = primary ? insetBox(primary) : null;
    faceSink.current?.(boxes);
  }, []);

  const objectOutput = useObjectOutput({ types: ['face'], onObjectsScanned });

  return <RealCaptureCamera {...props} extraOutput={objectOutput} dynamicRoi={boxRef} trackFaces={trackFaces} />;
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
  onCameraError,
  preview = 'none',
  faceBox,
  size = PREVIEW_SIZE,
  targetWidth = 640,
  targetHeight = 480,
  extraOutput,
  dynamicRoi,
}: CaptureCameraProps & {
  /** iOS face-detector output, when the wrapper supplied one. */
  extraOutput?: any;
  /** Live ROI from the detector. Falls back to the static `roi` when absent. */
  dynamicRoi?: React.RefObject<Roi | null>;
}) {
  const { Camera, useFrameOutput } = VisionCameraLib;
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

  const errorSink = React.useRef(onCameraError);
  errorSink.current = onCameraError;

  // Sampling region. On iOS this tracks the detected face; elsewhere it is the
  // static centre box, and presence is judged from skin coverage instead.
  const staticRoi = React.useRef<Roi>(roi);
  staticRoi.current = roi;
  const liveRoi = dynamicRoi;

  const onFrame = React.useCallback(
    (frame: any) => {
      'worklet';
      try {
        const box = liveRoi?.current ?? staticRoi.current;
        if (box && box.w > 0 && box.h > 0) {
          const sample = sampleFrame(frame, channel, box, stride);
          if (sample) scheduleOnRN(deliver, sample);
        }
      } finally {
        // Mandatory in VisionCamera 5. The frame is released here — nothing is
        // retained, encoded, or written anywhere.
        frame.dispose();
      }
    },
    [channel, stride, deliver, scheduleOnRN, liveRoi]
  );

  const frameOutput = useFrameOutput({
    // 'rgb' costs an extra conversion versus 'yuv', but it is what lets us read
    // a specific colour channel — the red/green distinction the PPG pipeline
    // depends on.
    pixelFormat: 'rgb',
    targetResolution: { width: targetWidth, height: targetHeight },
    dropFramesWhileBusy: true,
    onFrame,
  });

  const outputs = React.useMemo(
    () => (extraOutput ? [frameOutput, extraOutput] : [frameOutput]),
    [frameOutput, extraOutput]
  );

  const isActive = active && foreground;

  /**
   * Torch is applied imperatively, with retries, rather than through the
   * declarative `torchMode` prop.
   *
   * VisionCamera hands you a CameraController as soon as the session is
   * *configured*, but CameraX cannot enable the torch until the device is
   * actually *open*. Setting torchMode declaratively fires in that gap and
   * CameraX rejects it:
   *
   *   CameraControl$OperationCanceledException: Camera is not active.
   *     at TorchControl.setTorchAsync(TorchControl.kt:179)
   *
   * The declarative prop never retries, so the flash stayed off for the entire
   * scan and the rejection surfaced as an unhandled console error. Polling for
   * the controller and retrying until the device is open fixes both. Front
   * cameras are skipped entirely — most have no flash unit, and CameraX throws
   * on them even when the mode is 'off'.
   */
  const cameraRef = React.useRef<any>(null);
  const wantsTorch = facing === 'back' && torch === true && isActive;

  React.useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const apply = (): void => {
      if (cancelled) return;
      const controller = cameraRef.current?.controller;
      const retry = () => {
        // ~4s of retries at 200ms. Longer than any cold camera open, short
        // enough that a genuinely torch-less device reports quickly.
        if (!cancelled && attempts++ < 20) setTimeout(apply, 200);
        else if (!cancelled && wantsTorch) {
          errorSink.current?.(new Error("This device's flash could not be turned on."));
        }
      };
      if (!controller) return retry();
      controller
        .setTorchMode(wantsTorch ? 'on' : 'off')
        .then(() => {
          // Settled. Nothing else to do.
        })
        .catch(retry);
    };

    // Turning the torch off on a camera that is already gone is a no-op we do
    // not want to retry or report.
    if (!wantsTorch && !cameraRef.current?.controller) return;
    apply();
    return () => {
      cancelled = true;
    };
  }, [wantsTorch]);

  return (
    <View style={containerStyle(preview, size)} pointerEvents="none">
      <View style={innerStyle(preview, size, faceBox)}>
        <Camera
          ref={cameraRef}
          style={{ flex: 1 }}
          device={facing}
          isActive={isActive}
          outputs={outputs}
          constraints={[{ fps: 30 }]}
          onError={(e: Error) => errorSink.current?.(e)}
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
