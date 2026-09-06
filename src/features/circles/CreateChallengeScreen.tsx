import React from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Emoji, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing, type as typeTokens } from '@/theme';
import { createChallenge, getChallenge, updateChallenge } from '@/services/repository';
import type { ChallengeCategory, ChallengeKind, ChallengeVerification } from '@/data/types';
import {
  combine,
  DAY_PRESETS,
  formatDayLabel,
  formatTime,
  parseSchedule,
  startOfDay,
  stepTime,
  TIME_PRESETS,
  upcomingDays,
} from './scheduling';

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

/**
 * Presets are a shortcut, not the whole control.
 *
 * "This weekend" is fine for deciding to do something and useless for turning
 * up to it: a meetup someone travels to needs a day and an hour. So the presets
 * now resolve to a real date and time that the user can then adjust, and the
 * same goes for capacity — the chips set a common number, the field sets the
 * number they actually want.
 */
const CAPACITY_PRESETS = [4, 6, 10];

/**
 * How a challenge can prove it happened.
 *
 * Only offered for solo challenges, because it is only honest there. Wick can
 * witness you sitting still and breathing; it cannot witness four friends
 * walking round a lake, and a proxy for that — a step count, a location ping —
 * would be a measurement of something other than the thing being claimed.
 */
const VERIFICATION: { id: ChallengeVerification; label: string; blurb: string }[] = [
  {
    id: null,
    label: 'On your word',
    blurb: 'People tick it off themselves. Right for anything that happens away from the phone.',
  },
  {
    id: 'breathing',
    label: 'A breathing check',
    blurb: 'Finishing the guided breathing completes it, and Wick records what it did to their HRV.',
  },
  {
    id: 'spot_check',
    label: 'A finger spot check',
    blurb: 'A 45-second pulse reading completes it. Proves someone actually stopped and sat still.',
  },
];
const DAYS_AHEAD = 14;

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
  const [day, setDay] = React.useState<Date | null>(() => DAY_PRESETS[1].resolve(new Date()));
  const [timeMinutes, setTimeMinutes] = React.useState(18 * 60);
  const [legacyWhen, setLegacyWhen] = React.useState<string | null>(null);
  const [capacity, setCapacity] = React.useState<number | null>(6);
  const [capacityText, setCapacityText] = React.useState('6');
  const [verifyWith, setVerifyWith] = React.useState<ChallengeVerification>(null);
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
        const parsed = parseSchedule(existing.scheduledFor);
        setDay(parsed.day);
        setTimeMinutes(parsed.minutes);
        setLegacyWhen(parsed.legacy);
        setCapacity(existing.capacity);
        setCapacityText(existing.capacity === null ? '' : String(existing.capacity));
        setVerifyWith(existing.verifyWith);
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
    if (kind === 'meetup' && !day && !legacyWhen) {
      setError('A meetup needs a day and a time, so people know when to turn up.');
      return;
    }
    if (capacityText.trim() !== '' && capacity === null) {
      setError('Capacity has to be a whole number, or left empty for no limit.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const meta = CATEGORIES.find((c) => c.id === category)!;
      const payload = {
        title: trimmed,
        subtitle: meta.hint,
        // ISO for anything picked here; a legacy free-text value is preserved
        // untouched so editing an old challenge never silently rewords it.
        scheduledFor: day ? combine(day, timeMinutes).toISOString() : legacyWhen,
        category,
        kind,
        location: kind === 'meetup' ? location.trim() : null,
        capacity,
        notes: notes.trim() || null,
        // A meetup is never self-verifying: whatever the creator picked while
        // the form was in solo mode must not survive the switch.
        verifyWith: kind === 'meetup' ? null : verifyWith,
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
                <Emoji size={20}>{c.icon}</Emoji>
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
        <Row style={{ justifyContent: 'space-between' }}>
          <Eyebrow>When</Eyebrow>
          <Txt v="small" color={colors.inkFaint}>
            {day ? `${formatDayLabel(day)}, ${formatTime(timeMinutes)}` : (legacyWhen ?? 'Any time')}
          </Txt>
        </Row>
        <Spacer h={3} />

        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {DAY_PRESETS.map((preset) => {
            const target = preset.resolve(new Date());
            const selected = day !== null && startOfDay(day).getTime() === target.getTime();
            return (
              <Chip
                key={preset.label}
                label={preset.label}
                selected={selected}
                onPress={() => {
                  setDay(target);
                  setLegacyWhen(null);
                }}
              />
            );
          })}
          <Chip
            label="Any time"
            selected={day === null && !legacyWhen}
            onPress={() => {
              setDay(null);
              setLegacyWhen(null);
            }}
          />
        </Row>

        {legacyWhen && (
          <>
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              Currently set to "{legacyWhen}", from before Wick had a date picker. Pick a day to
              replace it with a real time.
            </Txt>
          </>
        )}

        <Spacer h={4} />
        <Eyebrow>Or pick a day</Eyebrow>
        <Spacer h={2} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Row gap={2}>
            {upcomingDays(DAYS_AHEAD).map((d) => {
              const selected = day !== null && startOfDay(day).getTime() === d.getTime();
              return (
                <Pressable
                  key={d.toISOString()}
                  onPress={() => {
                    setDay(d);
                    setLegacyWhen(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={d.toDateString()}
                  style={{
                    alignItems: 'center',
                    minWidth: 54,
                    paddingVertical: spacing(2.5),
                    paddingHorizontal: spacing(2),
                    borderRadius: radius.md,
                    backgroundColor: selected ? colors.yellow : colors.cream,
                    borderWidth: 1,
                    borderColor: selected ? colors.yellowDeep : colors.line,
                  }}
                >
                  <Txt v="small" color={selected ? colors.brownSoft : colors.inkFaint}>
                    {d.toLocaleDateString([], { weekday: 'short' })}
                  </Txt>
                  <Txt v="heading" color={selected ? colors.brown : colors.ink}>
                    {d.getDate()}
                  </Txt>
                </Pressable>
              );
            })}
          </Row>
        </ScrollView>

        {day && (
          <>
            <Spacer h={4} />
            <Eyebrow>At</Eyebrow>
            <Spacer h={2} />
            <Row gap={2} style={{ alignItems: 'center' }}>
              <Stepper label="-15m" onPress={() => setTimeMinutes((m) => stepTime(m, -1))} />
              <View
                style={{
                  flex: 1,
                  alignItems: 'center',
                  paddingVertical: spacing(3),
                  borderRadius: radius.md,
                  backgroundColor: colors.cream,
                  borderWidth: 1,
                  borderColor: colors.line,
                }}
              >
                <Txt v="heading">{formatTime(timeMinutes)}</Txt>
              </View>
              <Stepper label="+15m" onPress={() => setTimeMinutes((m) => stepTime(m, 1))} />
            </Row>
            <Spacer h={2} />
            <Row gap={2} style={{ flexWrap: 'wrap' }}>
              {TIME_PRESETS.map((t) => (
                <Chip
                  key={t}
                  label={formatTime(t)}
                  selected={timeMinutes === t}
                  onPress={() => setTimeMinutes(t)}
                />
              ))}
            </Row>
          </>
        )}
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
        <TextInput
          value={capacityText}
          onChangeText={(t) => {
            const digits = t.replace(/[^0-9]/g, '').slice(0, 3);
            setCapacityText(digits);
            const n = Number(digits);
            setCapacity(digits === '' ? null : n > 0 ? n : null);
          }}
          keyboardType="number-pad"
          placeholder="Leave empty for no limit"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="How many people can join"
          style={inputStyle}
        />
        <Spacer h={3} />
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {CAPACITY_PRESETS.map((c) => (
            <Chip
              key={c}
              label={String(c)}
              selected={capacity === c}
              onPress={() => {
                setCapacity(c);
                setCapacityText(String(c));
              }}
            />
          ))}
          <Chip
            label="No limit"
            selected={capacity === null && capacityText === ''}
            onPress={() => {
              setCapacity(null);
              setCapacityText('');
            }}
          />
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkFaint}>
          {kind === 'meetup'
            ? 'Once it is full, nobody else in your circle can join. Lowering it below the number already in does not remove anyone — they keep their place.'
            : 'Rarely needed for something everyone does in their own space.'}
        </Txt>
      </Card>

      {kind === 'solo' && (
        <>
          <Spacer h={3} />
          <Card>
            <Eyebrow>How it counts as done</Eyebrow>
            <Spacer h={3} />
            {VERIFICATION.map((v) => {
              const selected = verifyWith === v.id;
              return (
                <Pressable
                  key={String(v.id)}
                  onPress={() => setVerifyWith(v.id)}
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
                    {v.label}
                  </Txt>
                  <Spacer h={1} />
                  <Txt v="small" color={selected ? colors.brownSoft : colors.inkFaint}>
                    {v.blurb}
                  </Txt>
                </Pressable>
              );
            })}
            <Spacer h={2} />
            <Txt v="small" color={colors.inkFaint}>
              A measured completion shows a small tick. A self-reported one does not. Neither is
              worth more — they are just different claims, so Wick does not blur them together.
            </Txt>
          </Card>
        </>
      )}

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

function Stepper({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={{
        paddingVertical: spacing(3),
        paddingHorizontal: spacing(3),
        borderRadius: radius.md,
        backgroundColor: colors.yellowWash,
        borderWidth: 1,
        borderColor: colors.yellowDeep,
      }}
    >
      <Txt v="small" color={colors.brown}>
        {label}
      </Txt>
    </Pressable>
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
