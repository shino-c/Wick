/**
 * CaptureCamera — the only component in the app that mounts a camera.
 *
 * VisionCamera, its worklets bridge and react-native-worklets are native
 * modules that simply do not exist in Expo Go or on a simulator. Rather than
 * crash there, this module resolves them at runtime and reports
 * `cameraAvailable`. When it's false the whole app falls back to
 * src/camera/simulator.ts and every screen keeps working.
 *
 * Power behaviour lives here too: the session is torn down (`isActive={false}`)
 * the instant a burst ends, so between Desk Mode bursts the camera hardware is
 * genuinely off rather than idling on a hidden preview.
 *
 * VisionCamera 5 replaced the v4 `frameProcessor` prop with explicit camera
 * *outputs*: you build a frame output with `useFrameOutput({ onFrame })` and
 * hand it to `<Camera outputs={[...]} />`. Frames must be disposed by the
 * worklet as soon as it is done with them, or the pipeline stalls.
 */
import React from 'react';
import { AppState, View } from 'react-native';
import { sampleFrame, type Channel, type FrameSample, type Roi } from './frameSampling';

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

export interface CaptureCameraProps {
  facing: 'front' | 'back';
  active: boolean;
  torch?: boolean;
  channel: Channel;
  roi: Roi;
  stride: number;
  /** Called on the JS thread, once per frame, with the reduced sample. */
  onSample: (sample: FrameSample) => void;
  /** The finger scan shows a small preview; Desk Mode never does. */
  showPreview?: boolean;
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
  showPreview = false,
  size = 120,
}: CaptureCameraProps) {
  const { Camera, useFrameOutput } = VisionCameraLib;
  const { scheduleOnRN } = Worklets;

  // Camera must also stop when the app is backgrounded — on iOS the OS
  // suspends it anyway, and leaving it "active" burns power on Android.
  const [foreground, setForeground] = React.useState(true);
  React.useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setForeground(s === 'active'));
    return () => sub.remove();
  }, []);

  // Keep the latest callback in a ref so the worklet identity — and with it the
  // whole frame output — doesn't get rebuilt on every parent render.
  const sink = React.useRef(onSample);
  sink.current = onSample;
  const deliver = React.useCallback((s: FrameSample) => sink.current(s), []);

  const onFrame = React.useCallback(
    (frame: any) => {
      'worklet';
      try {
        const sample = sampleFrame(frame, channel, roi, stride);
        if (sample) scheduleOnRN(deliver, sample);
      } finally {
        // Mandatory in VisionCamera 5. The frame is released here — nothing is
        // retained, encoded, or written anywhere.
        frame.dispose();
      }
    },
    [channel, roi, stride, deliver, scheduleOnRN]
  );

  const frameOutput = useFrameOutput({
    // 'rgb' costs an extra conversion versus 'yuv', but it is what lets us read
    // a specific colour channel — the red/green distinction the whole PPG
    // pipeline depends on.
    pixelFormat: 'rgb',
    targetResolution: { width: 640, height: 480 },
    dropFramesWhileBusy: true,
    onFrame,
  });

  const isActive = active && foreground;

  return (
    <View
      style={
        showPreview
          ? { width: size, height: size, borderRadius: size / 2, overflow: 'hidden' }
          : // Not rendered off-screen with zero size: the Camera view needs a
            // real surface. 1x1 and fully transparent keeps the room off screen.
            { width: 1, height: 1, opacity: 0 }
      }
      pointerEvents="none"
    >
      <Camera
        style={{ flex: 1 }}
        device={facing}
        isActive={isActive}
        outputs={[frameOutput]}
        constraints={[{ fps: 30 }]}
        torch={torch ? 'on' : 'off'}
      />
    </View>
  );
}
