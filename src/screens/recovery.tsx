import { useFocusEffect, useRouter } from "expo-router";
import {
  CalendarDays,
  Check,
  ChevronRight,
  Sparkles,
  X,
  Zap,
} from "lucide-react-native";
import React, { useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Screen } from "../components/base";
import BottomNavigation from "../components/bottombar";
import TopNavigation from "../components/topbar";
import type { ChallengeRow, RecoveryDay, WorkloadItem } from "../data/types";
import {
  findRecoverySlot,
  getRecoveryDay,
  reserveRecoveryBlock,
  startOutdoorRecovery,
  verifyOutdoorRecovery
} from "../services/recoveryService";
import { listChallenges } from "../services/repository";

type Task = {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  badgeBackground: string;
  completed: boolean;
  action: "walk" | "calendar" | "social" | "challenge" | "workout";
  challengeId?: string;
};

// ========================================
// DEMO MOCK DATA
// Remove/disable this section for production.
// The real current-day read remains enabled below so the demo never invents
// which weekday is current or whether today's real threshold was reached.
// ========================================
const MOCK_RECOVERY_DATA = true;
const DEMO_INITIAL_CAPACITY = 60;
const RECOVERY_THRESHOLD = 70;

const demoCapacity = (gameMinutes: number) =>
  Math.min(100, DEMO_INITIAL_CAPACITY + gameMinutes * 5);

/** A joined recovery challenge is worth the same 5% as the other recovery actions. */
const applyJoinedChallengeCredit = (day: RecoveryDay, joinedChallenge: ChallengeRow | null): RecoveryDay => {
  if (!joinedChallenge?.joined || day.completedPlanIds.includes("challenge")) return day;

  return {
    ...day,
    completedPlanIds: [...day.completedPlanIds, "challenge"],
    recoveryPct: Math.min(100, day.recoveryPct + 5),
    updatedAt: new Date().toISOString(),
  };
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

function createPersonalizedTasks(
  items: WorkloadItem[],
  day: RecoveryDay,
  friends: number,
  joinedChallenge: ChallengeRow | null
): Task[] {
  const now = new Date();
  const todayItems = items.filter((item) => {
    if (!item.scheduledStart || !item.scheduledEnd) return false;
    const start = new Date(item.scheduledStart);
    return start.toDateString() === now.toDateString() && item.status === "scheduled";
  });
  const categories = ["physical", "social", "errands", "mental", "academic"] as const;
  const dominant = categories
    .map((category) => ({
      category,
      hours: todayItems
        .filter((item) => item.category === category)
        .reduce((total, item) => total + item.estimatedHours, 0),
    }))
    .sort((a, b) => b.hours - a.hours)[0]?.category ?? "mental";
  const slotStart = findRecoverySlot(items, now);
  const slot = `${formatTime(slotStart)}-${formatTime(new Date(slotStart.getTime() + 30 * 60_000))}`;
  const suggestions: Record<string, [string, string, string, string, Task["action"]]> = {
    physical: ["🏋️", "Schedule a workout session", `Free ${slot} • Gym / Yoga`, "Physical", "workout"],
    social: ["👋", friends > 0 ? "Reach Out" : "Join a Challenge", "Join in Circles", "Circles", friends > 0 ? "social" : "challenge"],
    errands: ["🛒", "Batch Errands", `Free ${slot} • Calendar`, "Calendar", "calendar"],
    mental: ["🚶", "Take an outdoor walk", "1,000 steps", "Walk", "walk"],
    academic: ["🚶", "Walk Outside", "1,000 steps", "Walk", "walk"],
  };
  const [emoji, title, subtitle, badge, action] = suggestions[dominant];
  const tasks: Task[] = [
    {
      id: action === "walk" ? "walk" : dominant,
      emoji,
      title,
      subtitle,
      badge,
      badgeColor: "#0E8A57",
      badgeBackground: "#DEF7EC",
      completed: action === "walk"
        ? day.outdoorCompleted
        : action === "challenge"
        ? Boolean(joinedChallenge?.joined)
        : day.completedPlanIds.includes(dominant),
      action,
      challengeId: action === "challenge" ? joinedChallenge?.id : undefined,
    },
    {
      id: "walk",
      emoji: "🚶",
      title: "Take an outdoor walk",
      subtitle: "1,000 steps",
      badge: "Reset",
      badgeColor: "#227AC9",
      badgeBackground: "#E1F1FD",
      completed: day.completedPlanIds.includes("walk"),
      action: "walk",
    },
    {
      id: "challenge",
      emoji: "🤝",
      title: joinedChallenge ? joinedChallenge.title : "Join a Challenge",
      subtitle: "Join in Circles",
      badge: joinedChallenge ? "Joined" : "Circles",
      badgeColor: "#227AC9",
      badgeBackground: "#E1F1FD",
      completed: Boolean(joinedChallenge?.joined),
      action: "challenge",
      challengeId: joinedChallenge?.id,
    },
  ];
  return tasks.filter((task, index, all) => all.findIndex((candidate) => candidate.id === task.id) === index);
}

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];

