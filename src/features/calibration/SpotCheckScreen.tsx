import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Button, Card, Emoji, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { Ring, Sparkline } from '@/components/charts';
import { colors, radius, spacing, stressColor } from '@/theme';
import { CaptureCamera } from '@/camera/CaptureCamera';
import { FINGER } from '@/camera/config';
import { FRAMING_MESSAGE } from '@/camera/frameSampling';
import { useFingerScan } from '@/camera/useFingerScan';
import { BASELINE_MIN_SCANS, PPGService, type StressClassification } from '@/services/ppgService';
import {
  completeChallenge,
  getBaseline,
  recomputeFusedScore,
  saveAccuracyFeedback,
  saveScan,
} from '@/services/repository';
import type { AccuracyVerdict } from '@/data/types';

export default function SpotCheckScreen() {
  const router = useRouter();
  // Arriving from a challenge that can be proved by a spot check. Completing
  // the scan completes the challenge, and marks it as measured rather than
  // self-reported.
  const { challenge } = useLocalSearchParams<{ challenge?: string }>();
  const scan = useFingerScan('neutral');
  const [baselineRmssd, setBaselineRmssd] = React.useState<number | null>(null);
  const [scanCount, setScanCount] = React.useState(0);
  const [classification, setClassification] = React.useState<StressClassification | null>(null);
  const [verdict, setVerdict] = React.useState<AccuracyVerdict | null>(null);
  const saved = React.useRef(false);

  React.useEffect(() => {
    getBaseline().then((b) => {
      setScanCount(b.calibrationScans);
      setBaselineRmssd(b.calibrationScans >= BASELINE_MIN_SCANS ? b.rmssdBaseline : null);
    });
  }, []);

  // Persist exactly once, when a completed scan first appears.
  React.useEffect(() => {
    if (scan.phase !== 'done' || !scan.result || saved.current) return;
    saved.current = true;
    // A null RMSSD means the window was too short to measure HRV, not that HRV
    // was zero. `?? 0` turned "we could not measure this" into a 100% deviation
    // from baseline — the strongest possible High Stress reading.
    const c =
      scan.result.hrvRmssd === null
        ? {
            stressLevel: 'Unknown' as const,
            deviationPct: null,
            message: 'Signal was clean but too short to measure HRV. Try another scan.',
          }
        : PPGService.classifyStress(scan.result.hrvRmssd, baselineRmssd);
    setClassification(c);
    (async () => {
      await saveScan(scan.result!, 'finger', c);
      await recomputeFusedScore();
      // Only a usable reading counts as proof. A discarded scan proves the
      // person held their finger somewhere, not that they took a break.
      if (challenge && scan.result!.signalQuality === 'good') {
        await completeChallenge(challenge, true, true);
      }
      const b = await getBaseline();
      setScanCount(b.calibrationScans);
    })();
  }, [baselineRmssd, challenge, scan.phase, scan.result]);

  const restart = () => {
    saved.current = false;
    setClassification(null);
    setVerdict(null);
    scan.start();
  };

  const recordVerdict = async (v: AccuracyVerdict) => {
    setVerdict(v);
    await saveAccuracyFeedback(v);
  };

  const scansLeft = Math.max(0, BASELINE_MIN_SCANS - scanCount);

  return (
    <Screen>
      <NavBar title="Finger spot check" onBack={() => router.back()} />


      {scan.phase === 'done' && scan.result ? (
        <ResultView
          result={scan.result}
          forChallenge={Boolean(challenge)}
          classification={classification}
          verdict={verdict}
          onVerdict={recordVerdict}
          onRestart={restart}
          onDone={() => router.back()}
        />
      ) : (
        <CaptureView scan={scan} scansLeft={scansLeft} onStart={restart} />
      )}
    </Screen>
  );
}

/* ── capture ──────────────────────────────────────────────────────── */

/**
 * The lens circle is derived from the ring rather than guessed. Inner diameter
 * is size - 2*stroke; the extra inset keeps a hairline of background between
 * the two so the preview does not appear to bleed into the progress arc.
 */
const RING_SIZE = 220;
const RING_STROKE = 10;
const LENS = RING_SIZE - RING_STROKE * 2 - 6;

