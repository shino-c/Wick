import React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import { Sparkline } from '@/components/charts';
import { colors, radius, spacing } from '@/theme';
import { SOUNDSCAPES, type SoundscapeId } from '@/services/soundscapeService';
import { POMODORO, SENSING, type SensingMode } from '@/camera/config';
import { cameraAvailable } from '@/camera/CaptureCamera';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import { getBaseline, listScans } from '@/services/repository';
import type { PpgScan } from '@/data/types';
import BottomNavigation from '@/components/bottombar';
import TopNavigation from '@/components/topbar';

const DURATIONS = [15, 25, 35, 45];

/**
 * Battery figures are measured on the target device (vivo V2202, 5000 mAh) over
 * a 25-minute block, not estimated. Continuous is the default because the
 * alternative silently degrades the measurement; saver is offered honestly
 * rather than made the default to flatter the battery number.
 */
const SENSING_MODES: { id: SensingMode; label: string; blurb: string; battery: string }[] = [
  {
    id: 'continuous',
    label: 'Continuous',
    blurb: `Camera stays on for the block. A ${SENSING.ANALYSIS_WINDOW_SECONDS}s window updates every ${SENSING.ANALYSIS_STRIDE_SECONDS}s, and restlessness is watched the whole time.`,
    battery: '~15%/hr',
  },
  {
    id: 'saver',
    label: 'Battery saver',
    blurb: `A ${SENSING.SAVER_WINDOW_SECONDS}s reading every ${SENSING.SAVER_INTERVAL_SECONDS / 60} minutes, camera off in between. Accurate readings, but a coarse trend and no view of what happens between them.`,
    battery: '~4%/hr',
  },
  {
    id: 'demo',
    label: 'Demo',
    blurb: `${SENSING.DEMO_WINDOW_SECONDS}s windows every ${SENSING.DEMO_STRIDE_SECONDS}s, so the adaptive break and the enforced pause are visible inside a two-minute demo. Windows this short are below the HRV threshold — treat the numbers as illustrative.`,
    battery: 'demo only',
  },
];