const createMockWorkload = (now: Date): WorkloadItem[] => {
  const start = new Date(now);
  start.setHours(15, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60_000);
  return [{
    id: "mock-gym",
    title: "Campus gym",
    category: "physical",
    estimatedHours: 1,
    priority: "high",
    source: "manual",
    status: "scheduled",
    scheduledStart: start.toISOString(),
    scheduledEnd: end.toISOString(),
    createdAt: now.toISOString(),
  }];
};

const createMockTasks = (
  slotStart: Date,
  completedPlanIds: string[],
  outdoorCompleted: boolean,
  joinedChallenge: ChallengeRow | null
): Task[] => {
  return [
    {
      id: "physical",
      emoji: "🏋️",
      title: "Schedule a workout session",
      subtitle: `${formatTime(new Date(slotStart.getTime() - 60 * 60_000))} - ${formatTime(slotStart)} • Gym / Yoga`,
      badge: "Physical",
      badgeColor: "#0E8A57",
      badgeBackground: "#DEF7EC",
      completed: completedPlanIds.includes("physical"),
      action: "workout",
    },
    {
      id: "walk",
      emoji: "🚶",
      title: "Take an outdoor walk",
      subtitle: "1,000 steps",
      badge: "Steps",
      badgeColor: "#227AC9",
      badgeBackground: "#E1F1FD",
      completed: outdoorCompleted || completedPlanIds.includes("walk"),
      action: "walk",
    },
    {
      id: "challenge",
      emoji: "🤝",
      title: joinedChallenge?.title ?? "Join a shared recovery challenge",
      subtitle: "Join in Circles",
      badge: joinedChallenge ? "Joined" : "Circles",
      badgeColor: "#227AC9",
      badgeBackground: "#E1F1FD",
      completed: Boolean(joinedChallenge?.joined),
      action: "challenge",
      challengeId: joinedChallenge?.id,
    },
  ];
};

const createMockWeek = (today: Date, todayCompleted: boolean): RecoveryDay[] => {
  const currentDayIndex = today.getDay() === 0 ? 6 : today.getDay() - 1;
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(today.getDate() - currentDayIndex);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    const isCompleted = index < currentDayIndex || (index === currentDayIndex && todayCompleted);
    return {
      date: date.toISOString().slice(0, 10),
      completedPlanIds: isCompleted ? ["mock-rest"] : [],
      gameCompleted: false,
      gameMinutes: 0,
      outdoorCompleted: false,
      recoveryPct: isCompleted ? 80 : DEMO_INITIAL_CAPACITY,
      updatedAt: date.toISOString(),
    };
  });
};

