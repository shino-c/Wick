import React from 'react';
import { View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { Badge, Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import { deleteChallenge, getChallenge, toggleChallenge } from '@/services/repository';
import type { ChallengeRow } from '@/data/types';

const CATEGORY: Record<ChallengeRow['category'], { icon: string; label: string; blurb: string }> = {
  physical: {
    icon: '🚶',
    label: 'Active recovery',
    blurb: 'Moving your body, somewhere that is not your desk.',
  },
  social: {
    icon: '💬',
    label: 'Social recovery',
    blurb: 'Contact with someone, on purpose rather than by accident.',
  },
  mental: {
    icon: '🍵',
    label: 'Mental downtime',
    blurb: 'Deliberately unstimulated time. No screens, no input.',
  },
};

export default function ChallengeDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [challenge, setChallenge] = React.useState<ChallengeRow | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

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

  const join = async () => {
    if (!challenge) return;
    setBusy(true);
    await toggleChallenge(challenge.id);
    await load();
    setBusy(false);
  };

  const remove = async () => {
    if (!challenge) return;
    setBusy(true);
    await deleteChallenge(challenge.id);
    setBusy(false);
    router.back();
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
  const others = Math.max(0, challenge.joinedCount - (challenge.joined ? 1 : 0));

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
          <Eyebrow>{meta.label}</Eyebrow>
          <Spacer h={1} />
          <Txt v="title">{challenge.title}</Txt>
        </View>
      </Row>

      <Spacer h={5} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Eyebrow>When</Eyebrow>
            <Spacer h={1} />
            <Txt v="heading">{challenge.scheduledFor ?? 'Any time'}</Txt>
          </View>
          {challenge.joined && <Badge label="Joined" fg={colors.calm} bg={colors.calmWash} />}
        </Row>
        <Spacer h={4} />
        <Txt v="body" color={colors.inkSoft}>
          {challenge.notes ?? challenge.subtitle}
        </Txt>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          {meta.blurb}
        </Txt>
      </Card>

      <Spacer h={3} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Who is in</Txt>
          <Txt v="heading" color={colors.brown}>
            {challenge.joinedCount} of {challenge.circleSize}
          </Txt>
        </Row>
        <Spacer h={3} />
        <Bar
          pct={challenge.circleSize ? (challenge.joinedCount / challenge.circleSize) * 100 : 0}
          color={colors.yellowDeep}
        />
        <Spacer h={3} />
        {/* A count, never names. Knowing exactly who signed up for a recovery
            activity is a short step from knowing who needs one. */}
        <Txt v="small" color={colors.inkSoft}>
          {challenge.joined
            ? others === 0
              ? 'You are in. Nobody else has joined yet.'
              : `You and ${others} ${others === 1 ? 'other' : 'others'} are in.`
            : others === 0
              ? 'Nobody has joined yet. Be first.'
              : `${others} ${others === 1 ? 'person' : 'people'} in your circle ${others === 1 ? 'has' : 'have'} joined.`}
        </Txt>
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          🔒 Wick shows how many, never who.
        </Txt>
      </Card>

      <Spacer h={5} />

      <Button
        label={challenge.joined ? 'Leave challenge' : 'Join challenge'}
        variant={challenge.joined ? 'ghost' : 'primary'}
        onPress={join}
        loading={busy}
      />

      {challenge.createdByMe && (
        <>
          <Spacer h={3} />
          <Button label="Delete challenge" variant="danger" onPress={remove} disabled={busy} />
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
