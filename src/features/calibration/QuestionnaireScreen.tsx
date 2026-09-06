import React from 'react';
import { Pressable, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { Bar, Button, Card, Eyebrow, NavBar, Row, Screen, Spacer, Txt } from '@/components/base';
import { colors, radius, spacing } from '@/theme';
import { ITEMS, LIKERT, scoreQuestionnaire } from './questionnaire';
import { recomputeFusedScore, saveSelfReport } from '@/services/repository';
import { stressBucket } from '@/services/fusionService';
import type { RootStackParamList } from '@/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Questionnaire'>;

export default function QuestionnaireScreen({ navigation }: Props) {
  const [answers, setAnswers] = React.useState<Record<string, number>>({});
  const [saving, setSaving] = React.useState(false);

  const answered = Object.keys(answers).length;
  const complete = answered === ITEMS.length;
  const preview = complete ? scoreQuestionnaire(answers) : null;

  const submit = async () => {
    setSaving(true);
    const score = scoreQuestionnaire(answers);
    await saveSelfReport(score, answers);
    // Self-report is one of the three fused inputs, so the dashboard number
    // should move the moment it lands rather than at the next scan.
    await recomputeFusedScore();
    setSaving(false);
    navigation.goBack();
  };

  return (
    <Screen>
      <NavBar title="Baseline assessment" onBack={() => navigation.goBack()} />

      <Txt v="title">How has your week been?</Txt>
      <Spacer h={2} />
      <Txt v="body" color={colors.inkSoft}>
        Five questions, about a minute. This sets your personal reference point — every stress reading
        afterwards is measured against you, not against an average.
      </Txt>
      <Spacer h={4} />

      <Row style={{ justifyContent: 'space-between' }}>
        <Eyebrow>
          {answered} of {ITEMS.length}
        </Eyebrow>
        {preview !== null && (
          <Txt v="small" color={colors.inkSoft}>
            {preview}/100 · {stressBucket(preview)}
          </Txt>
        )}
      </Row>
      <Spacer h={2} />
      <Bar pct={(answered / ITEMS.length) * 100} color={colors.yellowDeep} />
      <Spacer h={5} />

      {ITEMS.map((item, index) => (
        <View key={item.id} style={{ marginBottom: spacing(4) }}>
          <Card>
            <Eyebrow>Question {index + 1}</Eyebrow>
            <Spacer h={2} />
            <Txt v="heading">{item.prompt}</Txt>
            <Spacer h={3} />
            {LIKERT.map((label, value) => {
              const selected = answers[item.id] === value;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setAnswers((a) => ({ ...a, [item.id]: value }))}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: spacing(3),
                    paddingVertical: spacing(2.5),
                    paddingHorizontal: spacing(3),
                    borderRadius: radius.md,
                    marginBottom: spacing(1.5),
                    backgroundColor: selected ? colors.yellow : colors.cream,
                    borderWidth: 1,
                    borderColor: selected ? colors.yellowDeep : colors.line,
                  }}
                >
                  <View
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 8,
                      borderWidth: 2,
                      borderColor: selected ? colors.brown : colors.lineStrong,
                      backgroundColor: selected ? colors.brown : 'transparent',
                    }}
                  />
                  <Txt v="body" color={selected ? colors.brown : colors.inkSoft}>
                    {label}
                  </Txt>
                </Pressable>
              );
            })}
          </Card>
        </View>
      ))}

      <Button
        label={complete ? 'Save baseline' : `Answer all ${ITEMS.length} questions`}
        onPress={submit}
        disabled={!complete}
        loading={saving}
      />
    </Screen>
  );
}
