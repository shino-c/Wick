import React from 'react';
import { BackHandler, Pressable, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useKeepAwake } from 'expo-keep-awake';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import { Ring, Sparkline } from '@/components/charts';
import { BreathingPacer } from '@/components/BreathingPacer';
import { colors, radius, spacing } from '@/theme';
import { CaptureCamera } from '@/camera/CaptureCamera';
import { FACE, POMODORO, PREVIEW_MODE, PREVIEW_SIZE, SETUP_CHECK_SECONDS, type SensingMode } from '@/camera/config';
import { FRAMING_MESSAGE } from '@/camera/frameSampling';
import { useDeskSession } from '@/camera/useDeskSession';
import {
  playSoundscape,
  SOUNDSCAPES,
  stopSoundscape,
  type SoundscapeId,
} from '@/services/soundscapeService';
import { saveScan } from '@/services/repository';
import { stageSessionSummary } from './sessionHandoff';

export default function SessionScreen() {
  useKeepAwake();
  const router = useRouter();
  const params = useLocalSearchParams<{
    minutes?: string;
    soundscape?: string;
    sensing?: string;
    breakMinutes?: string;
    taskId?: string;
    taskTitle?: string;
    category?: string;
  }>();

  // Route params arrive as strings; parse once and defend against a deep link
  // that arrives with nothing set.
  const minutes = Number(params.minutes) || POMODORO.DEFAULT_MINUTES;
  const sensing: SensingMode =
    params.sensing === 'saver' || params.sensing === 'demo' ? params.sensing : 'continuous';
  const breakMinutes = Number(params.breakMinutes) || POMODORO.DEFAULT_BREAK_MINUTES;
  const initialSound = (params.soundscape as SoundscapeId) ?? 'rain';

  const session = useDeskSession({ plannedMinutes: minutes, breakMinutes, mode: sensing });
  const [sound, setSound] = React.useState<SoundscapeId>(initialSound);
  const [cameraError, setCameraError] = React.useState<string | null>(null);
  const [volume, setVolume] = React.useState(0.6);
  const persisted = React.useRef(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    session.start();
  }, [session]);

  React.useEffect(() => {
    playSoundscape(sound, volume);
  }, [sound, volume]);

  React.useEffect(() => () => void stopSoundscape(), []);

  // Persist each burst as it lands, so a session that dies mid-way still leaves
  // the readings it genuinely took.
  React.useEffect(() => {
    const fresh = session.readings.slice(persisted.current);
    if (fresh.length === 0) return;
    persisted.current = session.readings.length;
    fresh.forEach((r) => {
      saveScan(
        {
          heartRate: r.heartRate,
          hrvRmssd: r.hrvRmssd,
          hrvWindowSeconds: r.windowSeconds,
          heartRateCategory: null,
          ibiList: [],
          peakCount: 0,
          signalQuality: r.quality,
          filteredSignal: [],
          error: null,
        },
        'face',
        {
          stressLevel: r.level,
          deviationPct: r.deviationPct,
          message: '',
        }
      );
    });
  }, [session.readings]);

  // An enforced pause is a real interruption; it should feel like one.
  React.useEffect(() => {
    if (session.phase === 'enforced') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    }
  }, [session.phase]);

  const finish = React.useCallback(() => {
    const summary = session.end();
    stopSoundscape();
    // The soundscape was chosen here, so it is recorded here. The session row
    // used to store null unconditionally, which meant the one thing a user
    // actively picks about a session was the one thing never saved.
    stageSessionSummary({
      ...summary,
      soundscape: sound,
      // Passed straight through so the summary screen can pre-fill its guess.
      // Null when the user started a block cold, which is a legitimate answer:
      // the summary asks rather than assuming.
      taskId: params.taskId ?? null,
      taskTitle: params.taskTitle ?? null,
      category: params.category ?? null,
    });
    router.replace('/summary');
  }, [router, session, sound, params.taskId, params.taskTitle, params.category]);

  // Hardware back must not be an escape hatch out of an enforced pause.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => session.phase === 'enforced');
    return () => sub.remove();
  }, [session.phase]);

  // One camera element, positioned by whoever renders it. In face-crop mode it
  // is a small circle showing only the detected face; the room around you is
  // clipped away rather than drawn and covered.
  const camera = (
    <CaptureCamera
      facing="front"
      active={session.cameraActive}
      channel={FACE.CHANNEL}
      roi={FACE.ROI}
      stride={FACE.PIXEL_STRIDE}
      targetWidth={FACE.TARGET_WIDTH}
      targetHeight={FACE.TARGET_HEIGHT}
      onSample={session.onSample}
      onCameraError={(e) => setCameraError(e.message)}
      trackFaces
      onFaces={session.onFaces}
      preview={session.cameraActive ? (session.primaryFace ? PREVIEW_MODE : 'full') : 'none'}
      faceBox={session.primaryFace}
      size={PREVIEW_SIZE}
    />
  );

  if (session.phase === 'permission_denied') {
    return (
      <Screen dark>
        {camera}
        <Spacer h={10} />
        <Txt v="title" color={colors.onNight}>
          Camera access is off
        </Txt>
        <Spacer h={3} />
        <Txt v="body" color={colors.onNightSoft}>
          Desk Mode needs the front camera to read your pulse. You can still run a plain timer, or
          grant access in Settings and come back.
        </Txt>
        <Spacer h={6} />
        <Button label="Back to Desk" variant="night" onPress={() => router.back()} />
      </Screen>
    );
  }

  if (session.phase === 'setup') {
    return <SetupCheck session={session} camera={camera} onCancel={() => router.back()} />;
  }

  if (session.phase === 'enforced') {
    return <EnforcedPause session={session} camera={camera} />;
  }

  return (
    <ActiveSession
      session={session}
      camera={camera}
      cameraError={cameraError}
      sound={sound}
      setSound={setSound}
      volume={volume}
      setVolume={setVolume}
      onEnd={finish}
    />
  );
}

