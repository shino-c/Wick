import React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import { listChallenges } from '@/services/repository';
import type { ChallengeRow } from '@/data/types';
import { formatSchedule, isPast } from './scheduling';

/**
 * What you have actually done.
 *
 * The Circles screen answers "what could I join?". Nothing answered "what did I
 * join, and did I follow through?" — so joining a challenge had no consequence
 * a week later, and the one number worth being proud of (how many you finished)
 * existed nowhere.
 *
 * This is deliberately about YOU. It shows your own record, not a leaderboard:
 * ranking a circle by recovery activity would turn rest into another thing to
 * compete at, which is the opposite of the point.
 */
export default function ChallengeHistoryScreen() {
  const router = useRouter();
  const [challenges, setChallenges] = React.useState<ChallengeRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setChallenges(await listChallenges());
    setLoading(false);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const mine = challenges.filter((c) => c.joined);
  const done = mine.filter((c) => c.completedByMe);
  const verified = done.filter((c) => c.verifiedByMe);
  const openNow = mine.filter((c) => !c.completedByMe && !isPast(c.scheduledFor));
  const missed = mine.filter((c) => !c.completedByMe && isPast(c.scheduledFor));

  return (
    <Screen>
      <NavBar title="Your challenges" onBack={() => router.back()} />

      {loading ? null : mine.length === 0 ? (
        <>
          <Spacer h={6} />
          <Txt v="title">Nothing yet</Txt>
          <Spacer h={2} />
          <Txt v="body" color={colors.inkSoft}>
            Challenges you join will collect here, along with whether you finished them. Joining one
            is a low-stakes way to start — nobody is told why you did.
          </Txt>
          <Spacer h={5} />
          <Button label="Browse challenges" onPress={() => router.back()} />
        </>
      ) : (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt v="heading">Finished</Txt>
              <Txt v="title" color={colors.calm}>
                {done.length} of {mine.length}
              </Txt>
            </Row>
            <Spacer h={3} />
            <Bar pct={mine.length ? (done.length / mine.length) * 100 : 0} color={colors.calm} />
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              {verified.length > 0
                ? `${verified.length} of those were measured — Wick took a pulse reading while you did them.`
                : 'None measured yet. Challenges marked "breathing check" or "spot check" record what they did to your HRV.'}
            </Txt>
          </Card>

          <Spacer h={5} />

          <Section title="Still open" rows={openNow} router={router} empty="Nothing outstanding." />
          <Section title="Completed" rows={done} router={router} empty="Nothing finished yet." />
          <Section
            title="Passed without finishing"
            rows={missed}
            router={router}
            empty="Nothing missed."
            muted
          />

          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint} center>
            Missing one is not a failure state and Wick does not treat it as one. It is here so the
            list is honest, not to make a point.
          </Txt>
          <Spacer h={5} />
        </>
      )}
    </Screen>
  );
}

function Section({
  title,
  rows,
  router,
  empty,
  muted,
}: {
  title: string;
  rows: ChallengeRow[];
  router: ReturnType<typeof useRouter>;
  empty: string;
  muted?: boolean;
}) {
  return (
    <>
      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>{title}</Eyebrow>
        <Txt v="small" color={colors.inkFaint}>
          {rows.length}
        </Txt>
      </Row>
      <Spacer h={3} />
      {rows.length === 0 ? (
        <>
          <Txt v="small" color={colors.inkFaint}>
            {empty}
          </Txt>
          <Spacer h={5} />
        </>
      ) : (
        <>
          {rows.map((ch) => (
            <View key={ch.id}>
              <Pressable
                onPress={() => router.push({ pathname: '/challenge', params: { id: ch.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${ch.title}, view details`}
                style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              >
                <Card style={muted ? { opacity: 0.7 } : undefined}>
                  <Row style={{ justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: spacing(3) }}>
                      <Txt v="heading">{ch.title}</Txt>
                      <Spacer h={1} />
                      <Txt v="small" color={colors.inkFaint}>
                        {ch.kind === 'meetup' ? '📍 Meet up' : '🏠 Together, apart'} ·{' '}
                        {formatSchedule(ch.scheduledFor)}
                      </Txt>
                    </View>
                    {ch.completedByMe && (
                      <Badge
                        label={ch.verifiedByMe ? '✓✓ measured' : '✓ done'}
                        fg={colors.calm}
                        bg={colors.calmWash}
                      />
                    )}
                  </Row>
                  {ch.completedByMe && ch.verifiedByMe && (
                    <>
                      <Spacer h={3} />
                      <View
                        style={{
                          backgroundColor: colors.calmWash,
                          borderRadius: radius.sm,
                          padding: spacing(2.5),
                        }}
                      >
                        <Txt v="small" color={colors.calm}>
                          A pulse reading was taken while you did this.
                        </Txt>
                      </View>
                    </>
                  )}
                </Card>
              </Pressable>
              <Spacer h={3} />
            </View>
          ))}
          <Spacer h={2} />
        </>
      )}
    </>
  );
}
