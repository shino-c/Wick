import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing, type as typeTokens } from '@/theme';
import { createChallenge, getChallenge, updateChallenge } from '@/services/repository';
import type { ChallengeCategory, ChallengeKind } from '@/data/types';

const CATEGORIES: { id: ChallengeCategory; icon: string; label: string; hint: string }[] = [
  { id: 'physical', icon: '🚶', label: 'Physical', hint: 'Active recovery' },
  { id: 'social', icon: '💬', label: 'Social', hint: 'Time with people' },
  { id: 'mental', icon: '🍵', label: 'Mental', hint: 'Downtime, no screens' },
];

const KINDS: { id: ChallengeKind; label: string; blurb: string }[] = [
  {
    id: 'meetup',
    label: 'Meet up',
    blurb: 'Same place, same time. Everyone can see who else is coming.',
  },
  {
    id: 'solo',
    label: 'Together, apart',
    blurb: 'Same window, your own space. Nobody has to travel anywhere.',
  },
];

/** Rough, human timings. A date picker is overkill for "let's go for a walk". */
const WHEN = ['Today', 'Tomorrow', 'This weekend', 'Any time'];
const CAPACITIES: (number | null)[] = [4, 6, 10, null];

/**
 * Doubles as the edit screen. Passing `?id=` loads the existing challenge and
 * saves over it; without one it creates.
 */
export default function CreateChallengeScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = Boolean(id);

  const [title, setTitle] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [category, setCategory] = React.useState<ChallengeCategory>('physical');
  const [kind, setKind] = React.useState<ChallengeKind>('meetup');
  const [when, setWhen] = React.useState<string>('Tomorrow');
  const [capacity, setCapacity] = React.useState<number | null>(6);
  const [busy, setBusy] = React.useState(false);
  const [loading, setLoading] = React.useState(editing);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    (async () => {
      const existing = await getChallenge(id);
      if (existing) {
        setTitle(existing.title);
        setNotes(existing.notes ?? '');
        setLocation(existing.location ?? '');
        setCategory(existing.category);
        setKind(existing.kind);
        setWhen(existing.scheduledFor ?? 'Any time');
        setCapacity(existing.capacity);
      }
      setLoading(false);
    })();
  }, [id]);

  const submit = async () => {
    const trimmed = title.trim();
    if (trimmed.length < 3) {
      setError('Give it a name people will recognise.');
      return;
    }
    if (kind === 'meetup' && location.trim().length < 3) {
      setError('A meetup needs somewhere to meet.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = CATEGORIES.find((c) => c.id === category)!;
      const payload = {
        title: trimmed,
        subtitle: meta.hint,
        scheduledFor: when === 'Any time' ? null : when,
        category,
        kind,
        location: kind === 'meetup' ? location.trim() : null,
        capacity,
        notes: notes.trim() || null,
      };
      if (id) {
        await updateChallenge(id, payload);
        router.back();
      } else {
        const newId = await createChallenge(payload);
        router.replace({ pathname: '/challenge', params: { id: newId } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that challenge');
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <NavBar title="Edit challenge" onBack={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <NavBar title={editing ? 'Edit challenge' : 'New challenge'} onBack={() => router.back()} />

      <Txt v="title">{editing ? 'Update the details' : 'Invite your circle'}</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        A challenge is an open invitation to everyone in your circle. Nobody is singled out, and no
        one is told why it might be good for them.
      </Txt>
      <Spacer h={5} />

      {/* ── Kind ─────────────────────────────────────────────────── */}
      <Card>
        <Eyebrow>What kind</Eyebrow>
        <Spacer h={3} />
        {KINDS.map((k) => {
          const selected = kind === k.id;
          return (
            <Pressable
              key={k.id}
              onPress={() => setKind(k.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              style={{
                padding: spacing(3.5),
                borderRadius: radius.md,
                marginBottom: spacing(2),
                backgroundColor: selected ? colors.yellow : colors.cream,
                borderWidth: 1,
                borderColor: selected ? colors.yellowDeep : colors.line,
              }}
            >
              <Txt v="heading" color={selected ? colors.brown : colors.ink}>
                {k.label}
              </Txt>
              <Spacer h={1} />
              <Txt v="small" color={selected ? colors.brownSoft : colors.inkFaint}>
                {k.blurb}
              </Txt>
            </Pressable>
          );
        })}
      </Card>

      <Spacer h={3} />

      <Card>
        <Eyebrow>What is it</Eyebrow>
        <Spacer h={3} />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={kind === 'meetup' ? 'Group walk: lakeside' : 'Screen-free tea break'}
          placeholderTextColor={colors.inkFaint}
          maxLength={60}
          accessibilityLabel="Challenge title"
          style={inputStyle}
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
          style={{ ...inputStyle, ...typeTokens.body, minHeight: 84, textAlignVertical: 'top' }}
        />
      </Card>

      <Spacer h={3} />

      {kind === 'meetup' && (
        <>
          <Card>
            <Eyebrow>Where</Eyebrow>
            <Spacer h={3} />
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Lakeside path, main entrance"
              placeholderTextColor={colors.inkFaint}
              maxLength={80}
              accessibilityLabel="Meeting place"
              style={inputStyle}
            />
            <Spacer h={2} />
            <Txt v="small" color={colors.inkFaint}>
              Shown to everyone in your circle who opens this challenge.
            </Txt>
          </Card>
          <Spacer h={3} />
        </>
      )}

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
          {WHEN.map((w) => (
            <Chip key={w} label={w} selected={when === w} onPress={() => setWhen(w)} />
          ))}
        </Row>
      </Card>

      <Spacer h={3} />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>How many can join</Eyebrow>
          <Txt v="small" color={colors.inkFaint}>
            {capacity === null ? 'No limit' : `${capacity} people`}
          </Txt>
        </Row>
        <Spacer h={3} />
        <Row gap={2}>
          {CAPACITIES.map((c) => (
            <Chip
              key={String(c)}
              label={c === null ? 'Any' : String(c)}
              selected={capacity === c}
              onPress={() => setCapacity(c)}
            />
          ))}
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          {kind === 'meetup'
            ? 'Once it is full, nobody else in your circle can join.'
            : 'Rarely needed for something everyone does in their own space.'}
        </Txt>
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
      <Button label={editing ? 'Save changes' : 'Create challenge'} onPress={submit} loading={busy} />
      {!editing && (
        <>
          <Spacer h={3} />
          <Txt v="small" color={colors.inkFaint} center>
            You will be counted as joined automatically.
          </Txt>
        </>
      )}
      <Spacer h={5} />
    </Screen>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
        {label}
      </Txt>
    </Pressable>
  );
}

const inputStyle = {
  ...typeTokens.heading,
  color: colors.ink,
  paddingVertical: spacing(3.5),
  paddingHorizontal: spacing(4),
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.line,
  backgroundColor: colors.cream,
} as const;