/* ── 3-second setup check ─────────────────────────────────────────── */

function SetupCheck({
  session,
  camera,
  onCancel,
}: {
  session: ReturnType<typeof useDeskSession>;
  camera: React.ReactNode;
  onCancel: () => void;
}) {
  return (
    <Screen dark scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Eyebrow color={colors.onNightSoft}>Setup check</Eyebrow>
        <Spacer h={5} />
        <Ring
          progress={1 - session.setupSecondsLeft / SETUP_CHECK_SECONDS}
          size={200}
          color={session.setupIssue ? colors.warn : colors.calm}
        >
          {/* The live face crop sits inside the ring, so you can see your own
              framing while the countdown runs. */}
          <View style={{ alignItems: 'center', justifyContent: 'center' }}>
            {camera}
            <Spacer h={2} />
            <Txt v="title" color={colors.onNight}>
              {session.setupSecondsLeft}
            </Txt>
          </View>
        </Ring>
        <Spacer h={6} />
        <Txt v="heading" color={session.setupIssue ? colors.warn : colors.calm} center>
          {session.setupIssue ? FRAMING_MESSAGE[session.setupIssue] : 'Framing looks good'}
        </Txt>
        <Spacer h={3} />
        <Txt v="small" color={colors.onNightSoft} center style={{ paddingHorizontal: spacing(8) }}>
          Prop your phone up facing you. The timer starts after three clean seconds. Only your face
          is shown — the room around you is never drawn on screen.
        </Txt>
      </View>
      <Button label="Cancel" variant="night" onPress={onCancel} />
      <Spacer h={4} />
    </Screen>
  );
}

/* ── enforced pause ───────────────────────────────────────────────── */

function EnforcedPause({
  session,
  camera,
}: {
  session: ReturnType<typeof useDeskSession>;
  camera: React.ReactNode;
}) {
  return (
    <Screen dark scroll={false}>
      {camera}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Badge label="Timer locked" fg={colors.night} bg={colors.yellow} />
        <Spacer h={5} />
        <Txt v="title" color={colors.onNight} center>
          Stand up. Breathe with this.
        </Txt>
        <Spacer h={6} />
        <BreathingPacer dark size={200} />
        <Spacer h={8} />
        <Txt v="small" color={colors.onNightSoft} center style={{ paddingHorizontal: spacing(6) }}>
          {session.escalationReason}
        </Txt>
        <Spacer h={4} />
        <Eyebrow color={colors.onNightSoft}>Resuming in {session.secondsLeft}s</Eyebrow>
      </View>
      <Txt v="small" color={colors.onNightSoft} center>
        There is no skip button. That is the point.
      </Txt>
      <Spacer h={4} />
    </Screen>
  );
}

/* ── active session ───────────────────────────────────────────────── */

