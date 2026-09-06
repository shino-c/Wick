import React from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import {
  completeChallenge,
  deleteChallenge,
  getChallenge,
  toggleChallenge,
} from '@/services/repository';
import type { ChallengeRow } from '@/data/types';
import { formatSchedule, isPast } from './scheduling';

const CATEGORY: Record<ChallengeRow['category'], { icon: string; label: string }> = {
  physical: { icon: '🚶', label: 'Active recovery' },
  social: { icon: '💬', label: 'Social recovery' },
  mental: { icon: '🍵', label: 'Mental downtime' },
};

export default function ChallengeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [challenge, setChallenge] = React.useState<ChallengeRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!id) return;
    setChallenge(await getChallenge(id));
    setLoading(false);
  }, [id]);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <NavBar title="Challenge" onBack={() => router.back()} />
      </Screen>
    );
  }

  if (!challenge) {
    return (
      <Screen>
        <NavBar title="Challenge" onBack={() => router.back()} />
        <Spacer h={6} />
        <Txt v="title">This challenge is gone</Txt>
        <Spacer h={2} />
        <Txt v="body" color={colors.inkSoft}>
          It may have been removed by whoever created it.
        </Txt>
        <Spacer h={5} />
        <Button label="Back to Circles" onPress={() => router.back()} />
      </Screen>
    );
  }

  const meta = CATEGORY[challenge.category];
  const isMeetup = challenge.kind === 'meetup';
  const spotsLeft =
    challenge.capacity === null ? null : Math.max(0, challenge.capacity - challenge.joinedCount);
  const full = spotsLeft === 0 && !challenge.joined;
  // A meetup whose time has been and gone should not still be recruiting.
  const past = isPast(challenge.scheduledFor);

  return (
    <Screen>
      <NavBar title="Challenge" onBack={() => router.back()} />

      <Row gap={3}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.lg,
            backgroundColor: colors.yellowWash,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Txt v="body" style={{ fontSize: 24 }}>
            {meta.icon}
          </Txt>
        </View>
        <View style={{ flex: 1 }}>
          <Row gap={2}>
            <Eyebrow>{meta.label}</Eyebrow>
            <Badge
              label={isMeetup ? 'Meet up' : 'Together, apart'}
              fg={colors.brownSoft}
              bg={colors.yellowWash}
            />
          </Row>
          <Spacer h={1} />
          <Txt v="title">{challenge.title}</Txt>
        </View>
      </Row>

      <Spacer h={5} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>When</Eyebrow>
            <Spacer h={1} />
            <Txt v="heading">{formatSchedule(challenge.scheduledFor)}</Txt>
          </View>
          {past && (
            <Badge label="Passed" fg={colors.inkSoft} bg={colors.line} />
          )}
          {challenge.joined && (
            <Badge
              label={challenge.completedByMe ? 'Done' : 'Joined'}
              fg={colors.calm}
              bg={colors.calmWash}
            />
          )}
        </Row>

        {isMeetup && challenge.location && (
          <>
            <Spacer h={4} />
            <Eyebrow>Where</Eyebrow>
            <Spacer h={1} />
            <Txt v="heading">📍 {challenge.location}</Txt>
          </>
        )}

        <Spacer h={4} />
        <Txt v="body" color={colors.inkSoft}>
          {challenge.notes ?? challenge.subtitle}
        </Txt>
        {!isMeetup && (
          <>
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              Nobody gathers for this one — everyone does it in their own space, in the same window.
            </Txt>
          </>
        )}
      </Card>

      <Spacer h={3} />

      {/* ── Who is in ─────────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Who is in</Txt>
          <Txt v="heading" color={colors.brown}>
            {challenge.joinedCount}
            {challenge.capacity !== null ? ` / ${challenge.capacity}` : ''}
          </Txt>
        </Row>

        {challenge.capacity !== null && (
          <>
            <Spacer h={3} />
            <Bar
              pct={(challenge.joinedCount / challenge.capacity) * 100}
              color={full ? colors.warn : colors.yellowDeep}
            />
            <Spacer h={2} />
            <Txt v="small" color={full ? colors.warn : colors.inkFaint}>
              {full
                ? 'This challenge is full.'
                : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`}
            </Txt>
          </>
        )}

        <Spacer h={4} />

        {challenge.participants.length === 0 ? (
          <Txt v="small" color={colors.inkFaint}>
            Nobody has joined yet. Be first.
          </Txt>
        ) : (
          challenge.participants.map((p, i) => (
            <View key={p.userId}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={3}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: p.isMe ? colors.brown : colors.yellow,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt v="small" color={p.isMe ? '#FFFDF5' : colors.brown}>
                      {p.username.slice(0, 2).toUpperCase()}
                    </Txt>
                  </View>
                  <Txt v="body">{p.isMe ? 'You' : p.username}</Txt>
                </Row>
                {p.completed && (
                  <Txt v="small" color={colors.calm}>
                    ✓ done
                  </Txt>
                )}
              </Row>
              {i < challenge.participants.length - 1 && (
                <View
                  style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }}
                />
              )}
            </View>
          ))
        )}

        <Spacer h={4} />
        {/* Names are shown here on purpose. Joining a challenge is a voluntary
            social act between people already in your circle — it is not a
            stress signal. The anonymity rule applies to the red-zone count and
            the support nudge, which reveal that someone is struggling. */}
        <Txt v="small" color={colors.inkFaint}>
          {isMeetup
            ? 'You can see who is coming, so you know who you are meeting.'
            : 'Your circle can see you joined — never why Wick might have suggested it.'}
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Completion ────────────────────────────────────────────── */}
      {challenge.joined && (
        <>
          <Card>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt v="heading">Completed</Txt>
              <Txt v="heading" color={colors.calm}>
                {challenge.completedCount} of {challenge.joinedCount}
              </Txt>
            </Row>
            <Spacer h={3} />
            <Bar
              pct={
                challenge.joinedCount
                  ? (challenge.completedCount / challenge.joinedCount) * 100
                  : 0
              }
              color={colors.calm}
            />
            <Spacer h={4} />
            <Button
              label={challenge.completedByMe ? '✓ You did it' : 'Mark as done'}
              variant={challenge.completedByMe ? 'soft' : 'primary'}
              onPress={() => run(() => completeChallenge(challenge.id, !challenge.completedByMe))}
              disabled={busy}
            />
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              Wick takes your word for this. It can verify a breathing break from your own vitals,
              but it cannot verify a walk with friends — and pretending otherwise would be worse
              than trusting you.
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

      {error && (
        <>
          <View
            style={{ backgroundColor: colors.alertWash, borderRadius: radius.sm, padding: spacing(3) }}
          >
            <Txt v="small" color={colors.alert}>
              {error}
            </Txt>
          </View>
          <Spacer h={3} />
        </>
      )}

      <Button
        label={
          challenge.joined
            ? 'Leave challenge'
            : past
              ? 'This one has already happened'
              : full
                ? 'Challenge is full'
                : 'Join challenge'
        }
        variant={challenge.joined ? 'ghost' : 'primary'}
        onPress={() => run(() => toggleChallenge(challenge.id))}
        disabled={busy || full || (past && !challenge.joined)}
      />

      {challenge.createdByMe && (
        <>
          <Spacer h={3} />
          <Button
            label="Edit challenge"
            variant="ghost"
            onPress={() => router.push({ pathname: '/new-challenge', params: { id: challenge.id } })}
            disabled={busy}
          />
          <Spacer h={3} />
          <Button
            label="Delete challenge"
            variant="danger"
            onPress={() =>
              run(async () => {
                await deleteChallenge(challenge.id);
                router.back();
              })
            }
            disabled={busy}
          />
          <Spacer h={2} />
          <Txt v="small" color={colors.inkFaint} center>
            You created this. Deleting removes it for everyone in your circle.
          </Txt>
        </>
      )}

      <Spacer h={5} />
    </Screen>
  );
}
