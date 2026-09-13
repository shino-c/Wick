import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Chip, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { Sparkline } from '@/components/charts';
import { colors, spacing } from '@/theme';
import { toISODate } from '@/services/dateUtils';
import { rememberCategoryOverride } from '@/services/nudgeService';
import {
  getTaskAnalyses,
  personalAccuracy,
  recomputeFusedScore,
  saveAccuracyFeedback,
  saveSession,
  setSessionCategory,
} from '@/services/repository';
import type { AccuracyVerdict, TaskAnalysis } from '@/data/types';
import { takeSessionSummary } from './sessionHandoff';

/** What a focus block can plausibly have been. Deliberately short. */
const CATEGORIES: { value: string; label: string }[] = [
  { value: 'academic', label: 'Study' },
  { value: 'work', label: 'Work' },
  { value: 'errands', label: 'Admin' },
  { value: 'other', label: 'Something else' },
];

const HH_MM = (d: Date) => d.getHours() * 60 + d.getMinutes();

/**
 * The task the block overlapped, used only as a guess to pre-fill.
 *
 * Overlap, not containment: a 45-minute block started ten minutes into a
 * two-hour library slot is obviously that slot's work, and requiring the
 * session to sit entirely inside the event would reject most real sessions.
 */
function guessTask(tasks: TaskAnalysis[], startedAt: string): TaskAnalysis | null {
  const start = new Date(startedAt);
  const date = toISODate(start);
  const minute = HH_MM(start);
  const parse = (t?: string): number | null => {
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    return Number.isNaN(h) || Number.isNaN(m) ? null : h * 60 + m;
  };
  return (
    tasks.find((t) => {
      if (t.scheduled_date !== date || t.allDay) return false;
      const s = parse(t.scheduled_start_time);
      const e = parse(t.scheduled_end_time);
      return s !== null && e !== null && minute >= s - 15 && minute < e;
    }) ?? null
  );
}

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

  // What the block was for. Pre-filled from the task the user came in with, or
  // from whatever was on the calendar at the time — never left blank for them
  // to fill in from nothing.
  const [category, setCategory] = React.useState<string | null>(summary?.category ?? null);
  const [taskId, setTaskId] = React.useState<string | null>(summary?.taskId ?? null);
  const [taskTitle, setTaskTitle] = React.useState<string | null>(summary?.taskTitle ?? null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [correcting, setCorrecting] = React.useState(false);
  // What was pre-filled, so a confirmation can be told apart from a correction.
  // Only a correction is worth teaching the classifier.
  const guessedCategory = React.useRef<string | null>(summary?.category ?? null);

  React.useEffect(() => {
    if (!summary) return;
    (async () => {
      // Written immediately, before the user has been asked anything. Waiting
      // for the answer would mean a session nobody categorises is a session
      // that was never saved at all.
      const id = await saveSession({
        startedAt: summary.startedAt,
        endedAt: summary.endedAt,
        plannedMinutes: summary.plannedMinutes,
        actualMinutes: summary.actualMinutes,
        breaksTaken: summary.breaksTaken,
        enforcedBreaks: summary.enforcedBreaks,
        stressDeltaPct: summary.stressDeltaPct,
        soundscape: summary.soundscape,
        taskId: summary.taskId ?? null,
        category: summary.category ?? null,
      });
      setSessionId(id);

      // No task came through the nudge, so fall back to the calendar.
      if (!summary.taskId) {
        const guess = guessTask(await getTaskAnalyses(), summary.startedAt);
        if (guess) {
          setTaskId(guess.id);
          setTaskTitle(guess.title);
          setCategory((current) => current ?? guess.category);
          guessedCategory.current ??= guess.category;
        }
      }

      await recomputeFusedScore();
      setAccuracy(await personalAccuracy());
    })();
  }, [summary]);

  /**
   * One tap confirms the guess; a correction also teaches the classifier.
   * "CS101" will never read as academic on its own, so a category the user
   * fixes by hand is remembered against the title — which survives the nightly
   * resync that rebuilds every calendar row from scratch.
   */
  const chooseCategory = async (value: string) => {
    setCategory(value);
    setConfirmed(true);
    setCorrecting(false);
    if (sessionId) await setSessionCategory(sessionId, value, taskId);
    if (taskTitle && value !== guessedCategory.current) {
      await rememberCategoryOverride(taskTitle, value);
      guessedCategory.current = value;
    }
  };

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
        {/* Two different failures, counted separately. A "poor" reading reached
            the filter and came out unusable; a discarded window never became a
            reading at all because nobody was in frame. Lumping them together
            under-reported the second, which is the one that means the phone is
            pointed at an empty chair. */}
        <Stat
          label="Readings"
          value={`${summary.readings.length}`}
          caption={`${summary.readings.filter((r) => r.quality === 'poor').length} noisy · ${summary.discardedWindows} no face`}
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

      {summary.movementSessionPct !== null && (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt v="heading">Restlessness</Txt>
              <Txt v="heading" color={summary.movementSessionPct > 0.35 ? colors.warn : colors.calm}>
                {Math.round(summary.movementSessionPct * 100)}% of the block
              </Txt>
            </Row>
            <Spacer h={3} />
            <Bar
              pct={summary.movementSessionPct * 100}
              color={summary.movementSessionPct > 0.35 ? colors.warn : colors.calm}
            />
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              {summary.sensingMode === 'saver'
                ? 'Measured only during sampling windows, so treat it as a sample rather than a total.'
                : 'Measured continuously across the whole block, not sampled — fidgeting between readings counts.'}
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

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

      {/* ── What it was for ───────────────────────────────────────────
          Deliberately a confirmation, not a question. An open "what did you
          work on?" at the end of a focus block is the kind of admin nobody
          fills in twice, and the answer is already knowable from the calendar
          — so Wick states its guess and makes changing it one tap. Skipping is
          a real option: the session is already saved either way. */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">What was this block?</Txt>
          {confirmed && <Badge label="logged" fg={colors.calm} bg={colors.calmWash} />}
        </Row>
        <Spacer h={2} />

        {category && !correcting ? (
          <>
            <Txt v="small" color={colors.inkSoft}>
              {taskTitle
                ? `Logged against ${taskTitle}.`
                : `Logged as ${CATEGORIES.find((c) => c.value === category)?.label ?? category}.`}
            </Txt>
            <Spacer h={3} />
            <Row gap={2}>
              <Button
                label={confirmed ? 'Saved' : 'That’s right'}
                variant={confirmed ? 'ghost' : 'primary'}
                onPress={() => chooseCategory(category)}
                style={{ flex: 1, height: 44 }}
              />
              <Button
                label="Actually…"
                variant="ghost"
                onPress={() => setCorrecting(true)}
                style={{ flex: 1, height: 44 }}
              />
            </Row>
          </>
        ) : (
          <>
            <Txt v="small" color={colors.inkSoft}>
              {correcting
                ? 'What was it really?'
                : 'Nothing on your calendar matched this block. Tag it, or leave it — either is fine.'}
            </Txt>
            <Spacer h={3} />
            <Row gap={2} style={{ flexWrap: 'wrap' }}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.value}
                  label={c.label}
                  active={category === c.value}
                  onPress={() => chooseCategory(c.value)}
                />
              ))}
            </Row>
          </>
        )}
      </Card>

      <Spacer h={3} />

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
