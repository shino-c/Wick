import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ActivityIndicator,
	Modal,
	PanResponder,
	Pressable,
	ScrollView,
	StyleSheet,
	View,
} from "react-native";

import { Badge, Card, Emoji, Row, Screen, Txt } from "@/components/base";
import BottomNavigation from "@/components/bottombar";
import TopNavigation from "@/components/topbar";
import { GARDEN_CATALOG } from "@/data/gardenCatalog";
import type {
	DailyRecoveryPlan,
	GardenItem,
	GardenWallet,
	RecoveryPlanSession,
	RecoverySuggestion,
} from "@/data/types";
import { formatSchedule } from "@/features/circles/scheduling";
import {
	completePlanSession,
	getDailyRecoveryPlan,
	getPlanSessions,
	setChallengeJoinedForToday,
	startPlanSession,
	updatePlanProgress,
} from "@/services/recoveryService";
import {
	ensureStarterGardenItem,
	getGardenItems,
	getGardenWallet,
	purchaseGardenItem,
	toggleChallenge,
	updateGardenItemPosition,
} from "@/services/repository";
import {
	ensureStepPermission,
	isStepTrackingAvailable,
	watchStepsFromNow,
} from "@/services/stepTracking";
import { colors, radius, spacing } from "@/theme";

const PLAN_REWARD_SEEDS = 10;

