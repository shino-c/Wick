import React from 'react';
import { Pressable, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useFocusEffect, useRouter } from 'expo-router';

import { Emoji, Badge, Button, Card, Eyebrow, Row, Screen, Spacer, Txt } from '@/components/base';
import BottomNavigation from '@/components/bottombar';
import { colors, radius, spacing } from '@/theme';
import { SEGMENTS } from '@/camera/useBreathingScan';
import {
  playSoundscape,
  SOUNDSCAPES,
  stopSoundscape,
  type SoundscapeId,
} from '@/services/soundscapeService';
import { listChallenges, listScans } from '@/services/repository';
import type { ChallengeRow, PpgScan } from '@/data/types';
import { formatSchedule, isPast } from '@/features/circles/scheduling';

/**
 * Recovery — the things you DO to come down.
 *
 * This tab used to point at `/recovery`, which was not a route, so it did
 * nothing at all; I then pointed it at the calibration hub, which was wrong for
 * a different reason. Calibration is measurement setup — baseline, spot checks,
 * accuracy, trend. It is how Wick learns what your normal is. Recovery is what
 * you do about the answer. Putting a questionnaire and a scan-count progress bar
 * under a tab called Recovery asked the user to do admin when they came looking
 * for relief.
 *
 * So this screen holds interventions only: the measured breathing check, a
 * soundscape you can start without opening a focus session, and whatever
 * recovery your circle has going. Calibration lives with the thing it
 * calibrates, under Desk Mode.
 */
