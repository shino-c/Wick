import React from 'react';
import { Share, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';

import { Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing, type as typeTokens } from '@/theme';
import { getFriends, getMyInviteCode, sendFriendRequestByCode } from '@/services/repository';
import type { FriendSummary } from '@/data/types';

export default function AddFriendScreen() {
  const router = useRouter();
  const [myCode, setMyCode] = React.useState('');
  const [entered, setEntered] = React.useState('');
  const [friends, setFriends] = React.useState<FriendSummary[]>([]);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    getMyInviteCode().then(setMyCode);
    getFriends().then(setFriends);
  }, []);

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
              {i < friends.length - 1 && (
                <View style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }} />
              )}
            </View>
          ))}
          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint}>
            You can see who is in your circle. You can never see their stress score.
          </Txt>
        </Card>
      )}

      <Spacer h={4} />
    </Screen>
  );
}