function CaptureView({
  scan,
  scansLeft,
  onStart,
}: {
  scan: ReturnType<typeof useFingerScan>;
  scansLeft: number;
  onStart: () => void;
}) {
  const capturing = scan.phase === 'capturing';
  const hint =
    scan.phase === 'idle'
      ? 'Cover the rear camera and flash with your index finger. Rest your hand — pressure changes look like heartbeats.'
      : scan.framingIssue
        ? FRAMING_MESSAGE[scan.framingIssue]
        : capturing
          ? 'Hold steady, light pressure. A number that keeps jumping means the contact is off.'
          : 'Looking for your fingertip…';

  const live = scan.phase === 'framing' || capturing;

  return (
    <View style={{ alignItems: 'center' }}>
      <Spacer h={4} />
      <Ring
        progress={scan.progress}
        size={RING_SIZE}
        stroke={RING_STROKE}
        color={scan.framingIssue ? colors.warn : colors.yellowDeep}
        track={colors.line}
      >
        {/* One circular lens, sized to sit just inside the ring's stroke.
            Previously the preview was a rounded SQUARE of 170 inside a ring
            whose inner diameter is 200, which left a dark rectangle showing at
            the corners and an obvious gap all the way round. Everything here is
            now the same circle: the camera, the scrim over it, and the content. */}
        <View
          style={{
            width: LENS,
            height: LENS,
            borderRadius: LENS / 2,
            overflow: 'hidden',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: live ? colors.night : colors.cream,
          }}
        >
          {/* A preview here carries no bystander risk: the lens is pressed
              against a fingertip, so the only thing it can show is the finger. */}
          {live && (
            <View style={StyleSheet.absoluteFill}>
              <CaptureCamera
                facing="back"
                active
                torch
                channel={FINGER.CHANNEL}
                roi={FINGER.ROI}
                stride={FINGER.PIXEL_STRIDE}
                onSample={scan.onSample}
                preview="full"
                size={LENS}
              />
            </View>
          )}
          {live && (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(61,58,52,0.45)' }]}
            />
          )}

          {capturing ? (
            <>
              {/* The live BPM is the reassuring part: a number that settles
                  means the contact is good, and one that jumps around means it
                  is not — while there is still time to fix it. */}
              {scan.liveHeartRate !== null ? (
                <>
                  <Row gap={2} style={{ alignItems: 'flex-end' }}>
                    <Txt v="display" color="#FFFFFF" style={{ fontSize: 46 }}>
                      {Math.round(scan.liveHeartRate)}
                    </Txt>
                    <Txt v="heading" color="#FFFFFF" style={{ paddingBottom: 8 }}>
                      bpm
                    </Txt>
                  </Row>
                  <Eyebrow color="rgba(255,255,255,0.75)">{scan.secondsLeft}s left</Eyebrow>
                </>
              ) : (
                <>
                  <Txt v="display" color="#FFFFFF">
                    {scan.secondsLeft}
                  </Txt>
                  {/* Saying "reading your pulse" while no pulse is being found
                      is the small lie that leads to the big one. If the
                      regularity gate has rejected everything so far, say so. */}
                  <Eyebrow color="rgba(255,255,255,0.75)">
                    {scan.progress > 0.35 ? 'no clear pulse yet' : 'looking for a pulse'}
                  </Eyebrow>
                </>
              )}
            </>
          ) : scan.phase === 'processing' ? (
            <Eyebrow>Analysing</Eyebrow>
          ) : scan.phase === 'framing' ? (
            <Eyebrow color="#FFFFFF">Looking…</Eyebrow>
          ) : (
            <Emoji size={44}>☝️</Emoji>
          )}
        </View>
      </Ring>

      <Spacer h={4} />
      <Txt v="body" color={colors.inkSoft} center style={{ paddingHorizontal: spacing(4) }}>
        {hint}
      </Txt>
      <Spacer h={4} />

      {scan.trace.length > 4 && (
        <Card style={{ width: '100%' }}>
          <Eyebrow>Live pulse trace</Eyebrow>
          <Spacer h={2} />
          <Sparkline values={scan.trace} width={260} height={60} color={colors.alert} />
          <Txt v="small" color={colors.inkFaint}>
            On-device only · discarded when you leave this screen
          </Txt>
        </Card>
      )}

      {scan.error && (
        <>
          <Spacer h={3} />
          <Card style={{ width: '100%', backgroundColor: colors.alertWash, borderColor: colors.alertWash }}>
            <Txt v="small" color={colors.alert}>
              {scan.error}
            </Txt>
          </Card>
        </>
      )}

      <Spacer h={5} />
      {scan.phase === 'idle' || scan.phase === 'error' ? (
        <View style={{ width: '100%' }}>
          <Button label={scan.simulated ? 'Start (simulated)' : 'Start Spot Check'} onPress={onStart} />
          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint} center>
            {scansLeft > 0
              ? `${scansLeft} more scan${scansLeft === 1 ? '' : 's'} to unlock stress detection`
              : 'Your baseline is active — this scan will be classified against it'}
          </Txt>
        </View>
      ) : (
        <View style={{ width: '100%' }}>
          <Button label="Cancel" variant="ghost" onPress={scan.cancel} />
        </View>
      )}
    </View>
  );
}

/* ── result ───────────────────────────────────────────────────────── */