export default function RecoveryScreen() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [recoveryDay, setRecoveryDay] = useState<RecoveryDay | null>(null);
  const [recoverySlotStart, setRecoverySlotStart] = useState<Date | null>(null);
  const [recoveryWeek, setRecoveryWeek] = useState<RecoveryDay[]>([]);
  const [walkStarted, setWalkStarted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [gymVisible, setGymVisible] = useState(false);
  const demoInitialized = useRef(false);

  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);

  const currentDayIndex = new Date().getDay() === 0 ? 6 : new Date().getDay() - 1;
  const streakDays = Array.from({ length: 7 }, (_, index) => {
    const day = recoveryWeek[index];
    return day?.recoveryPct >= 80;
  });
  const lastCompletedIndex = streakDays[currentDayIndex] ? currentDayIndex : currentDayIndex - 1;
  let activeDays = 0;
  for (let index = lastCompletedIndex; index >= 0 && streakDays[index]; index -= 1) {
    activeDays += 1;
  }

  const capacity = recoveryDay?.recoveryPct ?? 0;
  const greenWidth = Math.min(100, capacity);
  const yellowWidth = 0;

  const completedTasks = tasks.filter((task) => task.completed).length;

  const showToastMessage = (message: string) => {
    setToastMessage(message);
    setShowToast(true);

    setTimeout(() => {
      setShowToast(false);
    }, 2300);
  };

  useFocusEffect(
    React.useCallback(() => {
      if (MOCK_RECOVERY_DATA) {
        let active = true;
        const loadDemoState = async () => {
          const now = new Date();
          const workload = createMockWorkload(now);
          const [realToday, challenges] = await Promise.all([
            getRecoveryDay(),
            listChallenges(),
          ]);
          if (!active) return;

          const joinedChallenge = challenges.find((challenge) => challenge.joined) ?? null;
          const realTodayCompleted = realToday.recoveryPct >= RECOVERY_THRESHOLD;
          const persistedGameCapacity = demoCapacity(realToday.gameMinutes ?? 0);
          const slotStart = findRecoverySlot(workload, now);

          if (!demoInitialized.current) {
            const mockDay = applyJoinedChallengeCredit({
              ...realToday,
              // Demo capacity is independent from the backend calculation.
              recoveryPct: persistedGameCapacity,
              gameMinutes: realToday.gameMinutes ?? 0,
              completedPlanIds: realToday.completedPlanIds ?? [],
              outdoorCompleted: realToday.outdoorCompleted,
              updatedAt: now.toISOString(),
            }, joinedChallenge);
            setRecoveryDay(mockDay);
            setRecoveryWeek(createMockWeek(now, realTodayCompleted));
            setWalkStarted(false);
            setRecoverySlotStart(slotStart);
            setTasks(createMockTasks(slotStart, mockDay.completedPlanIds, mockDay.outdoorCompleted, joinedChallenge));
            demoInitialized.current = true;
            return;
          }

          // Returning from Circles re-reads the real join state without resetting demo progress.
          setTasks((currentTasks) => currentTasks.map((task) => {
            if (task.id !== "challenge") return task;
            return {
              ...task,
              title: joinedChallenge?.title ?? "Join a shared recovery challenge",
              subtitle: "Join in Circles",
              badge: joinedChallenge ? "Joined" : "Circles",
              completed: Boolean(joinedChallenge?.joined),
              challengeId: joinedChallenge?.id,
            };
          }));
          setRecoveryDay((currentDay) => currentDay ? {
            ...currentDay,
            gameMinutes: realToday.gameMinutes ?? currentDay.gameMinutes,
            recoveryPct: Math.min(100, Math.max(currentDay.recoveryPct, persistedGameCapacity)),
          } : currentDay);
          if (joinedChallenge?.joined) {
            setRecoveryDay((currentDay) => {
              if (!currentDay) return currentDay;
              const creditedDay = applyJoinedChallengeCredit(currentDay, joinedChallenge);
              if (creditedDay === currentDay) return currentDay;
              setRecoveryWeek((currentWeek) => currentWeek.map((day, index) => (
                index === currentDayIndex && creditedDay.recoveryPct >= RECOVERY_THRESHOLD
                  ? { ...day, recoveryPct: 80, completedPlanIds: ["mock-rest"] }
                  : day
              )));
              return creditedDay;
            });
          }
          setRecoveryWeek((currentWeek) => currentWeek.map((day, index) => (
            index === currentDayIndex && realTodayCompleted
              ? { ...day, recoveryPct: 80 }
              : day
          )));
        };
        void loadDemoState();
        return () => {
          active = false;
        };
      }

      // ========================================
      // REAL DATA LOGIC — KEEP THIS
      // Currently disabled only for demo. Remove the demo branch above and
      // restore this service-backed loader for production behavior.
      // ========================================
      /*
      Promise.all([getRecoveryDay(), getRecoveryWeek(), hasOutdoorRecoveryStarted(), listWorkloadItems(), getFriends(), listChallenges()])
        .then(async ([day, week, started, workload, friends, challenges]) => {
          const joined = challenges.find((challenge) => challenge.joined && !challenge.completedByMe) ?? null;
          const verifiedChallenges = challenges.filter((challenge) => challenge.joined && challenge.completedByMe && challenge.verifiedByMe);
          for (const challenge of verifiedChallenges) await recordVerifiedPlan(`challenge:${challenge.id}`);
          const refreshedDay = verifiedChallenges.length > 0 ? await getRecoveryDay() : day;
          setRecoveryDay(refreshedDay);
          setRecoveryWeek(week);
          setWalkStarted(started);
          setRecoverySlotStart(findRecoverySlot(workload));
          setTasks(createPersonalizedTasks(workload, refreshedDay, friends.length, joined));
        })
        .catch(() => showToastMessage("Recovery data could not be loaded"));
      */
    }, [currentDayIndex])
  );

  const completeMockTask = (taskId: string) => {
    setTasks((currentTasks) => currentTasks.map((task) => task.id === taskId ? { ...task, completed: true } : task));
    setRecoveryDay((currentDay) => {
      if (!currentDay || currentDay.completedPlanIds.includes(taskId)) return currentDay;
      const recoveryPct = Math.min(100, currentDay.recoveryPct + 5);
      setRecoveryWeek((currentWeek) => currentWeek.map((day, index) => (
        index === currentDayIndex && recoveryPct >= RECOVERY_THRESHOLD
          ? { ...day, recoveryPct: 80, completedPlanIds: ["mock-rest"] }
          : day
      )));
      return {
        ...currentDay,
        completedPlanIds: [...currentDay.completedPlanIds, taskId],
        recoveryPct,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const openTask = (task: Task) => {
    if (task.completed) return;
    if (task.action === "walk") {
      if (walkStarted) void verifyWalk();
      else void startWalk();
      return;
    }
    if (task.action === "calendar") {
      setCalendarVisible(true);
      return;
    }
    if (MOCK_RECOVERY_DATA && task.action === "workout") {
      setGymVisible(true);
      return;
    }
    if (task.action === "workout") {
      showToastMessage("Physical task: schedule your gym session in the calendar");
      return;
    }
    if (task.action === "social") {
      router.push("/social" as never);
      return;
    }
    if (task.action === "challenge") {
      if (task.challengeId) router.push({ pathname: "/challenge", params: { id: task.challengeId } } as never);
      else router.push("/social" as never);
    }
  };

  const refreshRecoveryState = async () => {
    if (MOCK_RECOVERY_DATA) {
      const now = new Date();
      const currentDay = recoveryDay ?? {
        date: now.toISOString().slice(0, 10),
        completedPlanIds: [],
        gameCompleted: false,
        gameMinutes: 0,
        outdoorCompleted: false,
        recoveryPct: DEMO_INITIAL_CAPACITY,
        updatedAt: now.toISOString(),
      };
      const slotStart = findRecoverySlot(createMockWorkload(now), now);
      setRecoverySlotStart(slotStart);
      setTasks(createMockTasks(slotStart, currentDay.completedPlanIds, currentDay.outdoorCompleted, null));
      return;
    }
    /*
    const [day, week, started, workload, friends, challenges] = await Promise.all([
      getRecoveryDay(), getRecoveryWeek(), hasOutdoorRecoveryStarted(), listWorkloadItems(), getFriends(), listChallenges(),
    ]);
    setRecoveryDay(day);
    setRecoveryWeek(week);
    setWalkStarted(started);
    setRecoverySlotStart(findRecoverySlot(workload));
    setTasks(createPersonalizedTasks(workload, day, friends.length, challenges.find((challenge) => challenge.joined && !challenge.completedByMe) ?? null));
    */
  };

  const reserveBlock = async () => {
    setSaving(true);
    try {
      if (MOCK_RECOVERY_DATA) {
        setRecoveryDay((currentDay) => currentDay ? { ...currentDay, recoveryEventId: "mock-recovery-event", recoveryEventStart: recoverySlotStart?.toISOString() } : currentDay);
        setCalendarVisible(false);
        showToastMessage("Recovery window reserved. +5% capacity");
        return;
      }

      const result = await reserveRecoveryBlock(recoverySlotStart ?? undefined);
      await refreshRecoveryState();
      setCalendarVisible(false);
      showToastMessage(`Recovery block reserved for ${result.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      showToastMessage(error instanceof Error ? error.message : "Could not reserve recovery block");
    } finally {
      setSaving(false);
    }
  };

  const startWalk = async () => {
    setSaving(true);
    try {
      await startOutdoorRecovery();
      setWalkStarted(true);
      showToastMessage("Walk started. Check in again after your 1,000-step walk.");
    } catch (error) {
      showToastMessage(error instanceof Error ? error.message : "Could not start the walk check");
    } finally {
      setSaving(false);
    }
  };

  const verifyWalk = async () => {
    setSaving(true);
    try {
      const day = await verifyOutdoorRecovery();
      if (MOCK_RECOVERY_DATA) {
        completeMockTask("walk");
        setRecoveryDay((currentDay) => currentDay ? { ...currentDay, outdoorCompleted: true } : day);
      } else {
        setRecoveryDay(day);
      }
      setWalkStarted(false);
      showToastMessage("Walk verified. +5% capacity");
    } catch (error) {
      showToastMessage(error instanceof Error ? error.message : "Could not verify the walk");
    } finally {
      setSaving(false);
    }
  };


  const renderTaskBadge = (task: Task) => {
    if (task.completed) {
      return (
        <View
          style={[
            styles.taskBadge,
            styles.completedBadge,
          ]}
        >
          <Text style={styles.completedBadgeText}>
            Done
          </Text>
        </View>
      );
    }

    return (
      <View
        style={[
          styles.taskBadge,
          {
            backgroundColor: task.badgeBackground,
          },
        ]}
      >
        <Text
          style={[
            styles.taskBadgeText,
            {
              color: task.badgeColor,
            },
          ]}
        >
          {task.badge}
        </Text>
      </View>
    );
  };

  return (
    <Screen
      scroll={false}
      padded={false}
      header={<TopNavigation />}
      footer={<BottomNavigation activeTab="Recovery" router={router} />}
    >
      <View style={styles.screen}>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* REST STREAK */}
        <View style={styles.streakCard}>
          <View style={styles.streakTop}>
            <View style={styles.restStreakBadge}>
              <Text style={styles.restStreakText}>
                REST STREAK
              </Text>
            </View>

            <View style={styles.restoredBadge}>
              <View style={styles.greenDot} />

              <Text style={styles.restoredText}>
                +{activeDays * 7}% Restored
              </Text>
            </View>
          </View>

          <View style={styles.streakHeading}>
            <View style={styles.streakTitleRow}>
              <Text style={styles.streakTitle}>
                {activeDays}-day streak
              </Text>

              <Text style={styles.fire}>🔥</Text>
            </View>

            <Text style={styles.streakSubtitle}>
              Rewards earned for verified rest taken,
              not productivity. Reach 70% today to earn this day&apos;s streak.
            </Text>
          </View>

          {/* Weekly tracker */}
          <View style={styles.daysContainer}>
            {DAYS.map((day, index) => {
              const isActive = streakDays[index];
              const isToday = index === currentDayIndex;

              return (
                <View
                  key={`${day}-${index}`}
                  style={styles.dayButton}
                >
                  <Text
                    style={[
                      styles.dayLabel,
                      isToday && styles.currentDayLabel,
                      !isActive &&
                        styles.inactiveDayLabel,
                    ]}
                  >
                    {day}
                  </Text>

                  <View
                    style={[
                      styles.dayCircle,
                      isActive &&
                        !isToday &&
                        styles.activeDayCircle,
                      isToday &&
                        styles.todayCircle,
                    ]}
                  >
                    {isActive ? (
                      <Check
                        size={16}
                          color={isToday ? "#FFFFFF" : "#1E9E60"}
                        strokeWidth={3}
                      />
                    ) : (
                      <View style={styles.inactiveDot} />
                    )}
                  </View>
                </View>
              );
            })}
          </View>

          {/* Capacity */}
          <View style={styles.capacitySection}>
            <View style={styles.capacityHeader}>
              <Text style={styles.capacityTitle}>
                Autonomic Nervous System Capacity
              </Text>

              <Text style={styles.capacityNumber}>
                {capacity}%
              </Text>
            </View>

            <View style={styles.capacityTrack}>
              <View
                style={[
                  styles.greenCapacity,
                  {
                    width: `${greenWidth}%`,
                  },
                ]}
              />

              <View
                style={[
                  styles.yellowCapacity,
                  {
                    width: `${yellowWidth}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        {/* RECOVERY PLAN */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Your Recovery Plan
            </Text>

            <View style={styles.counterPill}>
              <Text style={styles.counterPillText}>
                {completedTasks}/{tasks.length} done
              </Text>
            </View>
          </View>

          {tasks.map((task) => (
            <TouchableOpacity
              key={task.id}
              style={[
                styles.taskCard,
                task.completed &&
                  styles.completedTaskCard,
              ]}
              activeOpacity={0.85}
              onPress={() =>
                openTask(task)
              }
            >
              <View style={styles.taskLeft}>
                <View
                  style={[
                    styles.taskIcon,
                    task.id === "physical" &&
                      styles.taskIconGreen,
                    task.id === "social" &&
                      styles.taskIconBlue,
                    task.id === "errands" &&
                      styles.taskIconPink,
                    (task.id === "mental" || task.id === "walk") &&
                      styles.taskIconPurple,
                  ]}
                >
                  <Text style={styles.taskEmoji}>
                    {task.completed
                      ? "✅"
                      : task.emoji}
                  </Text>
                </View>

                <View style={styles.taskTextArea}>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.taskTitle,
                      task.completed &&
                        styles.completedTaskTitle,
                    ]}
                  >
                    {task.title}
                  </Text>

                  <Text
                    numberOfLines={1}
                    style={styles.taskSubtitle}
                  >
                    {task.id === "walk" && walkStarted
                      ? "Walk started • verify 1,000 steps"
                      : task.subtitle}
                  </Text>

                  {task.id === "walk" && (
                    <>
                      <View style={styles.taskProgressTrack}>
                        <View
                          style={[
                            styles.taskProgressFill,
                            { width: `${task.completed ? 100 : walkStarted ? 50 : 0}%` },
                          ]}
                        />
                      </View>
                      {!task.completed && (
                        <TouchableOpacity
                          style={styles.walkAccessButton}
                          onPress={() => openTask(task)}
                        >
                          <Text style={styles.walkAccessButtonText}>
                            {walkStarted ? "Verify 1,000 steps" : "Allow access & start"}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </>
                  )}
                </View>
              </View>

              {renderTaskBadge(task)}
            </TouchableOpacity>
          ))}

        </View>

        {/* CALENDAR */}
        <View style={styles.calendarCard}>
          <View style={styles.calendarHeader}>
            <View style={styles.calendarIconBox}>
              <CalendarDays
                size={24}
                color="#E07912"
              />
            </View>

            <View style={styles.calendarTextContainer}>
              <Text style={styles.calendarBadge}>
                CALENDAR AUTO-BLOCKED
              </Text>

              <Text style={styles.calendarTitle}>
                Today, {recoverySlotStart ? formatTime(recoverySlotStart) : "3:00 PM"} –{" "}
                {recoverySlotStart
                  ? formatTime(new Date(recoverySlotStart.getTime() + 30 * 60_000))
                  : "3:30 PM"}
              </Text>
            </View>
          </View>

          <View style={styles.notificationNote}>
            <Zap
              size={14}
              color="#D78A00"
              fill="#D78A00"
            />

            <Text style={styles.notificationNoteText}>
              Notifications will be paused automatically
              during this block to prevent digital fatigue.
            </Text>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() =>
              setCalendarVisible(true)
            }
          >
            <Text style={styles.primaryButtonText}>
              View in Calendar
            </Text>

            <ChevronRight
              size={17}
              color="#1F1E1B"
            />
          </TouchableOpacity>
        </View>

        {/* QUICK DE-STRESS */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              Quick De-Stress
            </Text>

            <Text style={styles.instantResetText}>
              Instant resets
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={
              styles.destressScroll
            }
          >
            <TouchableOpacity
              style={[
                styles.destressCard,
                styles.highlightedDestressCard,
              ]}
              activeOpacity={0.85}
              onPress={() => router.push("/bubblepop" as never)}
            >
              <View
                style={[
                  styles.destressImage,
                  styles.bubbleBackground,
                ]}
              >
                <Text style={styles.destressEmoji}>
                  🧼
                </Text>
              </View>

              <Text style={styles.destressTitle}>
                Bubble Pop
              </Text>

              <Text
                numberOfLines={1}
                style={styles.destressSubtitle}
              >
                Tactile stress relief
              </Text>

              <View style={styles.playButton}>
                <Text style={styles.playButtonText}>
                  ▶ Play
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.destressCard}
              activeOpacity={0.85}
              onPress={() => showToastMessage("Breathing Garden is coming soon")}
            >
              <View
                style={[
                  styles.destressImage,
                  styles.gardenBackground,
                ]}
              >
                <Text style={styles.destressEmoji}>
                  🌸
                </Text>
              </View>

              <Text style={styles.destressTitle}>
                Breathing Garden
              </Text>

              <Text
                numberOfLines={1}
                style={styles.destressSubtitle}
              >
                Coherence pacing
              </Text>

              <View style={styles.playButton}>
                <Text style={styles.playButtonText}>
                  Play
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.destressCard}
              activeOpacity={0.85}
              onPress={() => showToastMessage("Color Zen is coming soon")}
            >
              <View
                style={[
                  styles.destressImage,
                  styles.colorBackground,
                ]}
              >
                <Text style={styles.destressEmoji}>
                  🎨
                </Text>
              </View>

              <Text style={styles.destressTitle}>
                Color Zen
              </Text>

              <Text
                numberOfLines={1}
                style={styles.destressSubtitle}
              >
                Visual rest
              </Text>

              <View style={styles.playButton}>
                <Text style={styles.playButtonText}>
                  Play
                </Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        </View>

        <View style={{ height: 30 }} />
      </ScrollView>

      {/* DEMO GYM CONFIRMATION: opening the card is not completion. */}
      <Modal
        visible={gymVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGymVisible(false)}
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() => setGymVisible(false)}
        >
          <Pressable
            style={styles.bottomSheet}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetBadge}>CALENDAR ACTION</Text>
            <Text style={styles.sheetTitle}>Schedule your activity</Text>
            <Text style={styles.notificationNoteText}>
              Campus gym is scheduled at {recoverySlotStart ? formatTime(new Date(recoverySlotStart.getTime() - 60 * 60_000)) : "3:00 PM"}. Confirm the separate physical recovery action to complete this task.
            </Text>
            <TouchableOpacity
              style={styles.primaryButton}
              disabled={saving}
              onPress={() => {
                completeMockTask("physical");
                setGymVisible(false);
                showToastMessage("Gym session scheduled. +5% capacity");
              }}
            >
              <Text style={styles.primaryButtonText}>Confirm Gym Session</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.doneButton}
              onPress={() => setGymVisible(false)}
            >
              <Text style={styles.doneButtonText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* CALENDAR MODAL */}
      <Modal
        visible={calendarVisible}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setCalendarVisible(false)
        }
      >
        <Pressable
          style={styles.modalOverlay}
          onPress={() =>
            setCalendarVisible(false)
          }
        >
          <Pressable
            style={styles.bottomSheet}
            onPress={(event) =>
              event.stopPropagation()
            }
          >
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View>
                <Text style={styles.sheetBadge}>
                  SCHEDULED DND WINDOW
                </Text>

                <Text style={styles.sheetTitle}>
                  Focus & Rest Block
                </Text>
              </View>

              <TouchableOpacity
                style={styles.closeButton}
                onPress={() =>
                  setCalendarVisible(false)
                }
              >
                <X size={18} color="#777" />
              </TouchableOpacity>
            </View>

            <View style={styles.calendarInfoBox}>
              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>
                  Active Interval:
                </Text>

                <Text style={styles.infoValue}>
                  {recoverySlotStart ? formatTime(recoverySlotStart) : "3:00 PM"} –{" "}
                  {recoverySlotStart
                    ? formatTime(new Date(recoverySlotStart.getTime() + 30 * 60_000))
                    : "3:30 PM"}
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>
                  Smart DND status:
                </Text>

                <Text style={styles.armedText}>
                  Armed (Strict)
                </Text>
              </View>

              <View style={styles.infoRow}>
                <Text style={styles.infoLabel}>
                  Calendar synced:
                </Text>

                <Text style={styles.syncText}>
                  Apple Calendar
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={styles.primaryButton}
              disabled={saving}
              onPress={reserveBlock}
            >
              <Text style={styles.primaryButtonText}>
                {saving ? "Reserving..." : "Reserve Recovery Block"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.doneButton}
              onPress={() =>
                setCalendarVisible(false)
              }
            >
              <Text style={styles.doneButtonText}>
                Done
              </Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* TOAST */}
      {showToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>
            {toastMessage}
          </Text>

          <Sparkles
            size={16}
            color="#F9C846"
          />
        </View>
      )}
    </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#FFFBEB",
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },

  streakCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "#EDEAE1",
    marginBottom: 30,
  },

  streakTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  restStreakBadge: {
    backgroundColor: "#FEF3E4",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },

  restStreakText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#A05E1A",
    letterSpacing: 0.8,
  },

  restoredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E7F7EF",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },

  greenDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#1EA265",
  },

  restoredText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#168754",
  },

  streakHeading: {
    marginTop: 14,
  },

  streakTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  streakTitle: {
    fontSize: 25,
    fontWeight: "800",
    color: "#1C1B18",
  },

  fire: {
    fontSize: 20,
    marginLeft: 5,
  },

  streakSubtitle: {
    fontSize: 12,
    color: "#7A7771",
    marginTop: 4,
    lineHeight: 18,
  },

  daysContainer: {
    marginTop: 22,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  dayButton: {
    alignItems: "center",
    gap: 7,
  },

  dayLabel: {
    fontSize: 11,
    color: "#737373",
    fontWeight: "500",
  },

  currentDayLabel: {
    color: "#111111",
    fontWeight: "800",
  },

  inactiveDayLabel: {
    color: "#AAAAAA",
  },

  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#F1F0ED",
    justifyContent: "center",
    alignItems: "center",
  },

  activeDayCircle: {
    backgroundColor: "#DEF4E8",
  },

  todayCircle: {
    backgroundColor: "#F5BE32",
    shadowColor: "#F5BE32",
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },

  inactiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#C9C6C0",
  },

  capacitySection: {
    marginTop: 24,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: "#F0F0EE",
  },

  capacityHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 9,
  },

  capacityTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: "#4B4B4B",
  },

  capacityNumber: {
    fontSize: 12,
    fontWeight: "800",
    color: "#1C1B18",
  },

  capacityTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: "#EEEEEE",
    flexDirection: "row",
    overflow: "hidden",
  },

  greenCapacity: {
    height: "100%",
    backgroundColor: "#3EB87E",
    borderTopLeftRadius: 8,
    borderBottomLeftRadius: 8,
  },

  yellowCapacity: {
    height: "100%",
    backgroundColor: "#F5C242",
    borderTopRightRadius: 8,
    borderBottomRightRadius: 8,
  },

  calendarCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "#EDEAE1",
    marginTop: -20,
    marginBottom: 30,
  },

  calendarHeader: {
    flexDirection: "row",
    gap: 13,
    alignItems: "center",
  },

  calendarIconBox: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: "#FFF5E6",
    justifyContent: "center",
    alignItems: "center",
  },

  calendarTextContainer: {
    flex: 1,
  },

  calendarBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: "#E07912",
    letterSpacing: 0.7,
  },

  calendarTitle: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "800",
    color: "#181818",
  },

  notificationNote: {
    marginTop: 16,
    backgroundColor: "#FCF7E9",
    borderRadius: 16,
    padding: 13,
    flexDirection: "row",
    gap: 9,
    alignItems: "flex-start",
  },

  notificationNoteText: {
    flex: 1,
    fontSize: 12,
    color: "#7C6A48",
    lineHeight: 18,
  },

  primaryButton: {
    height: 48,
    backgroundColor: "#FDEE9E",
    borderRadius: 16,
    marginTop: 16,
    justifyContent: "center",
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },

  primaryButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1F1E1B",
  },

  section: {
    marginBottom: 22,
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#1F1E1B",
  },

  counterPill: {
    backgroundColor: "#F2EEDE",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },

  counterPillText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#666666",
  },

  instantResetText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#A05E1A",
  },

  taskCard: {
    backgroundColor: "#FFFFFF",
    minHeight: 68,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EDEAE1",
    padding: 12,
    marginBottom: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  completedTaskCard: {
    backgroundColor: "#FAFAF7",
  },

  taskLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
  },

  taskIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 11,
  },

  taskIconGreen: {
    backgroundColor: "#E2F7EB",
  },

  taskIconBlue: {
    backgroundColor: "#E8F4FD",
  },

  taskIconPink: {
    backgroundColor: "#FDEEED",
  },

  taskIconPurple: {
    backgroundColor: "#F3EAFD",
  },

  taskEmoji: {
    fontSize: 19,
  },

  taskTextArea: {
    flex: 1,
    minWidth: 0,
  },

  taskTitle: {
    fontSize: 12,
    fontWeight: "800",
    color: "#202020",
  },

  completedTaskTitle: {
    color: "#A0A0A0",
    textDecorationLine: "line-through",
  },

  taskSubtitle: {
    fontSize: 10,
    color: "#777777",
    marginTop: 4,
  },

  taskProgressTrack: {
    height: 5,
    borderRadius: 5,
    backgroundColor: "#EEEEEE",
    overflow: "hidden",
    marginTop: 7,
  },

  taskProgressFill: {
    height: "100%",
    borderRadius: 5,
    backgroundColor: "#3EB87E",
  },

  walkAccessButton: {
    alignSelf: "flex-start",
    marginTop: 7,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 9,
    backgroundColor: "#E1F1FD",
  },

  walkAccessButtonText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#227AC9",
  },

  taskBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 8,
  },

  taskBadgeText: {
    fontSize: 10,
    fontWeight: "700",
  },

  completedBadge: {
    backgroundColor: "#DDF5E7",
  },

  completedBadgeText: {
    color: "#0E8A57",
    fontSize: 10,
    fontWeight: "800",
  },

  destressScroll: {
    gap: 12,
    paddingRight: 8,
  },

  destressCard: {
    width: 145,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: "#EDEAE1",
  },

  highlightedDestressCard: {
    borderWidth: 2,
    borderColor: "#F6DC78",
  },

  quickBadge: {
    position: "absolute",
    top: -9,
    right: -2,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    zIndex: 2,
  },

  quickBadgeText: {
    color: "#FFFFFF",
    fontSize: 8,
    fontWeight: "800",
  },

  destressImage: {
    height: 80,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  bubbleBackground: {
    backgroundColor: "#FDEBEB",
  },

  gardenBackground: {
    backgroundColor: "#DFF7EC",
  },

  colorBackground: {
    backgroundColor: "#E1F1FD",
  },

  destressEmoji: {
    fontSize: 28,
  },

  destressTitle: {
    marginTop: 10,
    fontSize: 12,
    fontWeight: "800",
    color: "#222222",
  },

  destressSubtitle: {
    marginTop: 3,
    fontSize: 10,
    color: "#777777",
  },

  playButton: {
    marginTop: 12,
    height: 32,
    borderRadius: 11,
    backgroundColor: "#FDEE9E",
    justifyContent: "center",
    alignItems: "center",
  },

  playButtonText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1F1E1B",
  },

  geoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    padding: 20,
    borderWidth: 1,
    borderColor: "#EDEAE1",
  },

  geoHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  geoIconBox: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: "#E4F7ED",
    justifyContent: "center",
    alignItems: "center",
  },

  geoVerifiedIcon: {
    backgroundColor: "#DEF7EC",
  },

  geoTextArea: {
    flex: 1,
  },

  geoTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#222222",
  },

  geoSubtitle: {
    marginTop: 3,
    fontSize: 11,
    color: "#777777",
  },

  geoDescription: {
    marginTop: 16,
    fontSize: 12,
    color: "#666666",
    lineHeight: 19,
  },

  geoButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },

  geoYesButton: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#FDEE9E",
    justifyContent: "center",
    alignItems: "center",
  },

  geoYesText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#1F1E1B",
  },

  geoNoButton: {
    flex: 1,
    height: 42,
    borderRadius: 13,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#DDDDDD",
    justifyContent: "center",
    alignItems: "center",
  },

  geoNoText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#555555",
  },

  natureCompleted: {
    marginTop: 16,
    backgroundColor: "#E7F7EF",
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  natureText: {
    fontSize: 11,
    color: "#168754",
    fontWeight: "700",
  },

  restBoostBadge: {
    backgroundColor: "#1EA265",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },

  restBoostText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "800",
  },

  headingOutButton: {
    marginTop: 16,
    height: 43,
    backgroundColor: "#FFF5E6",
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#F6DC78",
    justifyContent: "center",
    alignItems: "center",
  },

  headingOutText: {
    color: "#A05E1A",
    fontSize: 11,
    fontWeight: "800",
  },

  bottomNavigation: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 76,
    backgroundColor: "rgba(255,255,255,0.97)",
    borderTopWidth: 1,
    borderTopColor: "#ECE8DE",
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingBottom: 6,
  },

  navItem: {
    alignItems: "center",
    gap: 4,
  },

  navIcon: {
    width: 48,
    height: 26,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },

  activeNavIcon: {
    backgroundColor: "#FDEE9E",
  },

  navText: {
    fontSize: 10,
    fontWeight: "500",
    color: "#999999",
  },

  activeNavText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#1F1E1B",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.42)",
    justifyContent: "flex-end",
  },

  bottomSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 24,
    paddingBottom: 34,
  },

  sheetHandle: {
    width: 48,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D2D0CC",
    alignSelf: "center",
    marginBottom: 18,
  },

  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },

  sheetBadge: {
    fontSize: 10,
    fontWeight: "800",
    color: "#E07912",
    letterSpacing: 0.8,
  },

  sheetTitle: {
    fontSize: 19,
    fontWeight: "800",
    color: "#1F1E1B",
    marginTop: 4,
  },

  closeButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#F1F1EF",
    justifyContent: "center",
    alignItems: "center",
  },

  calendarInfoBox: {
    marginTop: 18,
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#F6DC78",
    borderRadius: 18,
    padding: 15,
    gap: 14,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  infoLabel: {
    fontSize: 11,
    color: "#77716A",
  },

  infoValue: {
    fontSize: 11,
    fontWeight: "700",
    color: "#222222",
  },

  armedText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#168754",
  },

  syncText: {
    fontSize: 10,
    fontWeight: "600",
    color: "#555555",
  },

  doneButton: {
    height: 44,
    justifyContent: "center",
    alignItems: "center",
  },

  doneButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#777777",
  },

  gameHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  gameEmoji: {
    fontSize: 32,
  },

  gameTitle: {
    fontSize: 17,
    fontWeight: "800",
    color: "#222222",
  },

  gameTag: {
    fontSize: 11,
    color: "#777777",
    marginTop: 3,
  },

  gameDescriptionBox: {
    marginTop: 18,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FCF7E9",
  },

  gameDescription: {
    fontSize: 12,
    color: "#666666",
    lineHeight: 18,
  },

  bubbleGrid: {
    marginTop: 16,
    backgroundColor: "#FAFAF8",
    borderWidth: 1,
    borderColor: "#E6E4DF",
    borderRadius: 18,
    padding: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },

  bubbleButton: {
    width: "22%",
    aspectRatio: 1,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
  },

  pinkBubble: {
    backgroundColor: "#FDE5EA",
  },

  amberBubble: {
    backgroundColor: "#FEF1CD",
  },

  emeraldBubble: {
    backgroundColor: "#DFF5E8",
  },

  poppedBubble: {
    opacity: 0.4,
    transform: [{ scale: 0.9 }],
  },

  bubbleEmoji: {
    fontSize: 21,
  },

  toast: {
    position: "absolute",
    top: 55,
    alignSelf: "center",
    width: "88%",
    maxWidth: 360,
    backgroundColor: "#1C1C1A",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 13,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 999,
  },

  toastText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontWeight: "600",
    flex: 1,
    marginRight: 10,
  },
});
