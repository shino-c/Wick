import React from 'react';
import { Pressable, Switch, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import { Sparkline } from '@/components/charts';
import { colors, radius, spacing } from '@/theme';
import { SOUNDSCAPES, type SoundscapeId } from '@/services/soundscapeService';
import { FACE, POMODORO } from '@/camera/config';
import { cameraAvailable } from '@/camera/CaptureCamera';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import { getBaseline, listScans } from '@/services/repository';
import type { PpgScan } from '@/data/types';
import BottomNavigation from '@/components/bottombar';

const DURATIONS = [15, 25, 35, 45];

export default function DeskScreen() {
  const router = useRouter();
  const [minutes, setMinutes] = React.useState<number>(POMODORO.DEFAULT_MINUTES);
  const [breakMinutes, setBreakMinutes] = React.useState<number>(POMODORO.DEFAULT_BREAK_MINUTES);
  const [soundscape, setSoundscape] = React.useState<SoundscapeId>('rain');
  const [demoMode, setDemoMode] = React.useState(true);
  const [scanCount, setScanCount] = React.useState(0);
  const [recent, setRecent] = React.useState<PpgScan[]>([]);

  const load = React.useCallback(async () => {
    const [b, s] = await Promise.all([getBaseline(), listScans(20)]);
    setScanCount(b.scanCount);
    setRecent(s.filter((x) => x.source === 'face' && x.deviationPct !== null));
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const baselineReady = scanCount >= BASELINE_MIN_SCANS;

  return (
    <Screen footer={<BottomNavigation activeTab="Desk" router={router} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="title">Wick ✳</Txt>
        <Eyebrow>Desk Mode</Eyebrow>
      </Row>
      <Spacer h={5} />

      <Txt v="display">Focus, watched over.</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        Prop your phone facing you like a desk companion. Wick takes a {FACE.BURST_SECONDS}-second
        pulse reading every {FACE.BURST_INTERVAL_SECONDS} seconds and moves your break to when you
        actually need it.
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

      {/* ── Demo cadence ─────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing(3) }}>
            <Txt v="heading">Demo cadence</Txt>
            <Spacer h={1} />
            <Txt v="small" color={colors.inkSoft}>
              Samples every 20 seconds instead of {FACE.BURST_INTERVAL_SECONDS}, so the adaptive
              break and the enforced pause are visible inside a two-minute demo.
            </Txt>
          </View>
          <Switch
            value={demoMode}
            onValueChange={setDemoMode}
            trackColor={{ true: colors.yellowDeep, false: colors.line }}
            thumbColor={colors.brown}
          />
        </Row>
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
          You see a live crop of your own face while a reading is taken — the room around you is
          never drawn. Only pixels inside your face are read, each frame becomes a single number
          before it is released, and if a second person appears the reading is thrown away. The
          camera is off between readings.
        </Txt>
      </Card>

      <Spacer h={3} />
      <Button
        label="Calibration & baseline"
        variant="ghost"
        onPress={() => router.push('/calibrate')}
      />

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
              demoMode: demoMode ? '1' : '0',
            },
          })
        }
      />
      <Spacer h={3} />
    </Screen>
  );
}
