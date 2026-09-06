import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { MaterialIcons } from '@expo/vector-icons';

interface TopNavigationProps {
  onNotificationPress?: () => void;
  hasUnreadNotifications?: boolean;
}

export default function TopNavigation({
  onNotificationPress,
  hasUnreadNotifications = true,
}: TopNavigationProps) {
  return (
    <View style={styles.header}>
      <View style={styles.container}>
        {/* Brand Logo: Wick + Sparkle */}
        <View style={styles.brandContainer}>
          <Text style={styles.brandText}>Wick</Text>
          <Svg width={20} height={20} viewBox="0 0 24 24" style={styles.sparkleIcon}>
            <Path
              d="M12 2L14.4 8.6L21 11L14.4 13.4L12 20L9.6 13.4L3 11L9.6 8.6L12 2Z"
              fill="#C29569"
            />
            <Circle cx="19" cy="5" r="1.5" fill="#C29569" />
          </Svg>
        </View>

        {/* Trailing Notification Button */}
        <Pressable
          accessibilityLabel="Notifications"
          onPress={onNotificationPress}
          style={({ pressed }) => [
            styles.notificationButton,
            pressed && styles.pressed,
          ]}
        >
          <MaterialIcons name="notifications-none" size={22} color="#2C2B29" />
          
          {/* Notification Badge Dot */}
          {hasUnreadNotifications && (
            <View style={styles.badgeDotContainer}>
              <View style={styles.badgeDot} />
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: 'rgba(255, 251, 235, 0.9)', // #FFFBEB/90
    width: '100%',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 12,
  },
  brandContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  brandText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#2C2B29',
    letterSpacing: -0.5,
    lineHeight: 32,
  },
  sparkleIcon: {
    marginLeft: 4,
  },
  notificationButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(210, 196, 185, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    shadowColor: '#6B5036',
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  badgeDotContainer: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF', 
    justifyContent: 'center',
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#BA1A1A',
  },
});