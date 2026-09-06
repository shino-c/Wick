import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing, type as typeTokens } from '@/theme';
import { createChallenge } from '@/services/repository';
import type { ChallengeCategory } from '@/data/types';

const CATEGORIES: { id: ChallengeCategory; icon: string; label: string; hint: string }[] = [
  { id: 'physical', icon: '🚶', label: 'Physical', hint: 'Active recovery' },
  { id: 'social', icon: '💬', label: 'Social', hint: 'Time with people' },
  { id: 'mental', icon: '🍵', label: 'Mental', hint: 'Downtime, no screens' },
];

/** Rough, human timings. A date picker is overkill for "let's go for a walk". */
const WHEN = ['Today', 'Tomorrow', 'This weekend', 'Any time'];

export default function CreateChallengeScreen() {
  const router = useRouter();
  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [category, setCategory] = React.useState<ChallengeCategory>('physical');
  const [when, setWhen] = React.useState<string>('Tomorrow');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setError('Give it a name people will recognise.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = CATEGORIES.find((c) => c.id === category)!;
      const id = await createChallenge({
        title: trimmed,
        subtitle: meta.hint,
        scheduledFor: when === 'Any time' ? null : when,
        category,
        notes: notes.trim() || null,
      });
      router.replace({ pathname: '/challenge', params: { id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create that challenge');
      setBusy(false);
    }
  };

  return (
    <Screen>
      <NavBar title="New challenge" onBack={() => router.back()} />

      <Txt v="title">Invite your circle</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        A challenge is an open invitation to everyone in your circle. Nobody is singled out, and no
        one is told why it might be good for them.
      </Txt>
      <Spacer h={5} />

      <Card>
        <Eyebrow>What is it</Eyebrow>
        <Spacer h={3} />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Group walk: lakeside"
          placeholderTextColor={colors.inkFaint}
          maxLength={60}
          accessibilityLabel="Challenge title"
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
        <Spacer h={3} />
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Anything else people should know (optional)"
          placeholderTextColor={colors.inkFaint}
          multiline
          maxLength={240}
          accessibilityLabel="Challenge notes"
          style={{
            ...typeTokens.body,
            color: colors.ink,
            minHeight: 84,
            textAlignVertical: 'top',
            paddingVertical: spacing(3.5),
            paddingHorizontal: spacing(4),
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.line,
            backgroundColor: colors.cream,
          }}
        />
      </Card>

      <Spacer h={3} />

      <Card>
        <Eyebrow>Kind of recovery</Eyebrow>
        <Spacer h={3} />
        <Row gap={2}>
          {CATEGORIES.map((c) => {
            const selected = category === c.id;
            return (
              <Pressable
                key={c.id}
                onPress={() => setCategory(c.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flex: 1,
                  alignItems: 'center',
                  gap: 4,
                  paddingVertical: spacing(3),
                  borderRadius: radius.md,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="body" style={{ fontSize: 20 }}>
                  {c.icon}
                </Txt>
                <Txt v="small" color={selected ? colors.brown : colors.inkSoft}>
                  {c.label}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      <Spacer h={3} />

      <Card>
        <Eyebrow>When</Eyebrow>
        <Spacer h={3} />
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {WHEN.map((w) => {
            const selected = when === w;
            return (
              <Pressable
                key={w}
                onPress={() => setWhen(w)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  paddingVertical: spacing(2.5),
                  paddingHorizontal: spacing(4),
                  borderRadius: radius.pill,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="small" color={selected ? colors.brown : colors.inkSoft}>
                  {w}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
      </Card>

      {error && (
        <>
          <Spacer h={3} />
          <View
            style={{ backgroundColor: colors.alertWash, borderRadius: radius.sm, padding: spacing(3) }}
          >
            <Txt v="small" color={colors.alert}>
              {error}
            </Txt>
          </View>
        </>
      )}

      <Spacer h={5} />
      <Button label="Create challenge" onPress={submit} loading={busy} />
      <Spacer h={3} />
      <Txt v="small" color={colors.inkFaint} center>
        You will be counted as joined automatically.
      </Txt>
      <Spacer h={5} />
    </Screen>
  );
}