function formatMin(minutes: number): string {
	if (minutes < 60) return `${minutes} min`;
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatTarget(suggestion: RecoverySuggestion): string {
	return suggestion.targetType === "steps"
		? `${suggestion.targetValue.toLocaleString()} steps`
		: `${suggestion.targetValue} min`;
}

function timeAgo(iso: string | null | undefined): string {
	if (!iso) return "just now";
	const ms = Date.now() - new Date(iso).getTime();
	const mins = Math.floor(ms / 60000);
	if (mins < 1) return "just now";
	if (mins < 60) return `${mins}m ago`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

export default function RecoveryScreen() {
	const router = useRouter();

	const [plan, setPlan] = useState<DailyRecoveryPlan | null>(null);
	const [wallet, setWallet] = useState<GardenWallet | null>(null);
	const [garden, setGarden] = useState<GardenItem[]>([]);
	const [sessions, setSessions] = useState<RecoveryPlanSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [showShop, setShowShop] = useState(false);
	const [purchasingKey, setPurchasingKey] = useState<string | null>(null);
	const [activePlan, setActivePlan] = useState<RecoverySuggestion | null>(null);
	const [joiningChallenge, setJoiningChallenge] = useState(false);

	const [toast, setToast] = useState<string | null>(null);
	const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Garden drag-to-position — default height must match grass minHeight so
	// items placed near the bottom remain draggable even before onLayout fires.
	const gardenSizeRef = useRef({ width: 300, height: 220 });

	const showToast = useCallback((message: string) => {
		setToast(message);
		if (toastTimer.current) clearTimeout(toastTimer.current);
		toastTimer.current = setTimeout(() => setToast(null), 2400);
	}, []);

/** A single draggable garden item. Each item owns its own PanResponder. */
    const DraggableItem = useCallback(
        ({ item }: { item: GardenItem }) => {
            const startPosRef = useRef(item.position ?? { x: 50, y: 50 });
            const [currentPos, setCurrentPos] = useState(item.position ?? { x: 50, y: 50 });

            useEffect(() => {
                const newPos = item.position ?? { x: 50, y: 50 };
                setCurrentPos(newPos);
            }, [item.position?.x, item.position?.y]);

            const responder = useMemo(
                () =>
                    PanResponder.create({
                        onStartShouldSetPanResponder: () => true,
                        onMoveShouldSetPanResponder: () => true,
                        onStartShouldSetPanResponderCapture: () => true,
                        onMoveShouldSetPanResponderCapture: () => true,
                        onPanResponderTerminationRequest: () => false,
                        onShouldBlockNativeResponder: () => true,
                        onPanResponderGrant: () => {
                            startPosRef.current = item.position ?? { x: 50, y: 50 };
                        },
                        onPanResponderMove: (_evt, gesture) => {
                            // 获取容器实际宽高，若未加载完给个默认兜底高度防除以零
                            const width = gardenSizeRef.current.width || 300;
                            const height = gardenSizeRef.current.height || 220;
                            
                            const newX = startPosRef.current.x + (gesture.dx / width) * 100;
                            const newY = startPosRef.current.y + (gesture.dy / height) * 100;
                            
                            const cx = Math.max(0, Math.min(100, newX));
                            const cy = Math.max(0, Math.min(100, newY));
                            
                            setCurrentPos({ x: cx, y: cy });
                        },
                        onPanResponderRelease: (_evt, gesture) => {
                            const width = gardenSizeRef.current.width || 300;
                            const height = gardenSizeRef.current.height || 220;

                            const newX = startPosRef.current.x + (gesture.dx / width) * 100;
                            const newY = startPosRef.current.y + (gesture.dy / height) * 100;
                            const cx = Math.max(0, Math.min(100, newX));
                            const cy = Math.max(0, Math.min(100, newY));

                            const finalPos = { x: cx, y: cy };
                            setCurrentPos(finalPos);

                            setGarden((prev) =>
                                prev.map((g) => (g.id === item.id ? { ...g, position: finalPos } : g))
                            );
                            updateGardenItemPosition(item.id, finalPos);
                        },
                    }),
                [item.id, item.position, updateGardenItemPosition]
            );

            return (
                <View
                    {...responder.panHandlers}
                    style={[
                        styles.plant,
                        {
                            position: 'absolute',
                            left: `${currentPos.x}%`,
                            top: `${currentPos.y}%`,
                            transform: [{ translateX: -17 }, { translateY: -17 }],
                            zIndex: 99,
                        },
                    ]}
                >
                    <Emoji size={34}>{item.emoji}</Emoji>
                </View>
            );
        },
        [updateGardenItemPosition]
    );

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			await ensureStarterGardenItem();
			const [freshPlan, freshWallet, gardenItems, freshSessions] = await Promise.all([
				getDailyRecoveryPlan(),
				getGardenWallet(),
				getGardenItems(),
				getPlanSessions(),
			]);
			setPlan(freshPlan);
			setWallet(freshWallet);
			setGarden(gardenItems);
			setSessions(freshSessions);
		} catch (err) {
			setError(err instanceof Error ? err.message : "The garden could not be loaded.");
		} finally {
			setLoading(false);
		}
	}, []);

	useFocusEffect(
		useCallback(() => {
			load();
		}, [load])
	);

	const sessionFor = useCallback(
		(planKey: string) => sessions.find((session) => session.planKey === planKey) ?? null,
		[sessions]
	);

	const handleBuy = async (key: string, cost: number) => {
		const item = GARDEN_CATALOG.find((c) => c.key === key);
		if (!item || purchasingKey) return;
		if (!wallet || wallet.seeds < cost) {
			showToast("Not enough seeds yet. A quick pause will earn some.");
			return;
		}
		setPurchasingKey(key);
		try {
			await purchaseGardenItem(
				{ key: item.key, name: item.name, emoji: item.emoji, kind: item.kind },
				cost
			);
			const [freshWallet, gardenItems] = await Promise.all([getGardenWallet(), getGardenItems()]);
			setWallet(freshWallet);
			setGarden(gardenItems);
			showToast(`${item.emoji}  ${item.name} is growing in your garden.`);
		} catch (err) {
			showToast(err instanceof Error ? err.message : "The garden shop could not be reached.");
		} finally {
			setPurchasingKey(null);
		}
	};

	/** A plan really finished (tracked progress hit its target). Reload real state. */
	const handlePlanCompleted = useCallback(async () => {
		try {
			const [freshSessions, freshWallet] = await Promise.all([getPlanSessions(), getGardenWallet()]);
			setSessions(freshSessions);
			setWallet(freshWallet);
			showToast(`Thank you. +${PLAN_REWARD_SEEDS} seeds for the garden.`);
		} catch (err) {
			showToast(err instanceof Error ? err.message : "Could not refresh the garden just yet.");
		}
	}, [showToast]);

	/**
	 * A shared-challenge suggestion is one of today's three plans, not a timed
	 * pause. If it is already joined it is a fixed plan → open it in Social; if
	 * not, join it right here and the plan refreshes to show it as fixed.
	 */
	const handleChallengeAction = useCallback(
		async (suggestion: RecoverySuggestion) => {
			const id = suggestion.challengeId;
			if (!id) return;
			if (suggestion.challengeJoined) {
				router.push({ pathname: "/challenge", params: { id } });
				return;
			}
			setJoiningChallenge(true);
			try {
				await toggleChallenge(id);
				const [updatedPlan, freshWallet] = await Promise.all([
					setChallengeJoinedForToday(id, true),
					getGardenWallet(),
				]);
				setPlan(updatedPlan);
				setWallet(freshWallet);
				showToast("Joined. +5 seeds for your garden, and your circle is holding this time for you.");
			} catch (err) {
				showToast(err instanceof Error ? err.message : "Could not join that challenge just yet.");
			} finally {
				setJoiningChallenge(false);
			}
		},
		[router, showToast]
	);

	const doneToday = sessions.filter((session) => session.status === "completed").length;

	// A busy day can produce many small gaps. Summarise the total and show only
	// the top three remaining windows — never an endless chip list.
	const slotsToday = plan?.slots ?? [];
	const totalFreeMinutes = slotsToday.reduce((sum, slot) => sum + slot.minutes, 0);
	const topSlots = slotsToday.slice(0, 3);
	const overflowSlots = Math.max(0, slotsToday.length - topSlots.length);

	return (
		<Screen
			scroll={false}
			padded={false}
			header={<TopNavigation onNotificationPress={() => {}} />}
			footer={<BottomNavigation activeTab="Recovery" router={router} />}
		>
			{loading ? (
				<View style={styles.center}>
					<ActivityIndicator color={colors.brown} />
					<Txt v="small" color={colors.inkFaint} center style={{ marginTop: spacing(2) }}>
						Tending the garden…
					</Txt>
				</View>
			) : error ? (
				<View style={styles.center}>
					<Emoji size={40}>🌧️</Emoji>
					<Txt center style={styles.gentleLine}>
						{error}
					</Txt>
					<Pressable onPress={load} style={styles.retryButton}>
						<Txt v="heading" color={colors.brown}>
							Try again
						</Txt>
					</Pressable>
				</View>
			) : (
				<ScrollView
					showsVerticalScrollIndicator={false}
					contentContainerStyle={styles.scrollContent}
				>
					{/* GARDEN SCENE */}
					<Card style={styles.gardenCard}>
						<View style={styles.sky}>
							<Emoji size={30} style={styles.sun}>🌤️</Emoji>
							<Row style={styles.walletPill}>
								<Emoji size={16}>🌱</Emoji>
								<Txt v="small" color={colors.brown} style={{ fontWeight: '700' }}>
									{wallet?.seeds ?? 0} seeds
								</Txt>
							</Row>
						</View>

						<View
							style={styles.grass}
							onLayout={(e) => {
								const { width, height } = e.nativeEvent.layout;
								if (width > 0 && height > 0) {
									gardenSizeRef.current = { width, height };
								}
							}}
						>
							{garden.length === 0 ? (
								<View style={styles.emptyGarden}>
									<Emoji size={46}>🌱</Emoji>
									<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>
										Your garden is waiting for its first sprout. Do a small recovery
										activity below and watch it grow.
									</Txt>
								</View>
							) : (
								<View style={styles.gardenBed}>
									{garden.map((item) => (
										<DraggableItem key={item.id} item={item} />
									))}
								</View>
							)}
						</View>

						{/* ROUND SHOP BUTTON — the shop lives in a sheet, not on the page */}
						<Pressable
							accessibilityLabel="Open the garden shop"
							onPress={() => setShowShop(true)}
							style={({ pressed }) => [styles.shopFab, pressed && styles.pressed]}
						>
							<Emoji size={22}>🛒</Emoji>
						</Pressable>
					</Card>

					{/* TODAY'S PLAN */}
					<Card>
						<Row>
							<Badge label="Today's Recovery Plan" fg={colors.calm} bg={colors.calmWash} />
							{doneToday > 0 && (
								<Txt v="small" color={colors.inkFaint} style={{ marginLeft: spacing(2) }}>
									{doneToday} small pause{doneToday === 1 ? '' : 's'} today
								</Txt>
							)}
						</Row>

						<Txt
							center
							v="body"
							color={colors.inkSoft}
							style={[styles.gentleLine, { marginTop: spacing(3), lineHeight: 20, fontSize: 12 }]}
						>
							{plan?.note ?? 'Here are ideas, never obligations.'} Finish a plan to earn 10 seeds!
						</Txt>

						<View style={styles.slots}>
							{plan && slotsToday.length === 0 ? (
								<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>
									No open time left today. A five-minute pause can still fit between the seams.
								</Txt>
							) : (
								<>
									<View style={styles.slotSummary}>
										<Emoji size={14}>⏳</Emoji>
										<Txt v="small" color={colors.inkSoft}>
											{slotsToday.length} free window{slotsToday.length === 1 ? '' : 's'} ·{' '}
											{formatMin(totalFreeMinutes)} today
										</Txt>
									</View>
									<View style={styles.slotChips}>
										{topSlots.map((slot, index) => (
											<View key={`${slot.start}-${index}`} style={styles.slotChip}>
												<Txt v="small" color={colors.inkSoft}>
													{slot.start}–{slot.end} · {slot.minutes} min
												</Txt>
											</View>
										))}
										{overflowSlots > 0 && (
											<View style={[styles.slotChip, styles.slotMoreChip]}>
												<Txt v="small" color={colors.inkFaint}>
													+{overflowSlots} more
												</Txt>
											</View>
										)}
									</View>
								</>
							)}
						</View>

						<View style={{ marginTop: spacing(4), gap: spacing(3) }}>
							{(plan?.suggestions ?? []).map((suggestion) => {
								/* A shared challenge is a fixed plan — no timer, join it or open it in Social. */
								if (suggestion.challengeId) {
									return (
										<View
											key={suggestion.id}
											style={[styles.suggestionCard, styles.challengeSuggestionCard]}
										>
											<View style={[styles.suggestionEmoji, styles.challengeSuggestionEmoji]}>
												<Emoji size={26}>{suggestion.emoji}</Emoji>
											</View>
											<View style={styles.suggestionBody}>
												<Txt v="heading" color={colors.ink} style={{ flex: 1 }} numberOfLines={1}>
													{suggestion.title}
												</Txt>
												<Txt
													v="small"
													color={colors.inkSoft}
													numberOfLines={1}
													style={{ marginTop: spacing(1) }}
												>
													{suggestion.challengeJoined ? 'Fixed plan · ' : 'Shared challenge · '}
													{suggestion.challengeScheduledFor
														? formatSchedule(suggestion.challengeScheduledFor)
														: formatMin(suggestion.minutes)}
												</Txt>
											</View>
											<Pressable
												accessibilityLabel={
													suggestion.challengeJoined ? "Open the challenge" : "Join this challenge"
												}
												onPress={() => handleChallengeAction(suggestion)}
												disabled={joiningChallenge}
												style={({ pressed }) => [
													styles.challengeJoinButton,
													suggestion.challengeJoined && styles.challengeJoinedButton,
													pressed && styles.pressed,
												]}
											>
												{joiningChallenge ? (
													<ActivityIndicator size="small" color={colors.cream} />
												) : (
													<Txt v="small" color={colors.cream} style={{ fontWeight: '700' }}>
														{suggestion.challengeJoined ? 'Open ›' : '+ Join'}
													</Txt>
												)}
											</Pressable>
										</View>
									);
								}

								const session = sessionFor(suggestion.id);
								const done = session?.status === "completed";
								const started = session?.status === "started";
								return (
									<Pressable
										key={suggestion.id}
										onPress={() => setActivePlan(suggestion)}
										style={({ pressed }) => [
											styles.suggestionCard,
											done && styles.suggestionDone,
											pressed && styles.pressed,
										]}
									>
										<View style={[styles.suggestionEmoji, done && styles.suggestionDoneEmoji]}>
											<Emoji size={26}>{done ? '🌿' : suggestion.emoji}</Emoji>
										</View>
										<View style={styles.suggestionBody}>
											<Txt
												v="heading"
												color={done ? colors.inkFaint : colors.ink}
												style={{ flex: 1 }}
												numberOfLines={1}
											>
												{suggestion.title}
											</Txt>
											<Txt
												v="small"
												color={colors.inkSoft}
												numberOfLines={1}
												style={{ marginTop: spacing(1) }}
											>
												{formatTarget(suggestion)} · {formatMin(suggestion.minutes)}
												{suggestion.slot ? ` · ${suggestion.slot.start}` : ''}
											</Txt>
										</View>
										<View
											style={[
												styles.statusChip,
												done && styles.statusChipDone,
												started && styles.statusChipStarted,
											]}
										>
											<Txt
												v="small"
												style={{ fontWeight: '700', color: done ? colors.calm : started ? colors.warn : colors.inkFaint }}
											>
												{done ? 'Done' : started ? 'In progress' : '›'}
											</Txt>
										</View>
									</Pressable>
								);
							})}
						</View>
					</Card>

					{/* QUICK DE-STRESS */}
					<Card style={{ padding: spacing(4), marginTop: 20 }}>
						<Row style={{ marginBottom: spacing(3) }}>
							<Badge label="Quick de-stress" fg={colors.alert} bg={colors.alertWash} />
						</Row>

						<Pressable
							onPress={() => router.push('/bubblepop' as never)}
							style={({ pressed }) => [styles.destressCard, pressed && styles.highlightedDestressCard]}
						>
							<View style={styles.destressImage}>
								<View style={styles.bubbleBackground}>
									<Emoji size={34}>🧼</Emoji>
								</View>
							</View>

							<View style={styles.destressInfo}>
								<Txt v="heading" color={colors.ink} style={styles.destressTitle}>
									Bubble Pop
								</Txt>
								<Txt v="small" color={colors.inkSoft} style={styles.destressSubtitle}>
									Tactile stress relief
								</Txt>
							</View>

							<View style={styles.playButton}>
								<Txt v="small" color={colors.cream} style={styles.playButtonText}>
									Play ▸
								</Txt>
							</View>
						</Pressable>
					</Card>

					<View style={{ height: spacing(4) }} />
				</ScrollView>
			)}

			{/* PLAN DETAIL + TRACKING */}
			{activePlan && (
				<PlanDetailModal
					suggestion={activePlan}
					session={sessionFor(activePlan.id)}
					onClose={() => setActivePlan(null)}
					onPlanChanged={handlePlanCompleted}
				/>
			)}

			{/* SHOP SHEET */}
			<ShopModal
				visible={showShop}
				wallet={wallet}
				garden={garden}
				purchasingKey={purchasingKey}
				onClose={() => setShowShop(false)}
				onBuy={handleBuy}
			/>

			{toast && (
				<View style={styles.toast}>
					<Txt v="small" color={colors.brown} center style={{ fontWeight: '700' }}>
						{toast}
					</Txt>
				</View>
			)}
		</Screen>
	);
}