export default function RecoveryScreen() {
  const router = useRouter();
  const [sound, setSound] = React.useState<SoundscapeId>('silent');
  const [volume, setVolume] = React.useState(0.6);
  const [challenges, setChallenges] = React.useState<ChallengeRow[]>([]);
  const [lastBreath, setLastBreath] = React.useState<PpgScan | null>(null);

  const load = React.useCallback(async () => {
    const [c, scans] = await Promise.all([listChallenges(), listScans(40)]);
    setChallenges(c);
    setLastBreath(scans.find((s) => s.source === 'finger' && s.signalQuality === 'good') ?? null);
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      load();
    }, [load])
  );

  // Audio is a side effect of a screen, not of a session, so it stops when you
  // leave. Nothing should still be playing three screens later.
  React.useEffect(() => {
    playSoundscape(sound, volume);
  }, [sound, volume]);
  React.useEffect(() => () => void stopSoundscape(), []);

  const recovery = challenges
    .filter((c) => !c.cancelled && !isPast(c.scheduledFor))
    .slice(0, 3);
  const totalSeconds = SEGMENTS.before + SEGMENTS.breathe + SEGMENTS.after;

  return (
    <Screen footer={<BottomNavigation activeTab="Recovery" router={router} />}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt v="title">Wick ✳</Txt>
        <Eyebrow>Recovery</Eyebrow>
      </Row>
      <Spacer h={5} />

      <Txt v="display">Come back down.</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        Short things that measurably move your nervous system, and a few that just make the next hour
        easier.
      </Txt>

      <Spacer h={5} />

      {/* ── The measured one ──────────────────────────────────────── */}
      <Card style={{ backgroundColor: colors.yellowWash, borderColor: colors.yellowDeep }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={2}>
            <Emoji size={20}>🫁</Emoji>
            <Txt v="heading">Breathing check</Txt>
          </Row>
          <Badge label="measured" fg={colors.brownSoft} bg={colors.surface} />
        </Row>
        <Spacer h={3} />
        <Txt v="small" color={colors.inkSoft}>
          {Math.round(totalSeconds / 60)} minutes with your finger on the camera. Wick reads your
          pulse before, during and after the paced breathing, and tells you what actually changed —
          on you, not quoted from a study.
        </Txt>
        <Spacer h={4} />
        <Button label="Start breathing check" onPress={() => router.push('/breathing')} />
        {lastBreath?.hrvRmssd != null && (
          <>
            <Spacer h={3} />
            <Txt v="small" color={colors.inkFaint}>
              Your last reading was {Math.round(lastBreath.hrvRmssd)} ms.
            </Txt>
          </>
        )}
      </Card>

      <Spacer h={3} />

      {/* ── Soundscapes ──────────────────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">Soundscape</Txt>
          <Txt v="small" color={colors.inkFaint}>
            {sound === 'silent' ? 'off' : 'playing'}
          </Txt>
        </Row>
        <Spacer h={3} />
        <Row gap={2} style={{ flexWrap: 'wrap' }}>
          {SOUNDSCAPES.map((s) => {
            const selected = sound === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setSound(s.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: spacing(2),
                  paddingVertical: spacing(2),
                  paddingHorizontal: spacing(3),
                  borderRadius: radius.pill,
                  backgroundColor: selected ? colors.yellow : colors.cream,
                  borderWidth: 1,
                  borderColor: selected ? colors.yellowDeep : colors.line,
                }}
              >
                <Txt v="small">{s.icon}</Txt>
                <Txt v="small" color={selected ? colors.brown : colors.inkSoft}>
                  {s.label}
                </Txt>
              </Pressable>
            );
          })}
        </Row>
        {sound !== 'silent' && (
          <>
            <Spacer h={2} />
            <Slider
              value={volume}
              onValueChange={setVolume}
              minimumValue={0}
              maximumValue={1}
              minimumTrackTintColor={colors.yellowDeep}
              maximumTrackTintColor={colors.line}
              thumbTintColor={colors.brown}
              accessibilityLabel="Soundscape volume"
            />
          </>
        )}
        <Spacer h={2} />
        <Txt v="small" color={colors.inkFaint}>
          Stops when you leave this screen. Focus sessions have their own.
        </Txt>
      </Card>

      <Spacer h={3} />

      {/* ── Recovery with other people ───────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt v="heading">With your circle</Txt>
          <Pressable onPress={() => router.push('/social')} accessibilityRole="button">
            <Txt v="small" color={colors.brown}>
              All ›
            </Txt>
          </Pressable>
        </Row>
        <Spacer h={3} />
        {recovery.length === 0 ? (
          <Txt v="small" color={colors.inkFaint}>
            Nothing on right now. Recovery is easier when somebody else is doing it too — a challenge
            is an open invitation, and nobody is told why it might suit you.
          </Txt>
        ) : (
          recovery.map((ch, i) => (
            <View key={ch.id}>
              <Pressable
                onPress={() => router.push({ pathname: '/challenge', params: { id: ch.id } })}
                accessibilityRole="button"
                accessibilityLabel={`${ch.title}, view details`}
              >
                <Row style={{ justifyContent: 'space-between' }}>
                  <View style={{ flex: 1, paddingRight: spacing(3) }}>
                    <Txt v="body">{ch.title}</Txt>
                    <Txt v="small" color={colors.inkFaint}>
                      {formatSchedule(ch.scheduledFor)}
                    </Txt>
                  </View>
                  {ch.joined && (
                    <Badge
                      label={ch.completedByMe ? 'done' : 'joined'}
                      fg={colors.calm}
                      bg={colors.calmWash}
                    />
                  )}
                </Row>
              </Pressable>
              {i < recovery.length - 1 && (
                <View
                  style={{ height: 1, backgroundColor: colors.line, marginVertical: spacing(3) }}
                />
              )}
            </View>
          ))
        )}
      </Card>

      <Spacer h={3} />

      {/* ── Sixty seconds, no sensor ─────────────────────────────── */}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1, paddingRight: spacing(3) }}>
            <Txt v="heading">Just the pacer</Txt>
            <Spacer h={1} />
            <Txt v="small" color={colors.inkSoft}>
              A minute of paced breathing with nothing measured and nothing recorded. For when you do
              not want to be looked at.
            </Txt>
          </View>
          <Button
            label="Breathe"
            variant="soft"
            style={{ height: 40, paddingHorizontal: spacing(4) }}
            onPress={() => router.push({ pathname: '/breathing', params: { pacerOnly: '1' } })}
          />
        </Row>
      </Card>

      <Spacer h={5} />
    </Screen>
  );
}
