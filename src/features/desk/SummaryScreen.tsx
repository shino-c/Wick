import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { Sparkline } from '@/components/charts';
import { colors, spacing } from '@/theme';
import {
  personalAccuracy,
  recomputeFusedScore,
  saveAccuracyFeedback,
  saveSession,
} from '@/services/repository';
import type { AccuracyVerdict } from '@/data/types';
import { takeSessionSummary } from './sessionHandoff';

export default function SummaryScreen() {
  const router = useRouter();
  // Read once on mount: the handoff slot is consumed, so a refresh or deep link
  // lands on the empty state below rather than a stale session.
  const [summary] = React.useState(takeSessionSummary);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [verdict, setVerdict] = React.useState<AccuracyVerdict | null>(null);
  const [accuracy, setAccuracy] = React.useState<{ pct: number | null; samples: number }>({
    pct: null,
    samples: 0,
  });

  React.useEffect(() => {
    if (!summary) return;
    (async () => {
      const id = await saveSession({
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        plannedMinutes: summary.plannedMinutes,
        actualMinutes: summary.actualMinutes,
        breaksTaken: summary.breaksTaken,
        enforcedBreaks: summary.enforcedBreaks,
        stressDeltaPct: summary.stressDeltaPct,
        soundscape: null,
      });
      setSessionId(id);
      await recomputeFusedScore();
      setAccuracy(await personalAccuracy());
    })();
  }, [summary]);

  const record = async (v: AccuracyVerdict) => {
    setVerdict(v);
    await saveAccuracyFeedback(v, { sessionId });
    setAccuracy(await personalAccuracy());
  };

  if (!summary) {
    return (
      <Screen>
        <NavBar title="Completed session" />
        <Spacer h={6} />
        <Txt v="title">No session to show</Txt>
        <Spacer h={2} />
        <Txt v="body" color={colors.inkSoft}>
          This summary is generated at the end of a focus session and isn't kept afterwards.
        </Txt>
        <Spacer h={5} />
        <Button label="Back to Desk" onPress={() => router.replace('/desk')} />
      </Screen>
    );
  }

  const curve = summary.readings
    .filter((r) => r.deviationPct !== null)
    .map((r) => r.deviationPct as number);
  const delta = summary.stressDeltaPct;
  const improved = delta !== null && delta < 0;

  return (
    <Screen>
      <NavBar title="Completed session" />

      <Eyebrow>Focus block summary</Eyebrow>
      <Spacer h={2} />
      <Txt v="display">{summary.actualMinutes} min completed</Txt>
      <Spacer h={5} />

      <Row gap={3}>
        <Stat label="Breaks taken" value={`${summary.breaksTaken}`} caption="adaptive" />
        <Stat
          label="Stress delta"
          value={delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}%`}
          caption={delta === null ? 'not enough reads' : improved ? 'lower' : 'higher'}
          tone={delta === null ? colors.inkFaint : improved ? colors.calm : colors.warn}
        />
        <Stat
          label="Readings"
          value={`${summary.readings.length}`}
          caption={`${summary.readings.filter((r) => r.quality === 'poor').length} discarded`}
        />
      </Row>

      <Spacer h={4} />

      {curve.length >= 2 && (
        <Card>
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="heading">Session stress curve</Txt>
            <Txt v="small" color={colors.inkFaint}>
              HRV deviation
            </Txt>
          </Row>
          <Spacer h={3} />
          <Sparkline
            values={curve}
            width={280}
            height={80}
            color={colors.brown}
            fill
            markerIndex={summary.enforcedAtIndex ?? undefined}
          />
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt v="small" color={colors.inkFaint}>
              Started
            </Txt>
            {summary.enforcedAtIndex !== null && (
              <Txt v="small" color={colors.alert}>
                ┆ enforced break
              </Txt>
            )}
            <Txt v="small" color={colors.inkFaint}>
              Ended
            </Txt>
          </Row>
        </Card>
      )}

      <Spacer h={3} />

      {summary.enforcedBreaks > 0 && (
        <>
          <Card style={{ backgroundColor: colors.alertWash, borderColor: colors.alertWash }}>
            <Row gap={2}>
              <Txt v="body">⏸</Txt>
              <Txt v="heading" color={colors.alert}>
                {summary.enforcedBreaks} enforced stress break
                {summary.enforcedBreaks === 1 ? '' : 's'}
              </Txt>
            </Row>
            <Spacer h={2} />
            <Txt v="small" color={colors.inkSoft}>
              Focus was paused because two consecutive readings showed sustained high stress. Guided
              breathing ran for a full minute before the timer resumed.
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

      {/* ── Ground truth ──────────────────────────────────────────── */}
      <Card>
        <Txt v="heading">Did that feel accurate?</Txt>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkSoft}>
          Your vitals indicated{' '}
          {delta === null
            ? 'no clear change'
            : improved
              ? 'your strain easing across the session'
              : 'strain building across the session'}
          . Did that match your actual experience?
        </Txt>
        <Spacer h={3} />
        <Row gap={2}>
          {(
            [
              ['spot_on', 'Spot on'],
              ['slightly_off', 'Slightly off'],
              ['way_off', 'Way off'],
            ] as [AccuracyVerdict, string][]
          ).map(([value, label]) => (
            <Button
              key={value}
              label={label}
              variant={verdict === value ? 'primary' : 'ghost'}
              onPress={() => record(value)}
              style={{ flex: 1, height: 44, paddingHorizontal: spacing(1) }}
            />
          ))}
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          Your answer trains your calibration loop and overrides standard model bias.
        </Txt>
      </Card>

      <Spacer h={3} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Personal Accuracy</Txt>
          <Row gap={2}>
            <Txt v="title" color={accuracy.pct === null ? colors.inkFaint : colors.brown}>
              {accuracy.pct === null ? '—' : `${accuracy.pct}%`}
            </Txt>
            <Badge label="match" fg={colors.brownSoft} bg={colors.yellowWash} />
          </Row>
        </Row>
        <Spacer h={2} />
        <Bar pct={accuracy.pct ?? 0} color={colors.yellowDeep} />
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          {accuracy.samples === 0
            ? 'Confirm this reading to start building your accuracy score.'
            : `Based on ${accuracy.samples} verified calibration sample${accuracy.samples === 1 ? '' : 's'}`}
        </Txt>
      </Card>

      <Spacer h={5} />
      <Button
        label="Back to Desk"
        onPress={() => router.replace('/desk')}
      />
      <Spacer h={3} />
    </Screen>
  );
}

function Stat({
  label,
  value,
  caption,
  tone = colors.ink,
}: {
  label: string;
  value: string;
  caption: string;
  tone?: string;
}) {
  return (
    <View style={{ flex: 1 }}>
      <Eyebrow>{label}</Eyebrow>
      <Spacer h={2} />
      <Txt v="title" color={tone}>
        {value}
      </Txt>
      <Txt v="small" color={colors.inkFaint}>
        {caption}
      </Txt>
    </View>
  );
}
