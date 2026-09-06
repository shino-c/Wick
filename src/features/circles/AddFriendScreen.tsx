import React from 'react';
import { Alert, Pressable, Share, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing, type as typeTokens } from '@/theme';
import {
  getFriends,
  getMyInviteCode,
  getMyUsername,
  removeFriend,
  sendFriendRequestByCode,
  setMyUsername,
} from '@/services/repository';
import type { FriendSummary } from '@/data/types';

export default function AddFriendScreen() {
  const router = useRouter();
  const [myCode, setMyCode] = React.useState('');
  const [entered, setEntered] = React.useState('');
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [savedName, setSavedName] = React.useState('');
  const [nameStatus, setNameStatus] = React.useState<string | null>(null);

  /**
   * Leaving a circle.
   *
   * Three decisions worth stating, because they are the difference between a
   * feature people use and one they avoid:
   *
   *   • It is silent. Nobody is notified that they were removed. A "X removed
   *     you" alert turns a quiet boundary into a confrontation, and the fear of
   *     causing that is exactly what keeps people in circles they want out of.
   *   • It is symmetrical. You disappear from their list as they disappear from
   *     yours, because a circle is a mutual arrangement and a half-removed one
   *     would leave them still seeing someone who has gone.
   *   • It is reversible and cheap. Either of you can send a code again. Framing
   *     it as permanent would make an ordinary act feel like a verdict.
   *
   * The wording deliberately avoids "remove", "block" and "unfriend". Circles
   * change size all the time — people graduate, switch courses, drift. Treating
   * that as normal is the point; a stress app that makes leaving feel like an
   * accusation has misunderstood what it is for.
   */
  const confirmRemove = (friend: FriendSummary) => {
    Alert.alert(
      `Leave ${friend.username}'s circle?`,
      `You will both stop seeing each other in Wick.\n\n${friend.username} is not told — no notification, no message. Nothing else is deleted, and neither of you could ever see the other's readings anyway.\n\nEither of you can share a code again later.`,
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Leave circle',
          style: 'destructive',
          onPress: async () => {
            setRemoving(friend.friendId);
            try {
              await removeFriend(friend.friendId);
              setFriends(await getFriends());
            } finally {
              setRemoving(null);
            }
          },
        },
      ]
    );
  };

  React.useEffect(() => {
    getMyInviteCode().then(setMyCode);
    getFriends().then(setFriends);
    getMyUsername().then((u) => {
      setName(u);
      setSavedName(u);
    });
  }, []);

  const saveName = async () => {
    setNameStatus(null);
    try {
      const saved = await setMyUsername(name);
      setSavedName(saved);
      setName(saved);
      setNameStatus('Saved. This is what your circle sees.');
    } catch (e) {
      setNameStatus(e instanceof Error ? e.message : 'Could not save that name');
    }
  };

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await sendFriendRequestByCode(entered);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setStatus({ ok: true, text: 'Request sent. They will see it next time they open Wick.' });
      setEntered('');
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong' });
    } finally {
      setBusy(false);
      setFriends(await getFriends());
    }
  };

  return (
    <Screen>
      <NavBar title="Add a friend" onBack={() => router.back()} />

      <Txt v="title">Your circle, by invitation</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        Wick never reads your contacts. You share a code, they enter it, and both of you confirm —
        that's the whole mechanism.
      </Txt>
      <Spacer h={5} />

      {/* ── Display name ──────────────────────────────────────────── */}
      {/* Accounts start as 'student_a1b2c3'. Fine for privacy, useless for a
          circle: two people who just swapped codes cannot tell which row is
          which, and "who is coming to this meetup" stops being answerable.
          Nothing here is verified or public — only people who already accepted
          your code ever see it. */}
      <Card>
        <Eyebrow>What your circle calls you</Eyebrow>
        <Spacer h={3} />
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          placeholderTextColor={colors.inkFaint}
          maxLength={24}
          autoCorrect={false}
          accessibilityLabel="Your display name"
          style={{
            ...typeTokens.heading,
            color: colors.ink,
            paddingVertical: spacing(3.5),
            paddingHorizontal: spacing(4),
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.cream,
          }}
        />
        {name.trim() !== savedName && name.trim().length >= 2 && (
          <>
            <Spacer h={3} />
            <Button label="Save name" variant="soft" onPress={saveName} />
          </>
        )}
        {nameStatus && (
          <>
            <Spacer h={2} />
            <Txt v="small" color={colors.inkFaint}>
              {nameStatus}
            </Txt>
          </>
        )}
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          Only people who have accepted your code see this. It is a label, not an identity — Wick
          does not check it and never shows it outside your circle.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── My code ───────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Your invite code</Eyebrow>
        <Spacer h={3} />
        <View
          style={{
            backgroundColor: colors.yellowWash,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.yellowDeep,
            paddingVertical: spacing(5),
            alignItems: 'center',
          }}
        >
          <Txt
            v="display"
            color={colors.brown}
            style={{ letterSpacing: 4, fontSize: 30 }}
            selectable
          >
            {myCode || '····'}
          </Txt>
        </View>
        <Spacer h={3} />
        <Button
          label="Share code"
          variant="soft"
          onPress={() =>
            Share.share({
              message: `Join my circle on Wick — my invite code is ${myCode}.`,
            })
          }
        />
      </Card>

      <Spacer h={3} />

      {/* ── Enter a code ──────────────────────────────────────────── */}
      <Card>
        <Eyebrow>Enter their code</Eyebrow>
        <Spacer h={3} />
        <TextInput
          value={entered}
          onChangeText={(t) => setEntered(t.toUpperCase())}
          placeholder="WICK-X7K2"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Friend invite code"
          style={{
            ...typeTokens.title,
            color: colors.ink,
            letterSpacing: 2,
            textAlign: 'center',
            paddingVertical: spacing(4),
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.cream,
          }}
        />
        <Spacer h={3} />
        <Button
          label="Send request"
          onPress={submit}
          loading={busy}
          disabled={entered.trim().length < 4}
        />
        {status && (
          <>
            <Spacer h={3} />
            <View
              style={{
                backgroundColor: status.ok ? colors.calmWash : colors.alertWash,
                borderRadius: radius.sm,
                padding: spacing(3),
              }}
            >
              <Txt v="small" color={status.ok ? colors.calm : colors.alert}>
                {status.text}
              </Txt>
            </View>
          </>
        )}
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          A code creates a request, never an instant friendship — and the link is written server-side
          in both directions, so a request can't be forced through from one side.
        </Txt>
      </Card>

      <Spacer h={3} />

      {friends.length > 0 && (
        <Card>
          <Eyebrow>Your circle</Eyebrow>
          <Spacer h={3} />
          {friends.map((f, i) => (
            <View key={f.friendId}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Row gap={3}>
                  <View
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      backgroundColor: colors.yellow,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Txt v="small" color={colors.brown}>
                      {f.username.slice(0, 2).toUpperCase()}
                    </Txt>
                  </View>
                  <Txt v="body">{f.username}</Txt>
                </Row>
                <Pressable
                  onPress={() => confirmRemove(f)}
                  disabled={removing === f.friendId}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={`Leave ${f.username}'s circle`}
                >
                  <Txt v="small" color={colors.inkFaint}>
                    {removing === f.friendId ? 'Leaving…' : 'Leave circle'}
                  </Txt>
                </Pressable>
              </Row>
              {i < friends.length - 1 && (
                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }} />
              )}
            </View>
          ))}
          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint}>
            You can see who is in your circle. You can never see their stress score. Leaving is
            quiet — nobody is told, and either of you can share a code again later.
          </Txt>
        </Card>
      )}

      <Spacer h={4} />
    </Screen>
  );
}
