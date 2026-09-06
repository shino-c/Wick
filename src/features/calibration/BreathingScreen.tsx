import React from 'react';
import { View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { Ring, Sparkline } from '@/components/charts';
import { BreathingPacer, CYCLE_MS } from '@/components/BreathingPacer';
import { colors, radius, spacing } from '@/theme';
import { CaptureCamera } from '@/camera/CaptureCamera';
import { FINGER } from '@/camera/config';
import { FRAMING_MESSAGE } from '@/camera/frameSampling';
import { breathingEffect, SEGMENTS, useBreathingScan } from '@/camera/useBreathingScan';
import { BASELINE_MIN_SCANS, PPGService } from '@/services/ppgService';
import {
  completeChallenge,
  getBaseline,
  recomputeFusedScore,
  saveScan,
} from '@/services/repository';
import type { PPGResult } from '@/services/ppgService';

/**
 * Guided breathing, measured.
 *
 * Previously this screen was a one-minute timer with an animated circle: it
 * asked the user to do something and then had no idea whether it worked. In the
 * pillar whose entire purpose is ground truth, that was the wrong shape.
 *
 * Paced breathing at ~5.5 breaths/min is the one intervention here with a
 * large, fast, well-documented effect on precisely the quantity Wick already
 * measures. So the finger sensor now runs for the whole exercise and the screen
 * reports what actually changed — before, during, and after.
 *
 * With `?challenge=<id>`, finishing this also completes that challenge as
 * *verified*: a measurement witnessed it, rather than the user tapping a box.
 */
export default function BreathingScreen() {
  const router = useRouter();
  useKeepAwake();
  const { challenge } = useLocalSearchParams<{ challenge?: string }>();
  const scan = useBreathingScan();

  const [baselineRmssd, setBaselineRmssd] = React.useState<number | null>(null);
  const [savedNote, setSavedNote] = React.useState<string | null>(null);
  const saved = React.useRef(false);

  React.useEffect(() => {
    getBaseline().then((b) =>
      setBaselineRmssd(b.calibrationScans >= BASELINE_MIN_SCANS ? b.rmssdBaseline : null)
    );
  }, []);

  // Persist once, when the run first completes.
  React.useEffect(() => {
    if (scan.phase !== 'done' || saved.current) return;
    saved.current = true;
    (async () => {
      const notes: string[] = [];

      // The BEFORE window is an ordinary resting spot check, so it counts
      // toward the baseline like any other.
      if (scan.before && scan.before.signalQuality === 'good') {
        const c =
          scan.before.hrvRmssd === null
            ? { stressLevel: 'Unknown' as const, deviationPct: null, message: '' }
            : PPGService.classifyStress(scan.before.hrvRmssd, baselineRmssd);
        await saveScan(scan.before, 'finger', c);
        notes.push('the before reading was added to your baseline');
      }

      // The AFTER window is deliberately NOT baseline material. It is taken
      // moments after an intervention designed to raise HRV, so folding it in
      // would teach Wick that your normal resting state is your best one — and
      // every ordinary day would then look like elevated stress.
      if (scan.after && scan.after.signalQuality === 'good') {
        const c =
          scan.after.hrvRmssd === null
            ? { stressLevel: 'Unknown' as const, deviationPct: null, message: '' }
            : PPGService.classifyStress(scan.after.hrvRmssd, baselineRmssd);
        await saveScan(scan.after, 'finger', c, { feedsBaseline: false });
      }

      await recomputeFusedScore();

      if (challenge) {
        await completeChallenge(challenge, true, true);
        notes.push('your challenge was marked done, with the measurement attached');
      }
      setSavedNote(notes.length ? `Saved — ${notes.join(', ')}.` : null);
    })();
  }, [baselineRmssd, challenge, scan.after, scan.before, scan.phase]);

  const measuring =
    scan.phase === 'before' || scan.phase === 'breathe' || scan.phase === 'after';

  const camera = (
    <CaptureCamera
      facing="back"
      active={scan.cameraActive}
      torch
      channel={FINGER.CHANNEL}
      roi={FINGER.ROI}
      stride={FINGER.PIXEL_STRIDE}
      onSample={scan.onSample}
      preview="none"
    />
  );

  if (scan.phase === 'done') {
    return (
      <Screen>
        <NavBar title="Breathing check" onBack={() => router.back()} />
        <Results
          before={scan.before}
          during={scan.during}
          after={scan.after}
          savedNote={savedNote}
          onRepeat={() => {
            saved.current = false;
            setSavedNote(null);
            scan.start();
          }}
          onDone={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <NavBar title="Breathing check" onBack={() => router.back()} />
      {scan.cameraActive && camera}

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        {scan.phase === 'idle' || scan.phase === 'error' ? (
          <Intro simulated={scan.simulated} error={scan.error} forChallenge={Boolean(challenge)} />
        ) : (
          <>
            <Eyebrow color={colors.inkFaint}>{STEP_LABEL[scan.phase] ?? 'Getting ready'}</Eyebrow>
            <Spacer h={4} />

            {scan.phase === 'breathe' ? (
              <BreathingPacer size={200} />
            ) : (
              <Ring
                progress={scan.progress}
                size={200}
                color={scan.framingIssue ? colors.warn : colors.yellowDeep}
              >
                <View style={{ alignItems: 'center' }}>
                  <Txt v="display">{scan.phase === 'framing' ? '☝' : scan.secondsLeft}</Txt>
                  <Eyebrow>{scan.phase === 'framing' ? 'finger on lens' : 'seconds'}</Eyebrow>
                </View>
              </Ring>
            )}

            {scan.phase === 'breathe' && (
              <>
                <Spacer h={4} />
                <Bar pct={scan.progress * 100} color={colors.calm} />
                <Spacer h={2} />
                <Eyebrow>
                  {scan.secondsLeft}s left · {Math.round(CYCLE_MS / 1000)}s per breath
                </Eyebrow>
              </>
            )}

            {/* The live number. It exists so the two minutes do not feel like
                dead time, and it is labelled as indicative because near a
                segment boundary the trailing window straddles two states. The
                three reported numbers come from clean per-segment windows. */}
            {scan.liveRmssd !== null && (
              <>
                <Spacer h={4} />
                <Row gap={4} style={{ alignItems: 'flex-end' }}>
                  <View style={{ alignItems: 'center' }}>
                    <Txt v="title" color={colors.brown}>
                      {Math.round(scan.liveRmssd)}
                    </Txt>
                    <Eyebrow>HRV now · ms</Eyebrow>
                  </View>
                  {scan.liveHeartRate !== null && (
                    <View style={{ alignItems: 'center' }}>
                      <Txt v="title" color={colors.ink}>
                        {Math.round(scan.liveHeartRate)}
                      </Txt>
                      <Eyebrow>bpm</Eyebrow>
                    </View>
                  )}
                </Row>
                {scan.liveSeries.length > 2 && (
                  <>
                    <Spacer h={2} />
                    <Sparkline
                      values={scan.liveSeries}
                      width={240}
                      height={44}
                      color={colors.calm}
                      fill
                    />
                    <Txt v="small" color={colors.inkFaint} center>
                      Rolling 30s window · indicative, not the result
                    </Txt>
                  </>
                )}
              </>
            )}

            <Spacer h={5} />
            <Txt v="body" color={colors.inkSoft} center style={{ paddingHorizontal: spacing(6) }}>
              {scan.framingIssue
                ? FRAMING_MESSAGE[scan.framingIssue]
                : (STEP_HINT[scan.phase] ?? 'Hold steady.')}
            </Txt>

            {scan.restartNote && (
              <>
                <Spacer h={3} />
                <View
                  style={{
                    backgroundColor: colors.warnWash,
                    borderRadius: radius.sm,
                    padding: spacing(3),
                    marginHorizontal: spacing(4),
                  }}
                >
                  <Txt v="small" color={colors.warn} center>
                    {scan.restartNote}
                  </Txt>
                </View>
              </>
            )}

            {measuring && scan.trace.length > 4 && (
              <>
                <Spacer h={4} />
                <Sparkline values={scan.trace} width={260} height={50} color={colors.alert} />
                <Txt v="small" color={colors.inkFaint}>
                  On-device only · discarded when you leave
                </Txt>
              </>
            )}

            <Spacer h={4} />
            <Steps phase={scan.phase} />
          </>
        )}
      </View>

      {scan.phase === 'idle' || scan.phase === 'error' ? (
        <Button
          label={scan.simulated ? 'Start (simulated)' : 'Start breathing check'}
          onPress={scan.start}
        />
      ) : (
        <Button label="Cancel" variant="ghost" onPress={scan.cancel} />
      )}
      <Spacer h={4} />
    </Screen>
  );
}

const STEP_LABEL: Partial<Record<string, string>> = {
  framing: 'Getting a signal',
  before: 'Step 1 of 3 · Before',
  breathe: 'Step 2 of 3 · Breathe',
  after: 'Step 3 of 3 · After',
  processing: 'Working it out',
};

const STEP_HINT: Partial<Record<string, string>> = {
  before: 'Sit normally and breathe however you normally would. This is the reference the rest is measured against.',
  breathe: 'Follow the circle. Longer out than in — that is the part that calms you down.',
  after: 'Stop pacing and breathe normally again. This is the reading that counts.',
  processing: 'Comparing the three windows…',
};

function Intro({
  simulated,
  error,
  forChallenge,
}: {
  simulated: boolean;
  error: string | null;
  forChallenge: boolean;
}) {
  const total = SEGMENTS.before + SEGMENTS.breathe + SEGMENTS.after;
  return (
    <View>
      <Txt v="title" center>
        See what breathing does to you
      </Txt>
      <Spacer h={3} />
      <Txt v="body" color={colors.inkSoft} center>
        Keep your fingertip on the rear camera for {Math.round(total / 60)} minutes. The reading and
        the breathing run together — the sensor never stops — and Wick shows you what changed,
        measured on you rather than quoted from a study.
      </Txt>
      <Spacer h={3} />
      <Txt v="small" color={colors.inkFaint} center>
        It needs a before and an after because the answer is a difference. A single reading taken
        while you breathe slowly is always high: slow breathing raises heart-rate variation directly,
        so that number would only tell you that you followed the instructions.
      </Txt>
      <Spacer h={5} />
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="small" color={colors.inkSoft}>
            1 · Before
          </Txt>
          <Txt v="small" color={colors.inkFaint}>
            {SEGMENTS.before}s
          </Txt>
        </Row>
        <Spacer h={2} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="small" color={colors.inkSoft}>
            2 · Paced breathing
          </Txt>
          <Txt v="small" color={colors.inkFaint}>
            {SEGMENTS.breathe}s
          </Txt>
        </Row>
        <Spacer h={2} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="small" color={colors.inkSoft}>
            3 · After
          </Txt>
          <Txt v="small" color={colors.inkFaint}>
            {SEGMENTS.after}s
          </Txt>
        </Row>
      </Card>
      {forChallenge && (
        <>
          <Spacer h={3} />
          <Card style={{ backgroundColor: colors.yellowWash, borderColor: colors.yellowDeep }}>
            <Txt v="small" color={colors.brownSoft}>
              Finishing this completes your challenge, with the measurement attached — nobody has to
              take your word for it.
            </Txt>
          </Card>
        </>
      )}
      {simulated && (
        <>
          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint} center>
            No camera available — this will run on simulated input through the real pipeline.
          </Txt>
        </>
      )}
      {error && (
        <>
          <Spacer h={3} />
          <Txt v="small" color={colors.alert} center>
            {error}
          </Txt>
        </>
      )}
    </View>
  );
}

function Steps({ phase }: { phase: string }) {
  const order = ['before', 'breathe', 'after'];
  const current = order.indexOf(phase);
  return (
    <Row gap={2}>
      {order.map((step, i) => (
        <View
          key={step}
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: i <= current && current >= 0 ? colors.yellowDeep : colors.line,
          }}
        />
      ))}
    </Row>
  );
}

