import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  StatusBar,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Slider from '@react-native-community/slider';

const COLORS = {
  background: '#FFFBEB',
  text: '#2D2723',
  muted: '#7D756E',
  card: '#FFFFFF',
  border: '#EFE9DF',
  brown: '#5D4632',
  yellow: '#FEF0A5',
  yellowLight: '#FFF9E6',
  green: '#15803D',
};

export default function BaselineScreen() {
  const router = useRouter();
  const [stress, setStress] = useState(35);

  const getStressState = () => {
    if (stress < 25) {
      return {
        label: 'Gently Centered',
        background: '#EFF6EB',
        color: '#6A994E',
      };
    }

    if (stress < 60) {
      return {
        label: 'Mildly Tense',
        background: '#FEF2A7',
        color: '#554128',
      };
    }

    return {
      label: 'Elevated Load',
      background: '#FDF0ED',
      color: '#E07A5F',
    };
  };

  const stressState = getStressState();

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor={COLORS.background}
      />

      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              if (router.canGoBack()) {
                router.back();
              }
            }}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.backIcon}>‹</Text>
          </Pressable>

          <Text style={styles.setupText}>SET UP</Text>

          <View style={styles.headerSpacer} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Title */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Set Your Baseline</Text>

            <Text style={styles.subtitle}>
              A gentle space tailored to your daily rhythm. Tell us how you are
              feeling today.
            </Text>
          </View>

          {/* Stress Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                How stressed are you feeling?
              </Text>

              <Text style={styles.sparkle}>✦</Text>
            </View>

            <View style={styles.badgeRow}>
              <View
                style={[
                  styles.stressBadge,
                  { backgroundColor: stressState.background },
                ]}
              >
                <Text
                  style={[
                    styles.stressBadgeText,
                    { color: stressState.color },
                  ]}
                >
                  {stressState.label}
                </Text>
              </View>
            </View>

            <View style={styles.sliderContainer}>
              <View style={styles.sliderBackground}>
                <View
                  style={[
                    styles.sliderGreen,
                    { width: `${stress}%` },
                  ]}
                />
              </View>

              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={100}
                value={stress}
                onValueChange={setStress}
                minimumTrackTintColor="transparent"
                maximumTrackTintColor="transparent"
                thumbTintColor="#2D2723"
              />
            </View>

            <View style={styles.sliderLabels}>
              <View style={styles.sliderLabelLeft}>
                <Text style={styles.emoji}>🌱</Text>
                <Text style={styles.labelText}>Relaxed</Text>
              </View>

              <View style={styles.sliderLabelRight}>
                <Text style={styles.labelText}>Very stressed</Text>
                <Text style={styles.emoji}>⚡</Text>
              </View>
            </View>
          </View>

          {/* Assessment Card */}
          <View style={styles.card}>
            <View style={styles.assessmentRow}>
              <View style={styles.assessmentLeft}>
                <View style={styles.checkCircle}>
                  <Text style={styles.checkIcon}>✓</Text>
                </View>

                <View style={styles.assessmentText}>
                  <Text style={styles.assessmentTitle}>
                    Personal Baseline{'\n'}Assessment
                  </Text>

                  <Text style={styles.assessmentSubtitle}>
                    4-Item Perceived Stress (Completed)
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => {}}
                style={({ pressed }) => [
                  styles.recalibrateButton,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.recalibrateText}>Recalibrate</Text>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            </View>
          </View>

          {/* PPG Card */}
          <View style={styles.card}>
            <View style={styles.ppgHeader}>
              <View style={styles.pointIcon}>
                <Text style={styles.pointEmoji}>👉</Text>
              </View>

              <View style={styles.ppgText}>
                <Text style={styles.ppgTitle}>Finger-PPG Spot Check</Text>

                <Text style={styles.ppgSubtitle}>
                  Place your index fingertip{'\n'}
                  over rear camera + flash · 1min check
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => {}}
              style={({ pressed }) => [
                styles.yellowButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.yellowButtonText}>
                Start Spot Check
              </Text>
            </Pressable>
          </View>

          {/* Calendar Card */}
          <View style={styles.card}>
            <View style={styles.calendarIllustration}>
              <View style={styles.circleOne} />
              <View style={styles.circleTwo} />

              <View style={styles.illustrationIcons}>
                <Text style={styles.calendarIcon}>▣</Text>
                <Text style={styles.leafIcon}>♧</Text>
              </View>
            </View>

            <View style={styles.calendarText}>
              <Text style={styles.calendarTitle}>Sync Your Calendar</Text>

              <Text style={styles.calendarDescription}>
                We'll quietly scan your daily agenda to automatically schedule
                brief, nourishing breathing sessions in your free windows.
              </Text>
            </View>

            <Pressable
              onPress={() => {}}
              style={({ pressed }) => [
                styles.yellowButton,
                styles.connectButton,
                pressed && styles.pressedButton,
              ]}
            >
              <Text style={styles.lockIcon}>▣</Text>
              <Text style={styles.yellowButtonText}>
                Connect Calendar
              </Text>
            </Pressable>
          </View>

          {/* Bottom spacing for fixed button */}
          <View style={{ height: 110 }} />
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.bottomContainer}>
          <Pressable
            onPress={() => router.push('/home')}
            style={({ pressed }) => [
              styles.continueButton,
              pressed && styles.pressedContinue,
            ]}
          >
            <Text style={styles.continueText}>
              Continue to Dashboard
            </Text>

            <Text style={styles.arrow}>→</Text>
          </Pressable>

          <View style={styles.homeIndicator} />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { height: 58, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#EDE8E1', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  backIcon: { fontSize: 32, lineHeight: 34, color: COLORS.text, fontWeight: '300' },
  setupText: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#8E877F', fontSize: 13, fontWeight: '700', letterSpacing: 3 },
  headerSpacer: { width: 40 },
  scrollContent: { paddingHorizontal: 24, paddingTop: 12 },
  titleSection: { marginBottom: 16 },
  title: { color: COLORS.text, fontSize: 32, lineHeight: 38, fontWeight: '700', letterSpacing: -0.7 },
  subtitle: { marginTop: 6, color: COLORS.muted, fontSize: 15, lineHeight: 23 },
  card: { backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 28, padding: 20, marginBottom: 16, shadowColor: '#503C28', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTitle: { flex: 1, color: COLORS.text, fontSize: 18, lineHeight: 24, fontWeight: '700' },
  sparkle: { color: '#B2ABA2', fontSize: 23 },
  badgeRow: { alignItems: 'flex-end', paddingRight: 14, marginBottom: 8 },
  stressBadge: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 18 },
  stressBadgeText: { fontSize: 13, fontWeight: '700' },
  sliderContainer: { height: 48, justifyContent: 'center', position: 'relative' },
  sliderBackground: { position: 'absolute', left: 4, right: 4, height: 8, borderRadius: 8, overflow: 'hidden', flexDirection: 'row', backgroundColor: '#F59797' },
  sliderGreen: { height: '100%', backgroundColor: '#CEEAD6' },
  slider: { width: '100%', height: 48 },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingTop: 2 },
  sliderLabelLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sliderLabelRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  emoji: { fontSize: 16 },
  labelText: { color: '#605B54', fontSize: 14, fontWeight: '500' },
  assessmentRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  assessmentLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14 },
  checkCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#DCFCE7', alignItems: 'center', justifyContent: 'center' },
  checkIcon: { color: '#16A34A', fontSize: 21, fontWeight: '800' },
  assessmentText: { flex: 1 },
  assessmentTitle: { color: COLORS.text, fontSize: 15, lineHeight: 19, fontWeight: '700' },
  assessmentSubtitle: { marginTop: 3, color: '#8C847C', fontSize: 12, lineHeight: 16 },
  recalibrateButton: { flexDirection: 'row', alignItems: 'center' },
  recalibrateText: { color: COLORS.green, fontSize: 14, fontWeight: '700' },
  chevron: { color: COLORS.green, fontSize: 23, marginLeft: 2 },
  ppgHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 16 },
  pointIcon: { width: 44, height: 44, borderRadius: 16, backgroundColor: COLORS.yellowLight, alignItems: 'center', justifyContent: 'center' },
  pointEmoji: { fontSize: 22 },
  ppgText: { flex: 1 },
  ppgTitle: { color: COLORS.text, fontSize: 16, lineHeight: 21, fontWeight: '700' },
  ppgSubtitle: { marginTop: 4, color: '#80776F', fontSize: 13, lineHeight: 18 },
  yellowButton: { width: '100%', height: 48, borderRadius: 16, backgroundColor: COLORS.yellow, alignItems: 'center', justifyContent: 'center' },
  yellowButtonText: { color: '#3D2E1E', fontSize: 15, fontWeight: '700' },
  calendarIllustration: { width: '100%', height: 80, borderRadius: 16, backgroundColor: '#FAF6E8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  circleOne: { position: 'absolute', left: 20, width: 64, height: 64, borderRadius: 32, backgroundColor: '#F5EEDB' },
  circleTwo: { position: 'absolute', right: 28, width: 48, height: 48, borderRadius: 24, backgroundColor: '#EBF4EE' },
  illustrationIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  calendarIcon: { color: '#3D2E1E', fontSize: 27 },
  leafIcon: { color: '#3D2E1E', fontSize: 25 },
  calendarText: { marginBottom: 16 },
  calendarTitle: { color: COLORS.text, fontSize: 17, lineHeight: 22, fontWeight: '700', marginBottom: 4 },
  calendarDescription: { color: '#7D746D', fontSize: 13, lineHeight: 19 },
  connectButton: { flexDirection: 'row', gap: 8 },
  lockIcon: { color: '#3D2E1E', fontSize: 16 },
  bottomContainer: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 12, backgroundColor: COLORS.background },
  continueButton: { width: '100%', height: 56, borderRadius: 30, backgroundColor: COLORS.brown, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#50371E', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  continueText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  arrow: { color: '#FFFFFF', fontSize: 22 },
  homeIndicator: { alignSelf: 'center', width: 128, height: 4, borderRadius: 4, backgroundColor: '#C8C1B7', marginTop: 14 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.96 }] },
  pressedButton: { backgroundColor: '#FEEA85', transform: [{ scale: 0.98 }] },
  pressedContinue: { backgroundColor: '#523E2C', transform: [{ scale: 0.98 }] },
});