function ActiveSession({
  session,
  camera,
  cameraError,
  sound,
  setSound,
  volume,
  setVolume,
  onEnd,
}: {
  session: ReturnType<typeof useDeskSession>;
  camera: React.ReactNode;
  cameraError: string | null;
  sound: SoundscapeId;
  setSound: (s: SoundscapeId) => void;
  volume: number;
  setVolume: (v: number) => void;
  onEnd: () => void;
}) {
  const onBreak = session.phase === 'break';
  const latest = session.latest;
  const progress = onBreak ? 0 : session.elapsedSeconds / Math.max(1, session.blockSeconds);

  return (
    <Screen dark>
      {/* The camera element is mounted either way; when a reading isn't running
          it is inactive and occupies no space. */}
      {!session.sampling && <View style={{ opacity: 0, height: 0 }}>{camera}</View>}

      {cameraError && (
        <>
          <NightCard>
            <Txt v="small" color={colors.warn}>
              ⚠  {cameraError}
            </Txt>
          </NightCard>
          <Spacer h={3} />
        </>
      )}

      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="title" color={colors.onNight}>
          Wick ✳
        </Txt>
        <SensingBadge sampling={session.sampling} simulated={session.simulated} />
      </Row>

      {/* Live face crop, visible only while a burst is running. Gives the user
          framing feedback exactly when it matters, and disappears the rest of
          the time so there's no feed sitting on screen for 48 seconds a minute. */}
      {session.sampling && (
        <>
          <Spacer h={4} />
          <Row gap={3}>
            <View
              style={{
                borderWidth: 2,
                borderRadius: (PREVIEW_SIZE + 8) / 2,
                borderColor: session.present ? colors.calm : colors.warn,
                padding: 2,
              }}
            >
              {camera}
            </View>
            <View style={{ flex: 1 }}>
              <Txt v="heading" color={session.present ? colors.calm : colors.warn}>
                {session.faces.length > 1
                  ? 'Two people in frame'
                  : session.present
                    ? 'Reading your pulse'
                    : 'Looking for your face'}
              </Txt>
              <Spacer h={1} />
              <Txt v="small" color={colors.onNightSoft}>
                {session.faces.length > 1
                  ? 'Wick reads only you — this burst will be dropped.'
                  : session.present
                    ? 'Stay roughly still for a few seconds.'
                    : 'Sit back in view of the camera.'}
              </Txt>
            </View>
          </Row>
        </>
      )}

      {session.lastDiscardReason && !session.sampling && (
        <>
          <Spacer h={3} />
          <NightCard>
            <Txt v="small" color={colors.warn}>
              ⚠  {session.lastDiscardReason}. Wick would rather skip a reading than invent one.
            </Txt>
          </NightCard>
        </>
      )}

      <Spacer h={6} />

      <View style={{ alignItems: 'center' }}>
        <Ring progress={progress} size={230} color={onBreak ? colors.calm : colors.yellow}>
          <View style={{ alignItems: 'center' }}>
            <Txt v="display" color={colors.onNight} style={{ fontSize: 44 }}>
              {formatClock(session.secondsLeft)}
            </Txt>
            <Eyebrow color={colors.onNightSoft}>{onBreak ? 'Break' : 'Remaining'}</Eyebrow>
          </View>
        </Ring>
        <Spacer h={4} />
        <Txt v="heading" color={colors.onNight}>
          {onBreak ? 'Break — step away from the desk' : 'Deep Work Session'}
        </Txt>
        <Spacer h={1} />
        <Txt v="small" color={colors.onNightSoft}>
          {onBreak
            ? 'Your next block starts automatically'
            : `Break in ${Math.ceil(session.secondsLeft / 60)}m · auto-set from your stress trend`}
        </Txt>
      </View>

      <Spacer h={6} />

      {/* ── Live vitals ───────────────────────────────────────────── */}
      <Row gap={3}>
        <Vital
          label="Heart rate"
          value={latest?.heartRate ? `${Math.round(latest.heartRate)}` : '—'}
          unit="bpm"
        />
        <Vital
          label="HRV"
          value={latest?.hrvRmssd ? `${Math.round(latest.hrvRmssd)}` : '—'}
          unit={
            latest && latest.hrvRmssd === null && latest.heartRate !== null
              ? 'window too short'
              : `ms · ${session.windowSeconds}s`
          }
        />
        {/* Movement is read live, not once per reading. In continuous mode this
            is the whole point: someone who fidgets constantly but happened to
            be still during a sampled burst used to read as perfectly steady,
            and nothing in the old design could ever have shown that. */}
        <Vital
          label="Movement"
          value={movementLabel(session.movementLive)}
          unit={
            session.movementSessionPct === null
              ? 'now'
              : `${Math.round(session.movementSessionPct * 100)}% of block`
          }
        />
      </Row>

      <Spacer h={3} />

      {!session.baselineReady && (
        <>
          <NightCard>
            <Txt v="small" color={colors.onNightSoft}>
              Tracking heart rate, but stress classification is off until your baseline has three
              spot checks. Nothing will be enforced until then.
            </Txt>
          </NightCard>
          <Spacer h={3} />
        </>
      )}

      {/* ── Soundscapes ───────────────────────────────────────────── */}
      <NightCard>
        <Txt v="heading" color={colors.onNight}>
          White Noise & Soundscapes
        </Txt>
        <Spacer h={3} />
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {SOUNDSCAPES.map((s) => {
            const selected = sound === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSound(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing(2),
                  paddingVertical: spacing(2),
                  paddingHorizontal: spacing(3),
                  borderRadius: radius.pill,
                  backgroundColor: selected ? colors.yellow : 'transparent',
                  borderWidth: 1,
                  borderColor: selected ? colors.yellow : colors.nightLine,
                }}
              >
                <Txt v="small">{s.icon}</Txt>
                <Txt v="small" color={selected ? colors.night : colors.onNightSoft}>
                  {s.label}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
        <Spacer h={2} />
        <Slider
          value={volume}
          onValueChange={setVolume}
          minimumValue={0}
          maximumValue={1}
          minimumTrackTintColor={colors.yellow}
          maximumTrackTintColor={colors.nightLine}
          thumbTintColor={colors.onNight}
          accessibilityLabel="Soundscape volume"
        />
      </NightCard>

      <Spacer h={3} />

      {/* ── Stress trend ──────────────────────────────────────────── */}
      <NightCard>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Txt v="heading" color={colors.onNight}>
              Stress Trend
            </Txt>
            <Txt v="small" color={colors.onNightSoft}>
              HRV deviation from your baseline
            </Txt>
          </View>
          {latest && latest.level !== 'Unknown' && (
            <Badge
              label={latest.level}
              fg={colors.night}
              bg={
                latest.level === 'High Stress'
                  ? colors.alert
                  : latest.level === 'Elevated Stress'
                    ? colors.warn
                    : colors.calm
              }
            />
          )}
        </Row>
        <Spacer h={3} />
        {session.curve.length >= 2 ? (
          <Sparkline values={session.curve} width={270} height={70} color={colors.yellow} fill />
        ) : (
          <Txt v="small" color={colors.onNightSoft}>
            The first reading lands after {session.windowSeconds}s — that is how much clean signal
            HRV needs before it means anything.
          </Txt>
        )}
      </NightCard>

      <Spacer h={5} />
      <Button label="⏹  End Session" variant="night" onPress={onEnd} />
      <Spacer h={3} />
      {!onBreak && (
        <Button label="Take a break now" variant="night" onPress={session.takeBreakNow} />
      )}
      <Spacer h={4} />
    </Screen>
  );
}

/* ── bits ─────────────────────────────────────────────────────────── */

function SensingBadge({ sampling, simulated }: { sampling: boolean; simulated: boolean }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing(2),
        paddingVertical: spacing(1.5),
        paddingHorizontal: spacing(3),
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: sampling ? colors.yellow : colors.nightLine,
        backgroundColor: sampling ? 'rgba(253,241,169,0.12)' : 'transparent',
      }}
    >
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: sampling ? colors.yellow : colors.onNightSoft,
        }}
      />
      <Txt v="eyebrow" color={sampling ? colors.yellow : colors.onNightSoft}>
        {simulated
          ? sampling
            ? 'SIMULATED READING'
            : 'SIMULATION · IDLE'
          : sampling
            ? 'CAMERA ACTIVE · ON-DEVICE'
            : 'CAMERA OFF'}
      </Txt>
    </View>
  );
}

function NightCard({ children }: { children: React.ReactNode }) {
  return (
    <Card style={{ backgroundColor: colors.nightSoft, borderColor: colors.nightLine }}>{children}</Card>
  );
}

function Vital({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.nightSoft,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.nightLine,
        padding: spacing(3),
      }}
    >
      <Eyebrow color={colors.onNightSoft}>{label}</Eyebrow>
      <Spacer h={2} />
      <Txt v="title" color={colors.onNight}>
        {value}
      </Txt>
      <Txt v="small" color={colors.onNightSoft}>
        {unit}
      </Txt>
    </View>
  );
}

function movementLabel(index: number) {
  if (index > 0.4) return 'High';
  if (index > 0.25) return 'Some';
  return 'Low';
}

function formatClock(seconds: number) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  const s = Math.max(0, seconds) % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