/* ── results ──────────────────────────────────────────────────────── */

function Results({
  before,
  during,
  after,
  savedNote,
  onRepeat,
  onDone,
}: {
  before: PPGResult | null;
  during: PPGResult | null;
  after: PPGResult | null;
  savedNote: string | null;
  onRepeat: () => void;
  onDone: () => void;
}) {
  const effect = breathingEffect(before, after);

  if (!effect) {
    return (
      <View>
        <Card style={{ backgroundColor: colors.alertWash, borderColor: colors.alertWash }}>
          <Eyebrow color={colors.alert}>Not enough clean signal</Eyebrow>
          <Spacer h={2} />
          <Txt v="heading" color={colors.alert}>
            Wick could not compare the two readings
          </Txt>
          <Spacer h={2} />
          <Txt v="small" color={colors.inkSoft}>
            {before?.error ?? after?.error ?? 'One of the windows was too noisy to use.'} Keeping
            still with steady, light pressure on the lens is what makes the difference.
          </Txt>
        </Card>
        <Spacer h={4} />
        <Button label="Try again" onPress={onRepeat} />
        <Spacer h={2} />
        <Button label="Not now" variant="ghost" onPress={onDone} />
      </View>
    );
  }

  const tone = effect.improved ? colors.calm : colors.warn;

  return (
    <View>
      <Card style={{ backgroundColor: effect.improved ? colors.calmWash : colors.warnWash, borderColor: 'transparent' }}>
        <Eyebrow color={tone}>What changed</Eyebrow>
        <Spacer h={2} />
        <Row gap={2} style={{ alignItems: 'flex-end' }}>
          <Txt v="display" color={tone}>
            {effect.deltaPct > 0 ? '+' : ''}
            {effect.deltaPct}%
          </Txt>
          <Txt v="heading" color={tone} style={{ paddingBottom: 6 }}>
            HRV
          </Txt>
        </Row>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          {effect.improved
            ? `Your HRV was ${effect.deltaMs} ms higher after the exercise than before it${
                effect.hrDelta !== null && effect.hrDelta < 0
                  ? `, and your heart rate came down ${Math.abs(effect.hrDelta)} bpm`
                  : ''
              }. That is your parasympathetic system coming back online.`
            : `Your HRV did not rise this time (${effect.deltaMs} ms). That happens — caffeine, a short night, or simply a noisy reading. It is not a failure, and one session is not a trend.`}
        </Txt>
      </Card>

      <Spacer h={3} />

      <Card>
        <Txt v="heading">The three windows</Txt>
        <Spacer h={3} />
        <Window label="Before" result={before} />
        <Divider />
        <Window label="While breathing" result={during} highlight />
        <Divider />
        <Window label="After" result={after} />
        <Spacer h={4} />
        <Txt v="small" color={colors.inkFaint}>
          The middle number is almost always the largest, and that on its own proves nothing: paced
          breathing drives beat-to-beat variation directly while you are doing it. The comparison
          that means something is <Txt v="small" color={colors.inkSoft}>before against after</Txt> —
          what is still there once you stop.
        </Txt>
      </Card>

      {savedNote && (
        <>
          <Spacer h={3} />
          <View
            style={{ backgroundColor: colors.calmWash, borderRadius: radius.sm, padding: spacing(3) }}
          >
            <Txt v="small" color={colors.calm}>
              {savedNote}
            </Txt>
          </View>
        </>
      )}

      <Spacer h={5} />
      <Button label="Done" onPress={onDone} />
      <Spacer h={2} />
      <Button label="Run it again" variant="ghost" onPress={onRepeat} />
      <Spacer h={5} />
    </View>
  );
}

function Window({
  label,
  result,
  highlight,
}: {
  label: string;
  result: PPGResult | null;
  highlight?: boolean;
}) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Row gap={2}>
        <Txt v="body" color={highlight ? colors.brown : colors.ink}>
          {label}
        </Txt>
        {highlight && <Badge label="paced" fg={colors.brownSoft} bg={colors.yellowWash} />}
      </Row>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt v="heading" color={highlight ? colors.brown : colors.ink}>
          {result?.hrvRmssd !== null && result?.hrvRmssd !== undefined
            ? `${Math.round(result.hrvRmssd)} ms`
            : '—'}
        </Txt>
        <Txt v="small" color={colors.inkFaint}>
          {result?.heartRate ? `${Math.round(result.heartRate)} bpm` : 'no reading'}
        </Txt>
      </View>
    </Row>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }} />;
}