/* ── Plan detail + real tracking ─────────────────────────────────── */

function PlanDetailModal({
	suggestion,
	session,
	onClose,
	onPlanChanged,
}: {
	suggestion: RecoverySuggestion;
	session: RecoveryPlanSession | null;
	onClose: () => void;
	onPlanChanged: () => Promise<void> | void;
}) {
	const completed = session?.status === "completed";

	return (
		<Modal visible transparent animationType="fade" onRequestClose={onClose}>
			<Pressable style={styles.sheetBackdrop} onPress={onClose}>
				<Pressable
					style={styles.sheet}
					onPress={(event) => event.stopPropagation()}
				>
					<ScrollView
						showsVerticalScrollIndicator={false}
						contentContainerStyle={styles.sheetScrollContent}
					>
						<Row style={styles.sheetHeader}>
							<View style={styles.sheetEmoji}>
								<Emoji size={34}>{(suggestion as RecoverySuggestion).emoji}</Emoji>
							</View>
							<View style={{ flex: 1, minWidth: 0 }}>
								<Txt v="title" color={colors.ink} numberOfLines={2}>
									{suggestion.title}
								</Txt>
							</View>
							<Pressable
								accessibilityLabel="Close plan"
								onPress={onClose}
								style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
							>
								<Txt v="heading" color={colors.inkFaint}>✕</Txt>
							</Pressable>
						</Row>

						{suggestion.detail ? (
							<Txt v="body" color={colors.ink} style={[styles.gentleLine, { marginTop: spacing(3) }]}>
								{suggestion.detail}
							</Txt>
						) : null}

						<Row gap={2} style={[styles.miniChips, { marginTop: spacing(2) }]}>
							<View style={styles.miniChip}>
								<Txt v="small" color={colors.inkSoft}>
									🎯 {formatTarget(suggestion)}
								</Txt>
							</View>
							<View style={styles.miniChip}>
								<Txt v="small" color={colors.inkSoft}>
									🕒 {formatMin(suggestion.minutes)}
								</Txt>
							</View>
							{suggestion.slot ? (
								<View style={styles.miniChip}>
									<Txt v="small" color={colors.calm}>
										⏳ {suggestion.slot.start}
									</Txt>
								</View>
							) : null}
						</Row>

						{suggestion.reason ? (
							<Txt v="small" color={colors.inkFaint} style={{ marginTop: spacing(2), lineHeight: 17 }}>
								{suggestion.reason}
							</Txt>
						) : null}

						{completed ? (
							<CompletedPlanCard suggestion={suggestion} session={session} onClose={onClose} />
						) : suggestion.targetType === "steps" ? (
							<StepTracker suggestion={suggestion} session={session} onCompleted={onPlanChanged} />
						) : (
							<MinuteTracker suggestion={suggestion} session={session} onCompleted={onPlanChanged} />
						)}
					</ScrollView>
				</Pressable>
			</Pressable>
		</Modal>
	);
}

