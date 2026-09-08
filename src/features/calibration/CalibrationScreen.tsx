import React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Emoji, Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { Sparkline } from '@/components/charts';
import { colors, radius, spacing, stressColor } from '@/theme';
import { QUICK_FLAGS } from './questionnaire';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import {
  getBaseline,
  hasQuestionnaireAnswers,
  latestSelfReport,
  listScans,
  listStressScores,
  personalAccuracy,
  recomputeFusedScore,
  saveSelfReport,
} from '@/services/repository';
import { computeTrendVelocity, type TrendVelocity } from '@/services/trendService';
import { stressBucket, type FusionResult } from '@/services/fusionService';
import type { Baseline, PpgScan } from '@/data/types';

export default function CalibrationScreen() {
  const router = useRouter();
  const [baseline, setBaseline] = React.useState<Baseline | null>(null);
  const [scans, setScans] = React.useState<PpgScan[]>([]);
  const [trend, setTrend] = React.useState<TrendVelocity | null>(null);
  const [accuracy, setAccuracy] = React.useState<{ pct: number | null; samples: number }>({
    pct: null,
    samples: 0,
  });
  const [fusion, setFusion] = React.useState<FusionResult | null>(null);
  const [flagged, setFlagged] = React.useState<number | null>(null);
  const [hasQuestionnaire, setHasQuestionnaire] = React.useState(false);

  const load = React.useCallback(async () => {
    const [b, s, a, self, scores, hasCompletedQuestionnaire] = await Promise.all([
      getBaseline(),
      listScans(40),
      personalAccuracy(),
      latestSelfReport(),
      listStressScores(1),
      hasQuestionnaireAnswers(),
    ]);
    setBaseline(b);
    setScans(s);
    setTrend(computeTrendVelocity(s));
    setAccuracy(a);
    // A quick flag is also a self-report but carries no answers, so "latest
    // report" was the wrong question — one tap on the mood row used to reset the
    // questionnaire card back to "Not started".
    setHasQuestionnaire(hasCompletedQuestionnaire);
    if (scores[0]) {
      setFusion({
        fusedScore: scores[0].fusedScore,
        confidence: scores[0].confidence,
        spread: 0,
        signalsUsed: scores[0].signalsUsed,
        note: '',
        biometricScore: null,
        selfReportScore: null,
        loadScore: null,
      });
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const quickFlag = async (score: number) => {
    setFlagged(score);
    await saveSelfReport(score, null);
    const result = await recomputeFusedScore();
    setFusion(result);
    load();
  };

  // Finger spot checks only — Desk Mode readings are taken mid-task and are not
  // evidence about rest, so they never count toward the baseline gate.
  const scanCount = baseline?.calibrationScans ?? 0;
  const scansLeft = Math.max(0, BASELINE_MIN_SCANS - scanCount);

  return (
    // Not a tab. Calibration is measurement setup — how Wick learns what your
    // normal is — so it belongs with the thing it calibrates, reached from Desk
    // Mode. Recovery is what you DO about the answer, and putting a
    // questionnaire behind that tab asked for admin from someone who came
    // looking for relief.
    <Screen>
      <NavBar title="Calibrate" onBack={router.canGoBack() ? () => router.back() : undefined} />

      {/* ── Fused read ────────────────────────────────────────────── */}
      {fusion?.fusedScore != null && <FusedCard fusion={fusion} />}

      {/* ── 1-tap quick flag ──────────────────────────────────────── */}
      <Card>
        <Txt v="heading">How are you feeling right now?</Txt>
        <Spacer h={3} />
        <Row style={{ justifyContent: 'space-between' }}>
          {QUICK_FLAGS.map((flag) => {
            const selected = flagged === flag.score;
            return (
              <Pressable
                key={flag.label}
                onPress={() => quickFlag(flag.score)}
                accessibilityRole="button"
                accessibilityLabel={flag.label}
                style={{
                  alignItems: 'center',
                  gap: 6,
                  paddingVertical: spacing(2),
                  paddingHorizontal: spacing(2),
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.yellow : 'transparent',
                }}
              >
                <Emoji size={26}>{flag.emoji}</Emoji>
                <Txt v="small" color={selected ? colors.brown : colors.inkFaint}>
                  {flag.label}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          Feeds your calibration loop and overrides standard model bias.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Trend Velocity Alert ──────────────────────────────────── */}
      {trend && <TrendCard trend={trend} />}

      <Spacer h={3} />

      {/* ── Baseline assessment ───────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Row gap={2}>
              <Txt v="body">{hasQuestionnaire ? '✓' : '○'}</Txt>
              <Txt v="heading">Personal Baseline Assessment</Txt>
            </Row>
            <Txt v="small" color={colors.inkFaint}>
              5-item perceived stress · {hasQuestionnaire ? 'Completed' : 'Not started'}
            </Txt>
          </View>
          <Button
            label="Recalibrate"
            variant="ghost"
            style={{ height: 38, paddingHorizontal: spacing(3) }}
            onPress={() => router.push('/questionnaire')}
          />
        </Row>
      </Card>

      <Spacer h={3} />

      {/* ── Spot check + baseline progress ────────────────────────── */}
      <Card>
        <Row gap={2}>
          <Txt v="body">✋</Txt>
          <Txt v="heading">Finger-PPG Spot Check</Txt>
        </Row>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          Rear camera + flash · the high-accuracy reading that validates the Desk Mode trend.
        </Txt>
        <Spacer h={3} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>
            {scanCount}/{BASELINE_MIN_SCANS} scans
          </Eyebrow>
          <Txt v="small" color={scansLeft > 0 ? colors.warn : colors.calm}>
            {scansLeft > 0
              ? `${scansLeft} more to unlock stress detection`
              : `Baseline active · RMSSD ${baseline?.rmssdBaseline ?? '—'} ms`}
          </Txt>
        </Row>
        <Spacer h={2} />
        <Bar
          pct={(Math.min(scanCount, BASELINE_MIN_SCANS) / BASELINE_MIN_SCANS) * 100}
          color={scansLeft > 0 ? colors.warn : colors.calm}
        />
        <Spacer h={3} />
        <Button label="Start Spot Check" variant="soft" onPress={() => router.push('/spot-check')} />
      </Card>

      <Spacer h={3} />

      {/* ── Personal accuracy ─────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Personal Accuracy</Txt>
          <Txt v="title" color={accuracy.pct === null ? colors.inkFaint : colors.brown}>
            {accuracy.pct === null ? '—' : `${accuracy.pct}%`}
          </Txt>
        </Row>
        <Spacer h={2} />
        <Bar pct={accuracy.pct ?? 0} color={colors.yellowDeep} />
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          {accuracy.samples === 0
            ? 'No calibration samples yet — confirm a reading after your next scan or session.'
            : `Based on ${accuracy.samples} verified calibration sample${accuracy.samples === 1 ? '' : 's'}`}
        </Txt>
      </Card>

      <Spacer h={3} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing(3) }}>
            <Txt v="heading">Paced breathing</Txt>
            <Spacer h={1} />
            <Txt v="small" color={colors.inkSoft}>
              5.5 breaths per minute — the rate that most reliably lifts vagal tone.
            </Txt>
          </View>
        </Row>
        <Spacer h={4} />
        <Button label="Breathing check · 2 min" onPress={() => router.push('/breathing')} />
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          Finger on the camera throughout. Wick reads your pulse before, during and after, and shows
          you what changed.
        </Txt>
        <Spacer h={3} />
        {/* The unmeasured version stays available on purpose: "let me measure
            that" is not always a welcome answer to feeling awful, and an app
            that insists on instrumenting every calm moment stops being restful. */}
        <Button
          label="Just the pacer · 1 min"
          variant="ghost"
          onPress={() => router.push({ pathname: '/breathing', params: { pacerOnly: '1' } })}
        />
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          Nothing measured, nothing saved, camera never opened.
        </Txt>
      </Card>

      <Spacer h={3} />
      {scans.length > 0 && <HistoryCard scans={scans} />}
    </Screen>
  );
}

/* ── cards ────────────────────────────────────────────────────────── */

function FusedCard({ fusion }: { fusion: FusionResult }) {
  const score = fusion.fusedScore!;
  const tone = stressColor(score);
  return (
    <>
      <Card style={{ backgroundColor: tone.bg, borderColor: tone.bg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow color={tone.fg}>Triangulated load score</Eyebrow>
          <Badge label={`${fusion.confidence} confidence`} fg={tone.fg} bg={colors.surface} />
        </Row>
        <Spacer h={3} />
        <Row gap={2} style={{ alignItems: 'flex-end' }}>
          <Txt v="display" color={tone.fg}>
            {Math.round(score)}
          </Txt>
          <Txt v="heading" color={tone.fg} style={{ paddingBottom: 6 }}>
            /100 · {stressBucket(score)}
          </Txt>
        </Row>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          {fusion.note || `${fusion.signalsUsed} of 3 signal types reporting.`}
        </Txt>
      </Card>
      <Spacer h={3} />
    </>
  );
}

function TrendCard({ trend }: { trend: TrendVelocity }) {
  const active = trend.alert;
  return (
    <Card style={active ? { backgroundColor: colors.alertWash, borderColor: colors.alertWash } : undefined}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Eyebrow color={active ? colors.alert : colors.inkFaint}>Trend Velocity Alert</Eyebrow>
          <Spacer h={1} />
          <Txt v="small" color={colors.inkFaint}>
            Early Cognitive Tension Engine
          </Txt>
        </View>
        {trend.velocityPerDay !== null && (
          <Badge
            label={active ? 'Rising faster than usual' : trend.rising ? 'Rising normally' : 'Stable'}
            fg={active ? colors.alert : colors.calm}
            bg={active ? colors.surface : colors.calmWash}
          />
        )}
      </Row>

      {trend.series.length >= 2 && (
        <>
          <Spacer h={3} />
          <Sparkline
            values={trend.series}
            baseline={trend.expected}
            width={280}
            height={78}
            color={active ? colors.alert : colors.brown}
            fill
          />
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="small" color={colors.inkFaint}>
              ─ ─ your 7-day trajectory
            </Txt>
            {trend.surgePct !== null && (
              <Txt v="small" color={active ? colors.alert : colors.inkSoft}>
                Surge velocity {trend.surgePct > 0 ? '+' : ''}
                {trend.surgePct}%
              </Txt>
            )}
          </Row>
        </>
      )}

      <Spacer h={3} />
      <Txt v="small" color={colors.inkSoft}>
        {trend.reason}
      </Txt>
      {trend.velocityPerDay !== null && trend.usualVelocityPerDay !== null && (
        <>
          <Spacer h={2} />
          <Txt v="small" color={colors.inkFaint}>
            Climbing {trend.velocityPerDay} pts/day · your usual is {trend.usualVelocityPerDay}
          </Txt>
        </>
      )}
    </Card>
  );
}

function HistoryCard({ scans }: { scans: PpgScan[] }) {
  const recent = scans.slice(0, 6);
  return (
    <Card>
      <Eyebrow>Recent readings</Eyebrow>
      <Spacer h={3} />
      {recent.map((scan, i) => (
        <View key={scan.id}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Txt v="body">
                {scan.source === 'finger' ? '✋ Finger spot check' : '◉ Desk Mode burst'}
              </Txt>
              <Txt v="small" color={colors.inkFaint}>
                {new Date(scan.createdAt).toLocaleString([], {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Txt>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Txt v="body" color={scan.signalQuality === 'good' ? colors.ink : colors.inkFaint}>
                {scan.signalQuality === 'good' ? `${scan.heartRate} bpm` : 'discarded'}
              </Txt>
              <Txt v="small" color={colors.inkFaint}>
                {scan.signalQuality === 'good' ? `HRV ${scan.hrvRmssd} ms` : 'poor signal'}
              </Txt>
            </View>
          </Row>
          {i < recent.length - 1 && (
            <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }} />
          )}
        </View>
      ))}
    </Card>
  );
}
