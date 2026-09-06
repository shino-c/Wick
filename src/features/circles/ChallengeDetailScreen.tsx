import React from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Emoji, Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import {
  cancelChallenge,
  completeChallenge,
  deleteChallenge,
  getChallenge,
  toggleChallenge,
} from '@/services/repository';
import type { ChallengeRow } from '@/data/types';
import { formatSchedule, isPast } from './scheduling';

/** "2h ago" / "3d ago" — an edit notice is about recency, not timestamps. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

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
  // Deleting is only safe while nobody else is involved. After that the
  // challenge lives in other people's history and, for a meetup, in their
  // evening — so the creator gets "cancel" instead, which keeps the record.
  const othersJoined = challenge.participants.some((p) => !p.isMe);

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
          <Emoji size={24}>{meta.icon}</Emoji>
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

      {challenge.cancelled && (
        <>
          <Card style={{ backgroundColor: colors.alertWash, borderColor: colors.alertWash }}>
            <Txt v="heading" color={colors.alert}>
              This challenge was called off
            </Txt>
            <Spacer h={2} />
            <Txt v="small" color={colors.inkSoft}>
              Whoever created it cancelled it. It stays here rather than disappearing, so anyone who
              was counting on it can see what happened — and anyone who already did it keeps the
              credit.
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

      {challenge.updatedAt && !challenge.cancelled && (
        <>
          <Card style={{ backgroundColor: colors.yellowWash, borderColor: colors.yellowDeep }}>
            <Txt v="small" color={colors.brownSoft}>
              ✎ Details changed {timeAgo(challenge.updatedAt)} — check the time and place before you
              set off.
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <Eyebrow>When</Eyebrow>
            <Spacer h={1} />
            <Txt v="heading">{formatSchedule(challenge.scheduledFor)}</Txt>
          </View>
          {challenge.cancelled ? (
            <Badge label="Cancelled" fg={colors.alert} bg={colors.alertWash} />
          ) : (
            past && <Badge label="Passed" fg={colors.inkSoft} bg={colors.line} />
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
                    {p.verified ? '✓✓ measured' : '✓ done'}
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
            {challenge.verifyWith && !challenge.completedByMe ? (
              <>
                <Button
                  label={
                    challenge.verifyWith === 'breathing'
                      ? 'Do the breathing check now'
                      : 'Take the spot check now'
                  }
                  onPress={() =>
                    router.push(
                      challenge.verifyWith === 'breathing'
                        ? { pathname: '/breathing', params: { challenge: challenge.id } }
                        : { pathname: '/spot-check', params: { challenge: challenge.id } }
                    )
                  }
                  disabled={busy}
                />
                <Spacer h={2} />
                {/* Still offered. A challenge you did on someone else's phone,
                    or away from yours, is still a challenge you did — refusing
                    to accept that would just teach people to lie to the app. */}
                <Button
                  label="I did it elsewhere"
                  variant="ghost"
                  onPress={() => run(() => completeChallenge(challenge.id, true, false))}
                  disabled={busy}
                />
              </>
            ) : (
              <Button
                label={challenge.completedByMe ? '✓ You did it' : 'Mark as done'}
                variant={challenge.completedByMe ? 'soft' : 'primary'}
                onPress={() => run(() => completeChallenge(challenge.id, !challenge.completedByMe))}
                disabled={busy}
              />
            )}

            {challenge.completedByMe && (
              <>
                <Spacer h={3} />
                <View
                  style={{
                    backgroundColor: challenge.verifiedByMe ? colors.calmWash : colors.yellowWash,
                    borderRadius: radius.sm,
                    padding: spacing(3),
                  }}
                >
                  <Txt
                    v="small"
                    color={challenge.verifiedByMe ? colors.calm : colors.brownSoft}
                  >
                    {challenge.verifiedByMe
                      ? '✓✓ Measured. A pulse reading was taken while you did this, so this one is not just your word.'
                      : '✓ Self-reported. Wick is taking your word for it, which is the right thing to do for anything it cannot see.'}
                  </Txt>
                </View>
                <Spacer h={3} />
                <Button
                  label="Undo"
                  variant="ghost"
                  onPress={() => run(() => completeChallenge(challenge.id, false))}
                  disabled={busy}
                />
              </>
            )}

            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              {challenge.verifyWith
                ? 'This one can be measured, so it is. Wick can witness you sitting still and breathing — it cannot witness a walk round a lake, and it does not pretend to.'
                : 'Wick takes your word for this. It can verify a breathing break from your own vitals, but it cannot verify a walk with friends, and pretending otherwise would be worse than trusting you.'}
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
            : challenge.cancelled
              ? 'Cancelled'
              : past
                ? 'This one has already happened'
                : full
                  ? 'Challenge is full'
                  : 'Join challenge'
        }
        variant={challenge.joined ? 'ghost' : 'primary'}
        onPress={() => run(() => toggleChallenge(challenge.id))}
        disabled={busy || full || ((past || challenge.cancelled) && !challenge.joined)}
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

          {/* Two different operations, and which one you get is not a setting.
              Alone, the challenge is yours to remove. Once somebody else has
              joined it is in their history and possibly in their evening, so it
              can only be called off — the record stays, marked. */}
          {challenge.cancelled ? (
            <>
              <Button
                label="Reinstate challenge"
                variant="soft"
                onPress={() => run(() => cancelChallenge(challenge.id, false))}
                disabled={busy}
              />
              <Spacer h={2} />
              <Txt v="small" color={colors.inkFaint} center>
                Puts it back, open to joins again.
              </Txt>
            </>
          ) : othersJoined ? (
            <>
              <Button
                label="Cancel challenge"
                variant="danger"
                onPress={() => run(() => cancelChallenge(challenge.id, true))}
                disabled={busy}
              />
              <Spacer h={2} />
              <Txt v="small" color={colors.inkFaint} center>
                {challenge.joinedCount - 1}{' '}
                {challenge.joinedCount - 1 === 1 ? 'other person has' : 'other people have'} joined,
                so this is called off rather than deleted. They keep it in their history, and
                anyone who already did it keeps the credit.
              </Txt>
            </>
          ) : (
            <>
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
                Nobody else has joined yet, so this removes it completely.
              </Txt>
            </>
          )}
        </>
      )}

      <Spacer h={5} />
    </Screen>
  );
}
