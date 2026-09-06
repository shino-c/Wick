import React from 'react';
import { View } from 'react-native';
import Slider from '@react-native-community/slider';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import { sliderLabel } from '@/features/calibration/questionnaire';
import { getBaseline, latestSelfReport, saveSelfReport } from '@/services/repository';
import { BASELINE_MIN_SCANS } from '@/services/ppgService';
import { markOnboarded } from '@/lib/bootstrap';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Onboarding'>;

export default function OnboardingScreen({ navigation }: Props) {
  const [feeling, setFeeling] = React.useState(45);
  const [questionnaireScore, setQuestionnaireScore] = React.useState<number | null>(null);
  const [scanCount, setScanCount] = React.useState(0);
  const [saving, setSaving] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const [baseline, self] = await Promise.all([getBaseline(), latestSelfReport()]);
    setScanCount(baseline.scanCount);
    if (self?.rawAnswers) setQuestionnaireScore(self.score);
  }, []);

  React.useEffect(() => navigation.addListener('focus', refresh), [navigation, refresh]);

  const scansLeft = Math.max(0, BASELINE_MIN_SCANS - scanCount);

  const finish = async () => {
    setSaving(true);
    // The slider is itself a self-report; recording it means the very first
    // dashboard read already has one real signal rather than nothing.
    await saveSelfReport(Math.round(feeling), null);
    await markOnboarded();
    setSaving(false);
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  return (
    <Screen>
      <NavBar title="Set up" />

      <Txt v="display">Set Your Baseline</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        A gentle space tailored to your daily rhythm. Tell us how you are feeling today, and Wick will
        learn what normal looks like for you — not for an average student.
      </Txt>
      <Spacer h={5} />

      {/* ── Coarse first read ─────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">How stressed are you feeling?</Txt>
          <Badge label={sliderLabel(feeling)} fg={colors.brown} bg={colors.yellow} />
        </Row>
        <Spacer h={3} />
        <Slider
          value={feeling}
          onValueChange={setFeeling}
          minimumValue={0}
          maximumValue={100}
          step={1}
          minimumTrackTintColor={colors.yellowDeep}
          maximumTrackTintColor={colors.line}
          thumbTintColor={colors.brown}
          accessibilityLabel="Current stress level"
        />
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="small" color={colors.inkFaint}>
            ☾ Relaxed
          </Txt>
          <Txt v="small" color={colors.inkFaint}>
            Very stressed ⚡
          </Txt>
        </Row>
      </Card>

      <Spacer h={3} />

      {/* ── Questionnaire ─────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Row gap={2}>
              <Txt v="body">{questionnaireScore === null ? '○' : '✓'}</Txt>
              <Txt v="heading">Personal Baseline Assessment</Txt>
            </Row>
            <Txt v="small" color={colors.inkFaint}>
              5-item perceived stress ·{' '}
              {questionnaireScore === null ? 'Not started' : `Completed · ${questionnaireScore}/100`}
            </Txt>
          </View>
          <Button
            label={questionnaireScore === null ? 'Start' : 'Redo'}
            variant="ghost"
            style={{ height: 38, paddingHorizontal: spacing(4) }}
            onPress={() => navigation.navigate('Questionnaire', { firstRun: true })}
          />
        </Row>
      </Card>

      <Spacer h={3} />

      {/* ── Finger-PPG spot check ─────────────────────────────────── */}
      <Card>
        <Row gap={2}>
          <Txt v="body">✋</Txt>
          <Txt v="heading">Finger-PPG Spot Check</Txt>
        </Row>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          Place your index finger over the rear camera and flash for a one-minute reading. This is the
          most accurate signal Wick has, and it teaches the app your resting heart-rate variability.
        </Txt>
        <Spacer h={3} />
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>
            {scansLeft > 0
              ? `${scanCount}/${BASELINE_MIN_SCANS} scans`
              : `Baseline active · ${scanCount} scans`}
          </Eyebrow>
          <Txt v="small" color={colors.inkFaint}>
            {scansLeft > 0 ? `${scansLeft} more to unlock stress detection` : 'Stress detection on'}
          </Txt>
        </Row>
        <Spacer h={2} />
        <Bar pct={(Math.min(scanCount, BASELINE_MIN_SCANS) / BASELINE_MIN_SCANS) * 100} color={colors.yellowDeep} />
        <Spacer h={3} />
        <Button
          label="Start Spot Check"
          variant="soft"
          onPress={() => navigation.navigate('SpotCheck', { firstRun: true })}
        />
      </Card>

      <Spacer h={4} />

      <View
        style={{
          backgroundColor: colors.yellowWash,
          borderRadius: radius.md,
          padding: spacing(4),
          borderWidth: 1,
          borderColor: colors.line,
        }}
      >
        <Eyebrow color={colors.brownSoft}>Privacy</Eyebrow>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          Camera frames are reduced to a single brightness number on your device and thrown away
          immediately. No video is recorded, saved, or uploaded — only the resulting heart rate and
          HRV numbers are ever stored.
        </Txt>
      </View>

      <Spacer h={5} />
      <Button label="Continue to Wick  →" onPress={finish} loading={saving} />
      <Spacer h={3} />
      <Txt v="small" color={colors.inkFaint} center>
        You can complete the baseline later from the Calibrate tab.
      </Txt>
    </Screen>
  );
}