/** Shown once tracked progress really reached the plan's target. */
function CompletedPlanCard({
	suggestion,
	session,
	onClose,
}: {
	suggestion: RecoverySuggestion;
	session: RecoveryPlanSession | null;
	onClose: () => void;
}) {
	return (
		<View style={styles.completedCard}>
			<Emoji size={40}>🌿</Emoji>
			<Txt v="heading" color={colors.calm} center>
				Done — really done.
			</Txt>
			<Txt v="small" color={colors.inkSoft} center style={[styles.gentleLine, { marginTop: spacing(1) }]}>
				That {formatTarget(suggestion)} is behind you{session?.completedAt ? ` at ${new Date(session.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}.
				+{PLAN_REWARD_SEEDS} seeds grew in for the garden.
			</Txt>
			<Pressable
				onPress={onClose}
				style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
			>
				<Txt v="heading" color={colors.cream} style={{ fontWeight: '700' }}>
					Back to the garden
				</Txt>
			</Pressable>
		</View>
	);
}

/** Live step tracking via the pedometer. Seeds only land when the target is met. */
function StepTracker({
	suggestion,
	session,
	onCompleted,
}: {
	suggestion: RecoverySuggestion;
	session: RecoveryPlanSession | null;
	onCompleted: () => Promise<void> | void;
}) {
	const [available, setAvailable] = useState<boolean | null>(null);
	const [started, setStarted] = useState(session?.status === "started");
	const [steps, setSteps] = useState(session?.progressValue ?? 0);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const sessionRef = useRef(session);
	sessionRef.current = session;
	const watchRef = useRef<ReturnType<typeof watchStepsFromNow> | null>(null);
	const finishedRef = useRef(false);
	const onCompletedRef = useRef(onCompleted);
	onCompletedRef.current = onCompleted;

	const stopWatch = useCallback(() => {
		watchRef.current?.stop();
		watchRef.current = null;
	}, []);

	const finish = useCallback(
		async (finalSteps: number) => {
			if (finishedRef.current) return;
			finishedRef.current = true;
			stopWatch();
			try {
				if (sessionRef.current) await updatePlanProgress(suggestion.id, finalSteps);
				await completePlanSession(suggestion.id);
			} catch (err) {
				finishedRef.current = false;
				setError(err instanceof Error ? err.message : "Could not save your walk just yet.");
				return;
			}
			await onCompletedRef.current();
		},
		[suggestion.id, stopWatch]
	);

	useEffect(() => {
		let mounted = true;
		isStepTrackingAvailable().then((ok) => {
			if (mounted) setAvailable(ok);
		});
		return () => {
			mounted = false;
			stopWatch();
		};
	}, [stopWatch]);

	useEffect(() => {
		if (!started || available !== true) return;
		let stopped = false;
		watchRef.current = watchStepsFromNow((count) => {
			if (stopped) return;
			setSteps(count);
			if (count >= suggestion.targetValue) void finish(count);
		});
		return () => {
			stopped = true;
		};
	}, [started, available, suggestion.targetValue, finish]);

	const start = async () => {
		setStarting(true);
		setError(null);
		try {
			const ok = await isStepTrackingAvailable();
			if (!ok) {
				setError("This device can't count steps right now. A timed pause works too.");
				return;
			}
			const granted = await ensureStepPermission();
			if (!granted) {
				setError("Step access is off. You can still do a timed pause instead.");
				return;
			}
			await startPlanSession(suggestion);
			setSteps(0);
			setStarted(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start the plan.");
		} finally {
			setStarting(false);
		}
	};

	const progressPct = Math.min(100, Math.round((steps / suggestion.targetValue) * 100));
	const reached = steps >= suggestion.targetValue;

	return (
		<View style={styles.trackerCard}>
			{!started ? (
				<>
					<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>
						This plan finishes when your steps really reach the target.
					</Txt>
					<Pressable
						onPress={start}
						disabled={starting}
						style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
					>
						{starting ? (
							<ActivityIndicator size="small" color={colors.cream} />
						) : (
							<Txt v="heading" color={colors.cream} style={{ fontWeight: '700' }}>
								Start walking
							</Txt>
						)}
					</Pressable>
				</>
			) : (
				<>
					<Row style={{ justifyContent: 'space-between' }}>
						<Txt v="small" color={colors.inkFaint}>Walking…</Txt>
						<Txt v="small" color={colors.brown} style={{ fontWeight: '700' }}>
							{steps.toLocaleString()} / {suggestion.targetValue.toLocaleString()} steps
						</Txt>
					</Row>
					<View style={styles.progressTrack}>
						<View style={[styles.progressFill, { width: `${progressPct}%` }]} />
					</View>
					<Txt v="small" color={colors.inkSoft} center style={{ marginTop: spacing(2) }}>
						{reached
							? 'There you are. Saving your walk…'
							: `${(suggestion.targetValue - steps).toLocaleString()} steps to go. No rush.`}
					</Txt>
				</>
			)}

			{error ? (
				<Txt v="small" color={colors.alert} center style={{ marginTop: spacing(2), lineHeight: 17 }}>
					{error}
				</Txt>
			) : null}
		</View>
	);
}

/** Timing for a minutes plan, tracked from the real clock. */
function MinuteTracker({
	suggestion,
	session,
	onCompleted,
}: {
	suggestion: RecoverySuggestion;
	session: RecoveryPlanSession | null;
	onCompleted: () => Promise<void> | void;
}) {
	const [running, setRunning] = useState(session?.status === "started");
	const startedAtMs = session?.status === "started" ? new Date(session.startedAt).getTime() : null;
	const baseProgress = session?.status === "started" ? (session.progressValue ?? 0) : 0;
	const [nowTick, setNowTick] = useState(Date.now());
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [justFinished, setJustFinished] = useState(false);

	const lastSavedRef = useRef(0);
	const finishedRef = useRef(false);
	const onCompletedRef = useRef(onCompleted);
	onCompletedRef.current = onCompleted;

	const elapsed = useMemo(() => {
		if (!running || startedAtMs === null) return 0;
		const wall = Math.floor((nowTick - startedAtMs) / 60000);
		return Math.min(suggestion.targetValue, Math.max(baseProgress, wall));
	}, [running, startedAtMs, baseProgress, nowTick, suggestion.targetValue]);

	useEffect(() => {
		if (!running) return;
		const id = setInterval(() => setNowTick(Date.now()), 1000);
		return () => clearInterval(id);
	}, [running]);

	const persist = useCallback(
		async (minutes: number) => {
			const now = Math.floor(Date.now() / 1000);
			if (now - lastSavedRef.current < 8 && minutes < suggestion.targetValue) return;
			lastSavedRef.current = now;
			await updatePlanProgress(suggestion.id, minutes);
		},
		[suggestion.id, suggestion.targetValue]
	);

	useEffect(() => {
		if (!running || startedAtMs === null) return;
		const minutes = elapsed;
		if (minutes >= suggestion.targetValue) {
			if (finishedRef.current) return;
			finishedRef.current = true;
			setJustFinished(true);
			void (async () => {
				try {
					await updatePlanProgress(suggestion.id, minutes);
					await completePlanSession(suggestion.id);
					await onCompletedRef.current();
				} catch (err) {
					finishedRef.current = false;
					setError(err instanceof Error ? err.message : "Could not save this pause just yet.");
				}
			})();
			return;
		}
		void persist(minutes);
	}, [elapsed, running, startedAtMs, suggestion.id, suggestion.targetValue, persist]);

	const start = async () => {
		setStarting(true);
		setError(null);
		try {
			await startPlanSession(suggestion);
			setRunning(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not start the plan.");
		} finally {
			setStarting(false);
		}
	};

	const progressPct = Math.min(100, Math.round((elapsed / suggestion.targetValue) * 100));

	return (
		<View style={styles.trackerCard}>
			{!running ? (
				<>
					<Txt v="small" color={colors.inkSoft} center style={styles.gentleLine}>
						This plan finishes when the clock really passes {suggestion.targetValue} minute
						{suggestion.targetValue === 1 ? '' : 's'}.
					</Txt>
					<Pressable
						onPress={start}
						disabled={starting}
						style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
					>
						{starting ? (
							<ActivityIndicator size="small" color={colors.cream} />
						) : (
							<Txt v="heading" color={colors.cream} style={{ fontWeight: '700' }}>
								Start the pause
							</Txt>
						)}
					</Pressable>
				</>
			) : (
				<>
					<Row style={{ justifyContent: 'space-between' }}>
						<Txt v="small" color={colors.inkFaint}>A gentle wait…</Txt>
						<Txt v="small" color={colors.brown} style={{ fontWeight: '700' }}>
							{elapsed} / {suggestion.targetValue} min
						</Txt>
					</Row>
					<View style={styles.progressTrack}>
						<View style={[styles.progressFill, { width: `${progressPct}%` }]} />
					</View>
					<Txt v="small" color={colors.inkSoft} center style={{ marginTop: spacing(2) }}>
						{justFinished || elapsed >= suggestion.targetValue
							? 'Time well spent. Saving your pause…'
							: `${suggestion.targetValue - elapsed} more minute${suggestion.targetValue - elapsed === 1 ? '' : 's'}. No rush.`}
					</Txt>
				</>
			)}

			{error ? (
				<Txt v="small" color={colors.alert} center style={{ marginTop: spacing(2), lineHeight: 17 }}>
					{error}
				</Txt>
			) : null}
		</View>
	);
}

/* ── Shop sheet ──────────────────────────────────────────────────── */

function ShopModal({
	visible,
	wallet,
	garden,
	purchasingKey,
	onClose,
	onBuy,
}: {
	visible: boolean;
	wallet: GardenWallet | null;
	garden: GardenItem[];
	purchasingKey: string | null;
	onClose: () => void;
	onBuy: (key: string, cost: number) => void;
}) {
	const history = useMemo(
		() =>
			[...garden].sort((a, b) =>
				(new Date(b.placedAt ?? 0).getTime() || 0) - (new Date(a.placedAt ?? 0).getTime() || 0)
			),
		[garden]
	);

	return (
		<Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
		<View style={styles.sheetBackdrop}>
			<Pressable
				style={StyleSheet.absoluteFill}
				onPress={onClose}
			/>

			<View
				style={[styles.sheet, styles.sheetTall]}
				onStartShouldSetResponder={() => false}
				onMoveShouldSetResponder={() => false}
		>

					<Row style={[styles.sheetHeader, { justifyContent: 'space-between', width: '100%' }]}>
						<Badge label="Shop" fg={colors.warn} bg={colors.warnWash} />
						<Row style={styles.walletPill}>
							<Emoji size={16}>🌱</Emoji>
							<Txt v="small" color={colors.brown} style={{ fontWeight: '700' }}>
								{wallet?.seeds ?? 0} seeds
							</Txt>
						</Row>
						<Pressable
							accessibilityLabel="Close shop"
							onPress={onClose}
							style={({ pressed }) => [styles.sheetClose, pressed && styles.pressed]}
						>
							<Txt v="heading" color={colors.inkFaint}>✕</Txt>
						</Pressable>
					</Row>

					<Txt v="small" center color={colors.inkFaint} style={{ marginTop: spacing(1)}}>
						Spend seeds to grow your space
					</Txt>

					<ScrollView
						style={{ flex: 1, marginTop: spacing(3) }}
						contentContainerStyle={{ paddingBottom: spacing(10) }}
						showsVerticalScrollIndicator={true}
						nestedScrollEnabled={true}
					>
						<View style={styles.shopGrid}>
							{GARDEN_CATALOG.filter((item) => item.key !== 'starter').map((item) => {
								const affordable = (wallet?.seeds ?? 0) >= item.seeds;
								const owned = garden.some((g) => g.itemKey === item.key);
								return (
									<View
										key={item.key}
										style={[styles.shopItem, !affordable && styles.shopItemFaded]}
									>
										<Emoji size={30}>{item.emoji}</Emoji>
										<Txt
											v="small"
											color={colors.ink}
											center
											style={{ marginTop: spacing(1) }}
											numberOfLines={1}
										>
											{item.name}
										</Txt>
										<Pressable
											onPress={() => onBuy(item.key, item.seeds)}
											disabled={!affordable || owned || purchasingKey === item.key}
											style={({ pressed }) => [
												styles.buyButton,
												!affordable && styles.buyButtonDisabled,
												owned && styles.buyButtonOwned,
												pressed && affordable && !owned && styles.pressed,
											]}
										>
											{owned ? (
												<Txt v="small" color={colors.calm} style={{ fontWeight: '700' }}>
													Growing
												</Txt>
											) : purchasingKey === item.key ? (
												<ActivityIndicator size="small" color={colors.brown} />
											) : (
												<Txt
													v="small"
													color={affordable ? colors.brown : colors.inkFaint}
													style={{ fontWeight: '700' }}
												>
													🌱 {item.seeds}
												</Txt>
											)}
										</Pressable>
									</View>
								);
							})}
						</View>

						{/* PURCHASE HISTORY — every owned item, newest first */}
						<View style={styles.historySection}>
							<Txt v="eyebrow" color={colors.inkFaint} style={styles.historyHeader}>
								In your garden
							</Txt>
							{history.length === 0 ? (
								<Txt v="small" color={colors.inkSoft} style={styles.gentleLine}>
									Nothing planted yet. Seeds come from gentle pauses, never from stress.
								</Txt>
							) : (
								history.slice(0, 8).map((item) => (
									<Row key={item.id} style={styles.historyRow}>
										<Emoji size={18}>{item.emoji}</Emoji>
										<Txt v="small" color={colors.ink} style={{ flex: 1 }}>
											{item.name}
										</Txt>
										<Txt v="small" color={colors.inkFaint}>
											{timeAgo(item.placedAt)}
										</Txt>
									</Row>
								))
							)}
						</View>
					</ScrollView>
				</View>
			</View>
		</Modal>
	);
}

const styles = StyleSheet.create({
	scrollContent: { padding: spacing(5), paddingBottom: spacing(10) },
	center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing(6), gap: spacing(2) },

	cardTitle: { fontSize: 18, fontWeight: '700', color: colors.ink},
	gardenCard: { padding: 0, overflow: 'hidden', marginBottom: spacing(4) },
	sky: {
		backgroundColor: '#FDF3C8',
		height: 84,
		flexDirection: 'row',
		justifyContent: 'flex-end',
		alignItems: 'flex-start',
		paddingHorizontal: spacing(4),
		paddingTop: spacing(3),
	},
	sun: { position: 'absolute', top: spacing(3), left: spacing(4) },
	walletPill: {
		backgroundColor: colors.yellow,
		paddingHorizontal: spacing(2.5),
		paddingVertical: spacing(1),
		borderRadius: radius.pill,
	},
	grass: {
		backgroundColor: colors.calmWash,
		padding: spacing(4),
		borderTopWidth: 1,
		borderTopColor: colors.line,
		minHeight: 220,
	},
	gardenBed: { position: 'relative' },
	plant: {
		/* No background — the emoji floats freely in the garden for drag-to-decorate. */
		padding: spacing(0.5),
	},
	gardenBase: { flexDirection: 'row', gap: spacing(2), opacity: 0.7 },
	emptyGarden: { alignItems: 'center', gap: spacing(2), paddingVertical: spacing(3) },

	shopFab: {
		position: 'absolute',
		right: spacing(4),
		bottom: spacing(4),
		width: 56,
		height: 56,
		borderRadius: 28,
		backgroundColor: colors.yellow,
		borderWidth: 2,
		borderColor: colors.yellowDeep,
		alignItems: 'center',
		justifyContent: 'center',
		shadowColor: colors.brown,
		shadowOpacity: 0.16,
		shadowRadius: 8,
		shadowOffset: { width: 0, height: 4 },
		elevation: 4,
	},

	gentleLine: { lineHeight: 20 },
	slots: { marginTop: spacing(3) },
	slotSummary: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing(1.5),
		marginBottom: spacing(2),
	},
	slotChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
	slotChip: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: colors.yellowWash,
		paddingHorizontal: spacing(2.5),
		paddingVertical: spacing(1.5),
		borderRadius: radius.pill,
		borderWidth: 1,
		borderColor: colors.yellowDeep,
	},
	slotMoreChip: {
		backgroundColor: colors.surface,
		borderColor: colors.line,
		opacity: 0.85,
	},
	miniChip: {
		backgroundColor: colors.cream,
		paddingHorizontal: spacing(2.5),
		paddingVertical: spacing(1),
		borderRadius: radius.pill,
		borderWidth: 1,
		borderColor: colors.line,
	},
	miniChips: { flexDirection: 'row', flexWrap: 'wrap' },

	suggestionCard: {
		flexDirection: 'row',
		alignItems: 'center',
		backgroundColor: colors.surface,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.line,
		padding: spacing(3),
		gap: spacing(3),
	},
	suggestionDone: { opacity: 0.72, backgroundColor: '#FAFAF5' },
	suggestionEmoji: {
		width: 46,
		height: 46,
		borderRadius: radius.md,
		backgroundColor: colors.cream,
		alignItems: 'center',
		justifyContent: 'center',
	},
	suggestionDoneEmoji: { backgroundColor: colors.calmWash },
	suggestionBody: { flex: 1, minWidth: 0 },
	statusChip: {
		borderRadius: radius.pill,
		backgroundColor: colors.cream,
		borderWidth: 1,
		borderColor: colors.line,
		paddingHorizontal: spacing(2.5),
		paddingVertical: spacing(1),
	},
	statusChipDone: { backgroundColor: colors.calmWash, borderColor: colors.calm },
	statusChipStarted: { backgroundColor: colors.warnWash, borderColor: colors.warn },

	/* Shared-challenge suggestion — one of today's three fixed plans */
	challengeSuggestionCard: {
		borderColor: colors.yellowDeep,
		backgroundColor: colors.yellowWash,
	},
	challengeSuggestionEmoji: {
		backgroundColor: colors.yellowWash,
		borderWidth: 1,
		borderColor: colors.yellowDeep,
	},
	challengeJoinButton: {
		backgroundColor: colors.brown,
		borderRadius: radius.pill,
		paddingHorizontal: spacing(4),
		paddingVertical: spacing(2),
		alignItems: 'center',
		justifyContent: 'center',
	},
	challengeJoinedButton: { backgroundColor: colors.calm },

	/* Quick de-stress card */
	destressCard: {
		flexDirection: 'row',
		alignItems: 'center',
		gap: spacing(3),
		backgroundColor: colors.cream,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.line,
		padding: spacing(3),
	},
	highlightedDestressCard: {
		backgroundColor: colors.yellowWash,
		borderColor: colors.yellowDeep,
	},
	destressImage: {
		width: 52,
		height: 52,
		alignItems: 'center',
		justifyContent: 'center',
	},
	bubbleBackground: {
		width: 48,
		height: 48,
		borderRadius: 24,
		backgroundColor: '#CAE5FA',
		borderWidth: 1.5,
		borderColor: '#A2CEF2',
		alignItems: 'center',
		justifyContent: 'center',
	},
	destressInfo: { flex: 1, minWidth: 0 },
	destressTitle: {},
	destressSubtitle: { marginTop: spacing(0.5) },
	playButton: {
		backgroundColor: colors.brown,
		borderRadius: radius.pill,
		paddingHorizontal: spacing(4),
		paddingVertical: spacing(2),
		alignItems: 'center',
	},
	playButtonText: { fontWeight: '700' },

	/* Sheets / modals — centered on screen with internal scroll for long content */
	sheetBackdrop: {
		flex: 1,
		backgroundColor: 'rgba(34,32,28,0.22)',
		justifyContent: 'center',
		alignItems: 'center',
	},
	sheet: {
		backgroundColor: colors.cream,
		borderRadius: radius.lg,
		padding: spacing(5),
		maxWidth: '92%',
		width: 420,
		maxHeight: '80%',
	},
	sheetTall: { height: '80%', width: '92%' },
	sheetHandle: {
		/* No handle needed for centered sheet */
		display: 'none',
	},
	sheetScrollContent: { paddingBottom: spacing(6) },
	sheetHeader: { alignItems: 'center', gap: spacing(3) },
	sheetEmoji: {
		width: 58,
		height: 58,
		borderRadius: radius.lg,
		backgroundColor: colors.yellowWash,
		borderWidth: 1,
		borderColor: colors.yellowDeep,
		alignItems: 'center',
		justifyContent: 'center',
	},
	sheetClose: {
		width: 36,
		height: 36,
		borderRadius: 18,
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.line,
		alignItems: 'center',
		justifyContent: 'center',
	},

	completedCard: {
		marginTop: spacing(4),
		alignItems: 'center',
		gap: spacing(1),
		backgroundColor: colors.calmWash,
		borderRadius: radius.xl,
		borderWidth: 1,
		borderColor: colors.calm,
		padding: spacing(5),
	},
	primaryButton: {
		marginTop: spacing(3),
		alignSelf: 'center',
		backgroundColor: colors.brown,
		borderRadius: radius.pill,
		paddingHorizontal: spacing(6),
		paddingVertical: spacing(3),
		alignItems: 'center',
	},
	trackerCard: {
		marginTop: spacing(4),
		backgroundColor: colors.surface,
		borderRadius: radius.lg,
		borderWidth: 1,
		borderColor: colors.line,
		padding: spacing(4),
		gap: spacing(2),
	},
	progressTrack: {
		height: 10,
		marginTop: spacing(2),
		borderRadius: 8,
		backgroundColor: colors.line,
		overflow: 'hidden',
	},
	progressFill: {
		height: '100%',
		borderRadius: 8,
		backgroundColor: colors.calm,
	},

	shopGrid: {
		marginTop: spacing(4),
		flexDirection: 'row',
		flexWrap: 'wrap',
		gap: spacing(2),
	},
	shopItem: {
		flexBasis: '30%',
		flexGrow: 1,
		alignItems: 'center',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.line,
		borderRadius: radius.lg,
		padding: spacing(2.5),
	},
	shopItemFaded: { backgroundColor: '#FBF9F3' },
	buyButton: {
		marginTop: spacing(2),
		alignSelf: 'stretch',
		alignItems: 'center',
		paddingVertical: spacing(1.5),
		borderRadius: radius.md,
		backgroundColor: colors.yellow,
	},
	buyButtonDisabled: { backgroundColor: colors.line },
	buyButtonOwned: { backgroundColor: colors.calmWash },

	historySection: {
		marginTop: spacing(6),
		borderTopWidth: 1,
		borderTopColor: colors.line,
		paddingTop: spacing(4),
		gap: spacing(2),
	},
	historyHeader: { marginBottom: spacing(1) },
	historyRow: {
		alignItems: 'center',
		gap: spacing(2),
		backgroundColor: colors.surface,
		borderRadius: radius.md,
		borderWidth: 1,
		borderColor: colors.line,
		paddingHorizontal: spacing(3),
		paddingVertical: spacing(2),
	},

retryButton: {
		marginTop: spacing(2),
		paddingHorizontal: spacing(5),
		paddingVertical: spacing(2.5),
		borderRadius: radius.md,
		backgroundColor: colors.yellow,
	},

	pressed: { opacity: 0.7 },

	toast: {
		position: 'absolute',
		top: spacing(8),
		alignSelf: 'center',
		backgroundColor: colors.surface,
		borderWidth: 1,
		borderColor: colors.yellowDeep,
		paddingHorizontal: spacing(5),
		paddingVertical: spacing(2.5),
		borderRadius: radius.pill,
		shadowColor: '#000',
		shadowOpacity: 0.08,
		shadowRadius: 12,
		shadowOffset: { width: 0, height: 4 },
		elevation: 4,
		zIndex: 10,
	},
});
