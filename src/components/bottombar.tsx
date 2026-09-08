import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type TabName = "Home" | "Desk" | "Recovery" | "Social";

interface BottomNavigationProps {
  activeTab?: TabName;
  router?: any;
}

export default function BottomNavigation({
  activeTab = "Home",
  router,
}: BottomNavigationProps) {
  const insets = useSafeAreaInsets();

  const tabs: {
    name: TabName;
    route: string;
    activeIcon: string;
    inactiveIcon: string;
  }[] = [
    {
      name: "Home",
      route: "/home",
      activeIcon: "home",
      inactiveIcon: "home-outline",
    },
    {
      name: "Desk",
      route: "/desk",
      activeIcon: "table-furniture",
      inactiveIcon: "table-furniture",
    },
    {
      name: "Recovery",
      route: "/recovery",
      activeIcon: "heart-pulse",
      inactiveIcon: "heart-pulse",
    },
    {
      name: "Social",
      route: "/social",
      activeIcon: "account",
      inactiveIcon: "account-outline",
    },
  ];

  const handlePress = (route: string, isActive: boolean) => {
    // Don't remount the current screen.
    if (!router || isActive) return;

    router.replace(route);
  };

  return (
    <View
      style={[
        styles.nav,
        {
          paddingBottom: Math.max(insets.bottom, 12),
        },
      ]}
    >
      <View style={styles.tabsRow}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.name;

          return (
            <Pressable
              key={tab.name}
              onPress={() => handlePress(tab.route, isActive)}
              accessibilityRole="tab"
              accessibilityState={{
                selected: isActive,
              }}
              style={({ pressed }) => [
                styles.tabItem,
                isActive && styles.activeTabItem,
                pressed && styles.pressed,
              ]}
            >
              <MaterialCommunityIcons
                name={
                  (isActive
                    ? tab.activeIcon
                    : tab.inactiveIcon) as any
                }
                size={22}
                color={
                  isActive
                    ? "#2C2B29"
                    : "#6B7280"
                }
              />

              <Text
                style={[
                  styles.tabLabel,
                  isActive
                    ? styles.activeLabel
                    : styles.inactiveLabel,
                ]}
              >
                {tab.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: {
    width: "100%",
    backgroundColor: "#FFFFFF",

    borderTopWidth: 1,
    borderTopColor: "#EAE5DB",

    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,

    shadowColor: "#6B5036",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: {
      width: 0,
      height: -4,
    },

    elevation: 8,
  },

  tabsRow: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",

    paddingHorizontal: 16,
    paddingTop: 10,
  },

  tabItem: {
    alignItems: "center",
    justifyContent: "center",

    paddingHorizontal: 12,
    paddingVertical: 4,

    borderRadius: 16,
  },

  activeTabItem: {
    backgroundColor: "#FEF08A",
    paddingHorizontal: 16,
  },

  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },

  tabLabel: {
    fontSize: 11,
    marginTop: 2,
  },

  activeLabel: {
    fontWeight: "600",
    color: "#2C2B29",
  },

  inactiveLabel: {
    fontWeight: "500",
    color: "#6B7280",
  },
});
