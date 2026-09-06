import React from 'react';
import { Pressable, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import { DotWeek } from '@/components/charts';
import { colors, radius, spacing } from '@/theme';
import {
  acceptFriendRequest,
  declineFriendRequest,
  getCircleSummary,
  getFriends,
  getIncomingRequests,
  listChallenges,
  MIN_CIRCLE_SIZE,
  sendCircleSupport,
  toggleChallenge,
} from '@/services/repository';
import type { ChallengeRow, CircleSummary, FriendSummary, IncomingRequest } from '@/data/types';
import BottomNavigation from '@/components/bottombar';

export default function CirclesScreen() {
  const router = useRouter();
  const [summary, setSummary] = React.useState<CircleSummary | null>(null);
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [requests, setRequests] = React.useState<IncomingRequest[]>([]);
  const [challenges, setChallenges] = React.useState<ChallengeRow[]>([]);
  const [sent, setSent] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    const [s, f, r, c] = await Promise.all([
      getCircleSummary(),
      getFriends(),
      getIncomingRequests(),
      listChallenges(),
    ]);
    setSummary(s);
    setFriends(f);
    setRequests(r);
    setChallenges(c);
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

  const join = async (id: string) => {
    await toggleChallenge(id);
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
              <DotWeek tones={weekTones(summary)} />
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
        <Pressable onPress={() => router.push('/new-challenge')} accessibilityRole="button">
          <Txt v="small" color={colors.brown}>
            + New
          </Txt>
        </Pressable>
      </Row>
      <Spacer h={3} />

      {challenges.map((ch) => (
        <View key={ch.id}>
          <Pressable
            onPress={() => router.push({ pathname: '/challenge', params: { id: ch.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${ch.title}, view details`}
            style={({ pressed }) => [pressed && { opacity: 0.85 }]}
          >
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <View style={{ flex: 1, paddingRight: spacing(3) }}>
                  <Row gap={2}>
                    <Txt v="body">{categoryIcon(ch.category)}</Txt>
                    <Txt v="heading">{ch.title}</Txt>
                  </Row>
                  <Spacer h={1} />
                  <Txt v="small" color={colors.inkFaint}>
                    {ch.subtitle}
                    {ch.scheduledFor ? ` · ${ch.scheduledFor}` : ''}
                  </Txt>
                </View>
                <Button
                  label={ch.joined ? 'Joined' : '+ Join'}
                  variant={ch.joined ? 'soft' : 'ghost'}
                  style={{ height: 38, paddingHorizontal: spacing(4) }}
                  onPress={() => join(ch.id)}
                />
              </Row>
              <Spacer h={3} />
              <Bar
                pct={ch.circleSize ? (ch.joinedCount / ch.circleSize) * 100 : 0}
                color={colors.yellowDeep}
              />
              <Spacer h={2} />
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt v="small" color={colors.inkFaint}>
                  {ch.joinedCount} of {ch.circleSize} joined
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

/** Weekly dot grid. Deterministic from the aggregate — never per-friend data. */
function weekTones(summary: CircleSummary): string[] {
  const ratio = summary.totalFriends ? (summary.redZoneCount ?? 0) / summary.totalFriends : 0;
  return Array.from({ length: 7 }, (_, i) => {
    const load = ratio * (0.6 + 0.4 * Math.sin((i / 6) * Math.PI));
    if (load > 0.5) return colors.alert;
    if (load > 0.25) return colors.warn;
    return colors.calm;
  });
}

function categoryIcon(category: ChallengeRow['category']) {
  return category === 'physical' ? '🚶' : category === 'social' ? '💬' : '🍵';
}
