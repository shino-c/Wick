import React from 'react';
import { View } from 'react-native';
import { useKeepAwake } from 'expo-keep-awake';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Bar, Button, Eyebrow, NavBar, Screen, Spacer, Txt } from '@/components/base';
import { BreathingPacer, CYCLE_MS } from '@/components/BreathingPacer';
import { colors } from '@/theme';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Breathing'>;

const TARGET_SECONDS = 60;

export default function BreathingScreen({ navigation }: Props) {
  useKeepAwake();
  const [elapsed, setElapsed] = React.useState(0);

  React.useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const done = elapsed >= TARGET_SECONDS;

  return (
    <Screen scroll={false}>
      <NavBar title="1-minute breathing" onBack={() => navigation.goBack()} />

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <BreathingPacer />
        <Spacer h={8} />
        <View style={{ width: '80%' }}>
          <Bar pct={(Math.min(elapsed, TARGET_SECONDS) / TARGET_SECONDS) * 100} color={colors.calm} />
          <Spacer h={2} />
          <Eyebrow>
            {done
              ? 'Complete'
              : `${TARGET_SECONDS - elapsed}s left · ${Math.round(CYCLE_MS / 1000)}s per cycle`}
          </Eyebrow>
        </View>
      </View>

      <Txt v="small" color={colors.inkFaint} center>
        Follow the circle. Longer out than in — that's the part that calms you down.
      </Txt>
      <Spacer h={4} />
      <Button
        label={done ? 'Done' : 'Finish early'}
        variant={done ? 'primary' : 'ghost'}
        onPress={() => navigation.goBack()}
      />
    </Screen>
  );
}
