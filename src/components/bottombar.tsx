import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type TabName = 'Home' | 'Desk' | 'Recovery' | 'Social';

/*
 * RECOVERY TAB — reserved for Shino.
 *
 * The icon stays so the bar keeps its intended shape, but `route` is null and
 * the tab is dimmed and non-interactive. That is the important difference from
 * how this shipped the first time: then it pointed at '/recovery' when no such
 * route existed, so tapping it silently did nothing and looked broken. Now it
 * reads as a place that is not ready yet.
 *
 * To wire it up: create src/app/recovery.tsx and set `route: '/recovery'`.
 */

interface BottomNavigationProps {
  activeTab?: TabName;
  router?: any; // Expo Router instance
}

export default function BottomNavigation({
  activeTab = 'Home',
  router,
}: BottomNavigationProps) {
  const tabs: {
    name: TabName;
    /** null = reserved, rendered but not navigable. */
    route: string | null;
    activeIcon: string;
    inactiveIcon: string;
  }[] = [
    {
      name: 'Home',
      route: '/home',
      activeIcon: 'home',
      inactiveIcon: 'home-outline',
    },
    {
      name: 'Desk',
      route: '/desk',
      activeIcon: 'table-furniture',
      inactiveIcon: 'table-furniture',
    },
    {
      name: 'Recovery',
      route: null,
      activeIcon: 'heart-pulse',
      inactiveIcon: 'heart-pulse',
    },
    {
      name: 'Social',
      route: '/social',
      activeIcon: 'account',
      inactiveIcon: 'account-outline',
    },
  ];

  /**
   * `replace`, not `push`.
   *
   * A tab bar names the destinations you can be at; a stack names how you got
   * somewhere. Pushing meant every tap stacked another screen on top of the
   * last, so Social opened *over* Desk rather than replacing it — three taps
   * around the bar left three screens on the stack, the back gesture retraced
   * your tab history, and the bar stopped describing where you were. Replacing
   * keeps the stack one deep, which is what a tab actually is.
   *
   * A real expo-router `(tabs)` group would be better still: it would keep each
   * tab's own scroll position and its own nested history. That is a change to
   * the route tree rather than to this component, so it is left alone here.
   */
  const handlePress = (route: string | null, isActive: boolean) => {
    // Re-tapping the tab you are on should do nothing, not remount the screen.
    if (!router || isActive || !route) return;
    router.replace(route);
  };

  return (
    <View style={styles.nav}>
      {tabs.map((tab) => {
        const isActive = activeTab === tab.name;
        const reserved = tab.route === null;

        return (
          <Pressable
            key={tab.name}
            onPress={() => handlePress(tab.route, isActive)}
            disabled={reserved}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive, disabled: reserved }}
            accessibilityHint={reserved ? 'Coming soon' : undefined}
            style={({ pressed }) => [
              styles.tabItem,
              isActive && styles.activeTabItem,
              reserved && styles.reserved,
              pressed && !reserved && styles.pressed,
            ]}
          >
            <MaterialCommunityIcons
              name={(isActive ? tab.activeIcon : tab.inactiveIcon) as any}
              size={22}
              color={isActive ? '#2C2B29' : '#6B7280'}
            />
            <Text style={[styles.tabLabel, isActive ? styles.activeLabel : styles.inactiveLabel]}>
              {tab.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 20, // Bottom padding for safe area spacing
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EAE5DB',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    // Elevation shadow
    shadowColor: '#6B5036',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  activeTabItem: {
    backgroundColor: '#FEF08A',
    paddingHorizontal: 16,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  /** Reserved: present in the bar, visibly not ready, and not tappable. */
  reserved: {
    opacity: 0.35,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  activeLabel: {
    fontWeight: '600',
    color: '#2C2B29',
  },
  inactiveLabel: {
    fontWeight: '500',
    color: '#6B7280',
  },
});