export default function DeskScreen() {
  const router = useRouter();
  const [minutes, setMinutes] = React.useState<number>(POMODORO.DEFAULT_MINUTES);
  const [breakMinutes, setBreakMinutes] = React.useState<number>(POMODORO.DEFAULT_BREAK_MINUTES);
  const [soundscape, setSoundscape] = React.useState<SoundscapeId>('rain');
  const [sensing, setSensing] = React.useState<SensingMode>('continuous');
  const [scanCount, setScanCount] = React.useState(0);
  const [recent, setRecent] = React.useState<PpgScan[]>([]);

  const load = React.useCallback(async () => {
    const [b, s] = await Promise.all([getBaseline(), listScans(20)]);
    setScanCount(b.calibrationScans);
    setRecent(s.filter((x) => x.source === 'face' && x.deviationPct !== null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const baselineReady = scanCount >= BASELINE_MIN_SCANS;

  return (
    // Same pinned brand bar as Home, same pinned tab bar underneath. Only the
    // content between them changes when you switch tabs, which is what makes a
    // tab feel like a tab rather than a different page.
    <Screen
      header={<TopNavigation />}
      footer={<BottomNavigation activeTab="Desk" router={router} />}
    >
      <Eyebrow>Desk Mode</Eyebrow>
      <Spacer h={2} />
      <Txt v="display">Focus, watched over.</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        Prop your phone facing you like a desk companion. Wick reads your pulse from a rolling{' '}
        {SENSING.ANALYSIS_WINDOW_SECONDS}-second window, updates every{' '}
        {SENSING.ANALYSIS_STRIDE_SECONDS} seconds, and moves your break to when you actually need it.
      </Txt>

      <Spacer h={5} />

      {!baselineReady && (
        <>
          <Card style={{ backgroundColor: colors.warnWash, borderColor: colors.warnWash }}>
            <Eyebrow color={colors.warn}>Baseline incomplete</Eyebrow>
            <Spacer h={2} />
            <Txt v="small" color={colors.inkSoft}>
              {scanCount}/{BASELINE_MIN_SCANS} spot checks done. Desk Mode will still track your heart
              rate, but it can't classify stress — or enforce a break — until it knows your normal.
              Only finger spot checks count: a baseline has to be measured at rest, and Desk Mode
              readings are taken while you work.
            </Txt>
            <Spacer h={3} />
            <Button
              label="Do a spot check"
              variant="soft"
              onPress={() => router.push('/spot-check')}
            />
          </Card>
          <Spacer h={3} />
        </>
      )}

      {/* ── Session length ────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Session length</Txt>
          <Badge label="Adaptive" fg={colors.brown} bg={colors.yellow} />
        </Row>
        <Spacer h={3} />
        <Row gap={2}>
          {DURATIONS.map((d) => {
            const selected = minutes === d;
            return (
              <Pressable
                key={d}
                onPress={() => setMinutes(d)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: spacing(3),
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="heading" color={selected ? colors.brown : colors.inkSoft}>
                  {d}
                </Txt>
                <Txt v="small" color={colors.inkFaint}>
                  min
                </Txt>
              </Pressable>
            );
          })}
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          This is a starting point. Your break slides earlier when strain rises and later when you're
          settled, between {POMODORO.MIN_MINUTES} and {POMODORO.MAX_MINUTES} minutes.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Break length ─────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Break length</Txt>
          <Badge label={`${breakMinutes} min`} fg={colors.brown} bg={colors.yellow} />
        </Row>
        <Spacer h={3} />
        <Row gap={2}>
          {POMODORO.BREAK_OPTIONS.map((d) => {
            const selected = breakMinutes === d;
            return (
              <Pressable
                key={d}
                onPress={() => setBreakMinutes(d)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: spacing(3),
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="heading" color={selected ? colors.brown : colors.inkSoft}>
                  {d}
                </Txt>
                <Txt v="small" color={colors.inkFaint}>
                  min
                </Txt>
              </Pressable>
            );
          })}
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          Wick decides <Txt v="small" color={colors.inkSoft}>when</Txt> you break, based on your
          stress trend. How long you rest is always your call.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Soundscape ───────────────────────────────────────────── */}
      <Card>
        <Txt v="heading">White Noise & Soundscapes</Txt>
        <Spacer h={3} />
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {SOUNDSCAPES.map((s) => {
            const selected = soundscape === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSoundscape(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing(2),
                  paddingVertical: spacing(2),
                  paddingHorizontal: spacing(3),
                  borderRadius: radius.pill,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="small">{s.icon}</Txt>
                <Txt v="small" color={selected ? colors.brown : colors.inkSoft}>
                  {s.label}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <Spacer h={3} />

      {/* ── Sensing mode ─────────────────────────────────────────── */}
      <Card>
        <Txt v="heading">How closely Wick watches</Txt>
        <Spacer h={3} />
        {SENSING_MODES.map((m) => {
          const selected = sensing === m.id;
          return (
            <Pressable
              key={m.id}
              onPress={() => setSensing(m.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                padding: spacing(3.5),
                borderRadius: radius.md,
                marginBottom: spacing(2),
                backgroundColor: selected ? colors.yellow : colors.cream,
                borderWidth: 1,
                borderColor: selected ? colors.yellowDeep : colors.line,
              }}
            >
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="heading" color={selected ? colors.brown : colors.ink}>
                  {m.label}
                </Txt>
                <Txt v="small" color={selected ? colors.brownSoft : colors.inkFaint}>
                  {m.battery}
                </Txt>
              </Row>
              <Spacer h={1} />
              <Txt v="small" color={selected ? colors.brownSoft : colors.inkFaint}>
                {m.blurb}
              </Txt>
            </Pressable>
          );
        })}
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          HRV needs a long, unbroken look to mean anything — roughly half a minute of clean signal.
          Short samples spaced far apart give you a heart rate you can trust and a stress level you
          cannot, and they miss restlessness entirely between samples.
        </Txt>
      </Card>

      <Spacer h={3} />

      {recent.length >= 2 && (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Eyebrow>Desk Mode history</Eyebrow>
              <Txt v="small" color={colors.inkFaint}>
                HRV deviation from baseline
              </Txt>
            </Row>
            <Spacer h={3} />
            <Sparkline
              values={recent.map((r) => r.deviationPct as number).reverse()}
              width={280}
              height={70}
              color={colors.brown}
              fill
            />
          </Card>
          <Spacer h={3} />
        </>
      )}

      <Card style={{ backgroundColor: colors.night, borderColor: colors.night }}>
        <Eyebrow color={colors.onNightSoft}>On-device only</Eyebrow>
        <Spacer h={2} />
        <Txt v="small" color={colors.onNightSoft}>
          You see a live crop of your own face while Wick is reading — the room around you is never
          drawn. Only pixels inside your face are read, each frame becomes a single number before it
          is released, and if a second person appears the window is thrown away. Nothing is recorded:
          the longest anything is kept is the {SENSING.ANALYSIS_WINDOW_SECONDS}-second buffer of
          brightness values, and the camera shuts off the moment a break starts.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* Calibration's home. It is not a tab: it is measurement setup for Desk
          Mode and the spot check, not something you go looking for on a bad
          afternoon. Everything it configures is used here. */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing(3) }}>
            <Txt v="heading">Calibration & baseline</Txt>
            <Spacer h={1} />
            <Txt v="small" color={colors.inkSoft}>
              {baselineReady
                ? 'Your baseline, spot-check history, personal accuracy and the early-warning trend.'
                : `Set your normal first — ${BASELINE_MIN_SCANS - scanCount} more spot check${
                    BASELINE_MIN_SCANS - scanCount === 1 ? '' : 's'
                  } and Desk Mode can classify stress.`}
            </Txt>
          </View>
          <Button
            label="Open"
            variant="soft"
            style={{ height: 40, paddingHorizontal: spacing(5) }}
            onPress={() => router.push('/calibrate')}
          />
        </Row>
      </Card>

      <Spacer h={5} />
      <Button
        label={cameraAvailable ? 'Start Focus Session' : 'Start Focus Session (simulated)'}
        onPress={() =>
          router.push({
            pathname: '/session',
            params: {
              minutes: String(minutes),
              breakMinutes: String(breakMinutes),
              soundscape,
              sensing,
            },
          })
        }
      />
      <Spacer h={3} />
    </Screen>
  );
}