function ResultView({
  result,
  forChallenge,
  classification,
  verdict,
  onVerdict,
  onRestart,
  onDone,
}: {
  result: NonNullable<ReturnType<typeof useFingerScan>['result']>;
  forChallenge: boolean;
  classification: StressClassification | null;
  verdict: AccuracyVerdict | null;
  onVerdict: (v: AccuracyVerdict) => void;
  onRestart: () => void;
  onDone: () => void;
}) {
  if (result.signalQuality === 'poor') {
    return (
      <View>
        <Card style={{ backgroundColor: colors.alertWash, borderColor: colors.alertWash }}>
          <Eyebrow color={colors.alert}>Reading discarded</Eyebrow>
          <Spacer h={2} />
          <Txt v="heading" color={colors.alert}>
            That signal was too noisy to trust
          </Txt>
          <Spacer h={2} />
          <Txt v="small" color={colors.inkSoft}>
            {result.error} — Wick would rather show you nothing than a number it made up.
          </Txt>
        </Card>
        <Spacer h={4} />
        <Button label="Try again" onPress={onRestart} />
        <Spacer h={2} />
        <Button label="Not now" variant="ghost" onPress={onDone} />
      </View>
    );
  }

  const deviation = classification?.deviationPct ?? null;
  const tone = stressColor(deviation === null ? 20 : Math.max(0, Math.min(100, deviation)));

  return (
    <View>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>Spot check complete</Eyebrow>
          <Badge label={result.signalQuality} fg={colors.calm} bg={colors.calmWash} />
        </Row>
        <Spacer h={3} />
        <Row gap={6}>
          <Metric label="Heart rate" value={`${result.heartRate}`} unit="bpm" />
          <Metric label="HRV (RMSSD)" value={`${result.hrvRmssd}`} unit="ms" />
          <Metric label="Beats read" value={`${result.peakCount}`} unit="peaks" />
        </Row>
        <Spacer h={4} />
        <Sparkline
          values={result.filteredSignal.slice(0, 300)}
          width={280}
          height={70}
          color={colors.brown}
          fill
        />
        <Txt v="small" color={colors.inkFaint}>
          Filtered waveform · {result.heartRateCategory}
        </Txt>
      </Card>

      <Spacer h={3} />

      <Card style={{ backgroundColor: tone.bg, borderColor: tone.bg }}>
        <Eyebrow color={tone.fg}>{classification?.stressLevel ?? 'Unknown'}</Eyebrow>
        <Spacer h={2} />
        {deviation !== null ? (
          <Txt v="title" color={tone.fg}>
            {deviation > 0 ? `${deviation.toFixed(0)}% below baseline` : 'At or above baseline'}
          </Txt>
        ) : (
          <Txt v="title" color={colors.inkSoft}>
            Baseline still building
          </Txt>
        )}
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          {classification?.message}
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* Ground truth: the user's correction is what drives personal accuracy. */}
      <Card>
        <Txt v="heading">Did that feel accurate?</Txt>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          Your answer overrides the standard model bias and tunes the reading to you.
        </Txt>
        <Spacer h={3} />
        <Row gap={2}>
          {(
            [
              ['spot_on', 'Spot on'],
              ['slightly_off', 'Slightly off'],
              ['way_off', 'Way off'],
            ] as [AccuracyVerdict, string][]
          ).map(([value, label]) => {
            const selected = verdict === value;
            return (
              <Button
                key={value}
                label={label}
                variant={selected ? 'primary' : 'ghost'}
                onPress={() => onVerdict(value)}
                style={{ flex: 1, height: 44, paddingHorizontal: spacing(1) }}
              />
            );
          })}
        </Row>
        {verdict && (
          <>
            <Spacer h={3} />
            <View
              style={{
                backgroundColor: colors.yellowWash,
                borderRadius: radius.sm,
                padding: spacing(3),
              }}
            >
              <Txt v="small" color={colors.brownSoft}>
                Logged. Wick will weigh this against future readings.
              </Txt>
            </View>
          </>
        )}
      </Card>

      {forChallenge && (
        <>
          <Spacer h={3} />
          <View
            style={{ backgroundColor: colors.calmWash, borderRadius: radius.sm, padding: spacing(3) }}
          >
            <Txt v="small" color={colors.calm}>
              ✓✓ Your challenge is marked done, with this reading attached.
            </Txt>
          </View>
        </>
      )}

      <Spacer h={4} />
      <Button label="Done" onPress={onDone} />
      <Spacer h={2} />
      <Button label="Scan again" variant="ghost" onPress={onRestart} />
    </View>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <View>
      <Eyebrow>{label}</Eyebrow>
      <Spacer h={1} />
      <Row gap={1}>
        <Txt v="title">{value}</Txt>
        <Txt v="small" color={colors.inkFaint}>
          {unit}
        </Txt>
      </Row>
    </View>
  );
}
