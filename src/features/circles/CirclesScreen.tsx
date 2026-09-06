import React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import {
  acceptFriendRequest,
  declineFriendRequest,
  getCircleSummary,
  getFriends,
  getIncomingRequests,
  listChallenges,
  listSupportNudges,
  markNudgesSeen,
  MIN_CIRCLE_SIZE,
  sendCircleSupport,
  toggleChallenge,
} from '@/services/repository';
import type {
  ChallengeRow,
  CircleSummary,
  FriendSummary,
  IncomingRequest,
  SupportNudge,
} from '@/data/types';
import BottomNavigation from '@/components/bottombar';
import { formatSchedule, isPast } from './scheduling';

export default function CirclesScreen() {
  const router = useRouter();
  const [summary, setSummary] = React.useState<CircleSummary | null>(null);
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [requests, setRequests] = React.useState<IncomingRequest[]>([]);
  const [challenges, setChallenges] = React.useState<ChallengeRow[]>([]);
  const [sent, setSent] = React.useState<string | null>(null);
  const [nudges, setNudges] = React.useState<SupportNudge[]>([]);

  const load = React.useCallback(async () => {
    const [s, f, r, c, n] = await Promise.all([
      getCircleSummary(),
      getFriends(),
      getIncomingRequests(),
      listChallenges(),
      listSupportNudges(),
    ]);
    setSummary(s);
    setFriends(f);
    setRequests(r);
    setChallenges(c);
    setNudges(n);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  const support = async (message: string) => {
    const reached = await sendCircleSupport(message);
    setSent(
      reached === 0
        ? 'Nobody in your circle to reach yet.'
        : `Sent to whoever needed it — ${reached} ${reached === 1 ? 'person' : 'people'} in your circle. You will not be told who.`
    );
  };

  const [joinError, setJoinError] = React.useState<string | null>(null);

  // toggleChallenge throws when a challenge is full — the server enforces
  // capacity, so the client cannot assume its own count is current. Without
  // this the rejection was an unhandled promise and the tap just did nothing.
  const join = async (id: string) => {
    setJoinError(null);
    try {
      await toggleChallenge(id);
    } catch (e) {
      setJoinError(e instanceof Error ? e.message : 'Could not join that challenge');
    }
    setChallenges(await listChallenges());
  };

  return (
    <Screen footer={<BottomNavigation activeTab="Social" router={router} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="title">Wick ✳</Txt>
        <Eyebrow>Circles</Eyebrow>
      </Row>
      <Spacer h={5} />

      {/* ── Incoming requests ─────────────────────────────────────── */}
      {requests.length > 0 && (
        <>
          {requests.map((req) => (
            <View key={req.id}>
              <Card style={{ backgroundColor: colors.yellowWash, borderColor: colors.yellowDeep }}>
                <Eyebrow color={colors.brownSoft}>Friend request</Eyebrow>
                <Spacer h={2} />
                <Txt v="heading">{req.username} wants to join your circle</Txt>
                <Spacer h={3} />
                <Row gap={2}>
                  <Button
                    label="Accept"
                    style={{ flex: 1 }}
                    onPress={async () => {
                      await acceptFriendRequest(req.id);
                      load();
                    }}
                  />
                  <Button
                    label="Decline"
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={async () => {
                      await declineFriendRequest(req.id);
                      load();
                    }}
                  />
                </Row>
              </Card>
              <Spacer h={3} />
            </View>
          ))}
        </>
      )}

      {/* ── Support that arrived for you ──────────────────────────── */}
      {nudges.length > 0 && (
        <>
          <Card
            style={
              nudges.some((n) => !n.seenAt)
                ? { backgroundColor: colors.calmWash, borderColor: colors.calm }
                : undefined
            }
          >
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={2}>
                <Txt v="body">💛</Txt>
                <Txt v="heading">From your circle</Txt>
              </Row>
              {nudges.some((n) => !n.seenAt) && (
                <Badge
                  label={`${nudges.filter((n) => !n.seenAt).length} new`}
                  fg={colors.calm}
                  bg={colors.surface}
                />
              )}
            </Row>
            <Spacer h={3} />
            {nudges.slice(0, 3).map((n, i) => (
              <View key={n.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Txt v="body" color={n.seenAt ? colors.inkSoft : colors.ink}>
                    “{n.body}”
                  </Txt>
                  <Txt v="small" color={colors.inkFaint}>
                    {timeAgo(n.createdAt)}
                  </Txt>
                </Row>
                {i < Math.min(nudges.length, 3) - 1 && (
                  <View
                    style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }}
                  />
                )}
              </View>
            ))}
            <Spacer h={4} />
            {/* No sender, in both directions. Whoever sent this was never told
                who in their circle was struggling, and you are never told who
                reached out — which is what makes it safe to send and safe to
                receive. What survives the anonymity is the part that helps. */}
            <Txt v="small" color={colors.inkFaint}>
              Someone in your circle sent this. Wick will not tell you who, and it never told them
              who it was going to.
            </Txt>
            {nudges.some((n) => !n.seenAt) && (
              <>
                <Spacer h={3} />
                <Button
                  label="Thanks — clear these"
                  variant="soft"
                  onPress={async () => {
                    await markNudgesSeen();
                    setNudges(await listSupportNudges());
                  }}
                />
              </>
            )}
          </Card>
          <Spacer h={3} />
        </>
      )}

      {/* ── Circles Pulse ─────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Circles Pulse</Txt>
          <Badge
            label={`${friends.length} ${friends.length === 1 ? 'friend' : 'friends'}`}
            fg={colors.brownSoft}
            bg={colors.yellowWash}
          />
        </Row>
        <Spacer h={3} />

        {summary?.suppressed ? (
          <SuppressedPulse friendCount={friends.length} onAdd={() => router.push('/add-friend')} />
        ) : (
          summary && (
            <>
              <Txt v="title" color={colors.alert}>
                {summary.redZoneCount} of {summary.totalFriends}
              </Txt>
              <Spacer h={1} />
              <Txt v="body" color={colors.inkSoft}>
                friends in your circle are in the Red Zone right now.
              </Txt>
              <Spacer h={4} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Eyebrow>Autonomic nervous system capacity</Eyebrow>
                <Txt v="heading">{summary.avgCapacity ?? '—'}%</Txt>
              </Row>
              <Spacer h={2} />
              <Bar pct={summary.avgCapacity ?? 0} color={colors.calm} />
            </>
          )
        )}

        <Spacer h={4} />
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          🔒 Anonymised signals only. Wick shows counts, never a named friend's score — and shows
          nothing at all below {MIN_CIRCLE_SIZE} friends, where a count would give away an individual.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Anonymous support ─────────────────────────────────────── */}
      {summary && !summary.suppressed && (summary.redZoneCount ?? 0) > 0 && (
        <>
          <Card>
            <Row gap={2}>
              <Txt v="body">💛</Txt>
              <Txt v="heading">Someone in your circle is overloaded</Txt>
            </Row>
            <Spacer h={2} />
            <Txt v="small" color={colors.inkSoft}>
              Send a quick word of support. You will not be told who is struggling, and they will not
              be told that Wick prompted you.
            </Txt>
            <Spacer h={3} />
            <Row gap={2}>
              <Button
                label="You got this"
                variant="soft"
                style={{ flex: 1 }}
                onPress={() => support('You got this')}
              />
              <Button
                label="Take a break"
                variant="soft"
                style={{ flex: 1 }}
                onPress={() => support('Take a break')}
              />
            </Row>
            {sent && (
              <>
                <Spacer h={3} />
                <View style={{ backgroundColor: colors.calmWash, borderRadius: radius.sm, padding: spacing(3) }}>
                  <Txt v="small" color={colors.calm}>
                    {sent}
                  </Txt>
                </View>
              </>
            )}
          </Card>
          <Spacer h={3} />
        </>
      )}

      {/* ── Shared challenges ─────────────────────────────────────── */}
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="heading">Shared Challenges</Txt>
        <Row gap={4}>
          <Pressable onPress={() => router.push('/my-challenges')} accessibilityRole="button">
            <Txt v="small" color={colors.brown}>
              Yours
            </Txt>
          </Pressable>
          <Pressable onPress={() => router.push('/new-challenge')} accessibilityRole="button">
            <Txt v="small" color={colors.brown}>
              + New
            </Txt>
          </Pressable>
        </Row>
      </Row>
      <Spacer h={3} />

      {joinError && (
        <>
          <View
            style={{ backgroundColor: colors.alertWash, borderRadius: radius.sm, padding: spacing(3) }}
          >
            <Txt v="small" color={colors.alert}>
              {joinError}
            </Txt>
          </View>
          <Spacer h={3} />
        </>
      )}

      {/* Past meetups sink to the bottom rather than vanishing: people still
          want to mark one done, and deleting other people's history is not
          this screen's call. */}
      {[...challenges]
        .sort(
          (a, b) =>
            Number(a.cancelled || isPast(a.scheduledFor)) -
            Number(b.cancelled || isPast(b.scheduledFor))
        )
        .map((ch) => (
        <View key={ch.id}>
          <Pressable
            onPress={() => router.push({ pathname: '/challenge', params: { id: ch.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${ch.title}, view details`}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <Card style={ch.cancelled ? { opacity: 0.6 } : undefined}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: spacing(3) }}>
                  <Row gap={2}>
                    <Txt v="body">{categoryIcon(ch.category)}</Txt>
                    <Txt v="heading">{ch.title}</Txt>
                  </Row>
                  <Spacer h={1} />
                  <Txt v="small" color={colors.inkFaint}>
                    {ch.kind === 'meetup' ? '📍 Meet up' : '🏠 Together, apart'}
                    {ch.scheduledFor ? ` · ${formatSchedule(ch.scheduledFor)}` : ''}
                  </Txt>
                </View>
                <Button
                  label={ch.cancelled ? 'Cancelled' : ch.joined ? 'Joined' : '+ Join'}
                  variant={ch.joined ? 'soft' : 'ghost'}
                  style={{ height: 38, paddingHorizontal: spacing(4) }}
                  onPress={() => join(ch.id)}
                  disabled={ch.cancelled && !ch.joined}
                />
              </Row>
              <Spacer h={3} />
              <Bar
                pct={
                  ch.capacity
                    ? (ch.joinedCount / ch.capacity) * 100
                    : ch.circleSize
                      ? (ch.joinedCount / ch.circleSize) * 100
                      : 0
                }
                color={colors.yellowDeep}
              />
              <Spacer h={2} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="small" color={colors.inkFaint}>
                  {ch.joinedCount} joined
                  {ch.capacity !== null ? ` · ${Math.max(0, ch.capacity - ch.joinedCount)} spots left` : ''}
                </Txt>
                <Txt v="small" color={colors.inkFaint}>
                  Details ›
                </Txt>
              </Row>
            </Card>
          </Pressable>
          <Spacer h={3} />
        </View>
      ))}

      <Button
        label="+ Create a challenge"
        variant="ghost"
        onPress={() => router.push('/new-challenge')}
      />
      <Spacer h={3} />
      <Button
        label="What you have joined"
        variant="ghost"
        onPress={() => router.push('/my-challenges')}
      />
      <Spacer h={3} />

      <Spacer h={2} />
      <Button label="Add a friend" variant="ghost" onPress={() => router.push('/add-friend')} />
      <Spacer h={3} />
    </Screen>
  );
}

function SuppressedPulse({ friendCount, onAdd }: { friendCount: number; onAdd: () => void }) {
  const needed = MIN_CIRCLE_SIZE - friendCount;
  return (
    <View>
      <Txt v="title" color={colors.inkSoft}>
        Not enough people yet
      </Txt>
      <Spacer h={2} />
      <Txt v="small" color={colors.inkSoft}>
        With {friendCount} {friendCount === 1 ? 'friend' : 'friends'}, any aggregate would point
        straight at an individual — "1 of 2 in the red zone" is a personal disclosure, not a
        statistic. Add {needed} more and the pulse switches on.
      </Txt>
      <Spacer h={3} />
      <Button label="Add a friend" variant="soft" onPress={onAdd} />
    </View>
  );
}

/*
 * The seven-day dot grid used to live here. It generated a week of colours from
 * today's single ratio through a sine wave — it read as history and was
 * decoration, in a card whose whole claim is that the numbers on it are real.
 * Removed rather than restyled. It comes back when there is a stored daily
 * aggregate to draw, which needs a server-side rollup that respects the same
 * k-anonymity floor as the rest of this card.
 */

/** "3m ago" / "2d ago". Nudges are about recency, not timestamps. */
function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function categoryIcon(category: ChallengeRow['category']) {
  return category === 'physical' ? '🚶' : category === 'social' ? '💬' : '🍵';
}
