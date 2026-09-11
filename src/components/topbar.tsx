import { useNotifications } from '@/components/NotificationProvider';
import { useState } from 'react';

import { supabase } from '@/lib/supabaseClient';
import { colors } from '@/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

interface TopNavigationProps {
  onLogoutPress?: () => void;
  showLogout?: boolean;
}

/**
 * The Wick brand mark on its own.
 *
 * Desk and Social used to write their own header — `<Txt v="title">Wick ✳</Txt>`
 * with a text asterisk — while Home rendered this SVG sparkle. Two different
 * marks for the same brand, on tabs of the same app. Exported so there is one
 * definition of what the logo looks like.
 */
export function WickMark({ size = 20 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2L14.4 8.6L21 11L14.4 13.4L12 20L9.6 13.4L3 11L9.6 8.6L12 2Z"
        fill="#C29569"
      />
      <Circle cx="19" cy="5" r="1.5" fill="#C29569" />
    </Svg>
  );
}

export default function TopNavigation({
  onLogoutPress,
  showLogout = true,
}: TopNavigationProps) {
  const router = useRouter();
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { notifications, hasUnread, markRead, markAllRead } = useNotifications();

  // Logging out is the same from every tab: end the Supabase session and
  // return to the login screen. A screen can override this with onLogoutPress.
  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  // The button only opens the confirmation; the sign-out itself happens here.
  const handleConfirmLogout = async () => {
    setShowLogoutConfirm(false);
    await (onLogoutPress ?? handleLogout)();
  };

  return (
    <View style={styles.header}>
      <View style={styles.container}>
        {/* Brand Logo: Wick + Sparkle */}
        <View style={styles.brandContainer}>
          <Text style={styles.brandText}>Wick</Text>
          <View style={styles.sparkleIcon}>
            <WickMark />
          </View>
        </View>

        {/* Trailing actions: notifications + logout */}
        <View style={styles.trailingRow}>
          <Pressable
            accessibilityLabel="Notifications"
            onPress={() => setShowNotifications(true)}
            style={({ pressed }) => [
              styles.iconButton,
              pressed && styles.pressed,
            ]}
          >
            <MaterialIcons name="notifications-none" size={22} color="#2C2B29" />

            {/* Notification Badge Dot */}
            {hasUnread && (
              <View style={styles.badgeDotContainer}>
                <View style={styles.badgeDot} />
              </View>
            )}
          </Pressable>

          {showLogout && (
            <Pressable
              accessibilityLabel="Log Out"
              onPress={() => setShowLogoutConfirm(true)}
              style={({ pressed }) => [
                styles.iconButton,
                pressed && styles.pressed,
              ]}
            >
              <MaterialIcons name="logout" size={22} color="#2C2B29" />
            </Pressable>
          )}
        </View>
      </View>

      {/* The notification modal and its state belong to the shared top bar, so
          every route shows the same list and read state. */}
      {(
        <Modal
          visible={showNotifications}
          transparent
          animationType="fade"
          onRequestClose={() => setShowNotifications(false)}
        >
          <View style={styles.confirmOverlay}>
            <View style={styles.notificationCard}>
              <View style={styles.notificationHeader}>
                <View>
                  <Text style={styles.confirmTitle}>Notifications</Text>
                  <Text style={styles.notificationSubtitle}>
                    {hasUnread ? `${notifications.filter((notification) => !notification.read).length} unread` : 'All caught up'}
                  </Text>
                </View>
                <Pressable onPress={() => setShowNotifications(false)} hitSlop={8}>
                  <MaterialIcons name="close" size={22} color={colors.inkSoft} />
                </Pressable>
              </View>
              {notifications.map((notification) => (
                <Pressable
                  key={notification.id}
                  onPress={() => markRead(notification.id)}
                  style={styles.notificationItem}
                >
                  <View style={styles.notificationDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.notificationTitle}>{notification.title}</Text>
                    <Text style={styles.notificationBody}>{notification.body}</Text>
                    <Text style={styles.notificationTime}>{notification.time}</Text>
                  </View>
                </Pressable>
              ))}
              {hasUnread && <Pressable style={styles.notificationDone} onPress={markAllRead}>
                <Text style={styles.notificationDoneText}>Mark all read</Text>
              </Pressable>}
          
            </View>
          </View>
        </Modal>
      )}

      {/* Logout confirmation — a destructive action deserves a pause */}
      <Modal
        visible={showLogoutConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutConfirm(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <View style={styles.confirmIconWrap}>
              <MaterialIcons name="logout" size={26} color={colors.alert} />
            </View>
            <Text style={styles.confirmTitle}>Log out?</Text>
            <Text style={styles.confirmMessage}>
              You'll need to sign in again to reach your dashboard.
            </Text>
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityLabel="Cancel"
                onPress={() => setShowLogoutConfirm(false)}
                style={({ pressed }) => [styles.confirmCancelBtn, pressed && styles.pressed]}
              >
                <Text style={styles.confirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="Confirm Log Out"
                onPress={handleConfirmLogout}
                style={({ pressed }) => [styles.confirmLogoutBtn, pressed && styles.pressed]}
              >
                <Text style={styles.confirmLogoutText}>Log Out</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  iconButton: {
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
  trailingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  /* Shared modal styles — used by notifications and logout confirmation. */
  confirmOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center' },
  notificationCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 20, maxWidth: '88%', width: 360 },
  notificationHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  notificationSubtitle: { fontSize: 12, color: colors.inkSoft, marginTop: 3 },
  notificationItem: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.cream, borderRadius: 14, padding: 12, marginBottom: 10 },
  notificationDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.alert, marginTop: 5, marginRight: 10 },
  notificationTitle: { fontSize: 14, fontWeight: '700', color: colors.ink, marginBottom: 3 },
  notificationBody: { fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  notificationTime: { fontSize: 11, color: colors.inkFaint, marginTop: 5 },
  notificationDone: { alignItems: 'center', backgroundColor: colors.brown, borderRadius: 14, paddingVertical: 12, marginTop: 4 },
  notificationDoneText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  confirmCard: { backgroundColor: colors.surface, borderRadius: 24, padding: 24, maxWidth: '85%', width: 320, alignItems: 'center' },
  confirmIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.alertWash, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  confirmTitle: { fontSize: 18, fontWeight: '700', color: colors.ink, marginBottom: 6 },
  confirmMessage: { fontSize: 13, lineHeight: 19, color: colors.inkSoft, textAlign: 'center', marginBottom: 20 },
  confirmActions: { flexDirection: 'row', gap: 10, width: '100%' },
  confirmCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.line, alignItems: 'center' },
  confirmCancelText: { fontSize: 14, fontWeight: '600', color: colors.inkSoft },
  confirmLogoutBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.alert, alignItems: 'center' },
  confirmLogoutText: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});