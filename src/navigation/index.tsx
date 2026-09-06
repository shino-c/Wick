import React from 'react';
import { Platform, View } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { colors, font, spacing } from '@/theme';
import { Txt } from '@/components/base';

import OnboardingScreen from '@/features/onboarding/OnboardingScreen';
import QuestionnaireScreen from '@/features/calibration/QuestionnaireScreen';
import SpotCheckScreen from '@/features/calibration/SpotCheckScreen';
import CalibrationScreen from '@/features/calibration/CalibrationScreen';
import BreathingScreen from '@/features/calibration/BreathingScreen';
import DeskScreen from '@/features/desk/DeskScreen';
import SessionScreen from '@/features/desk/SessionScreen';
import SummaryScreen from '@/features/desk/SummaryScreen';
import CirclesScreen from '@/features/circles/CirclesScreen';
import AddFriendScreen from '@/features/circles/AddFriendScreen';
import type { SessionSummary } from '@/camera/useDeskSession';

export type RootStackParamList = {
  Onboarding: undefined;
  Tabs: undefined;
  Questionnaire: { firstRun?: boolean } | undefined;
  SpotCheck: { firstRun?: boolean } | undefined;
  Session: { minutes: number; soundscape: string; demoMode: boolean };
  Summary: { summary: SessionSummary };
  Breathing: { enforced?: boolean } | undefined;
  AddFriend: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.cream, card: colors.cream, border: colors.line },
};

function TabIcon({ glyph, label, focused }: { glyph: string; label: string; focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', gap: 2, width: 72 }}>
      <Txt v="body" style={{ fontSize: 18, opacity: focused ? 1 : 0.45 }}>
        {glyph}
      </Txt>
      <Txt v="eyebrow" color={focused ? colors.brown : colors.inkFaint}>
        {label}
      </Txt>
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          height: Platform.OS === 'ios' ? 84 : 66,
          paddingTop: spacing(2),
        },
      }}
    >
      <Tab.Screen
        name="Desk"
        component={DeskScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon glyph="⏱" label="Desk" focused={focused} /> }}
      />
      <Tab.Screen
        name="Calibrate"
        component={CalibrationScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon glyph="◍" label="Calibrate" focused={focused} /> }}
      />
      <Tab.Screen
        name="Circles"
        component={CirclesScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon glyph="◎" label="Circles" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

export default function Navigation({ onboarded }: { onboarded: boolean }) {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={onboarded ? 'Tabs' : 'Onboarding'}
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.cream } }}
      >
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Questionnaire" component={QuestionnaireScreen} />
        <Stack.Screen name="SpotCheck" component={SpotCheckScreen} />
        <Stack.Screen name="Breathing" component={BreathingScreen} />
        <Stack.Screen
          name="Session"
          component={SessionScreen}
          options={{ gestureEnabled: false, animation: 'fade' }}
        />
        <Stack.Screen name="Summary" component={SummaryScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="AddFriend" component={AddFriendScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export { font };
