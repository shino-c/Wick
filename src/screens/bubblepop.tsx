import { setAudioModeAsync, useAudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Animated,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { NavBar, Screen } from "../components/base";
import { earnSeeds } from "../services/repository";

const BUBBLE_COUNT = 25;
/** Every completed 30 seconds of play adds 5 seeds to the garden. */
const SEED_REWARD_SECONDS = 30;
const SEED_REWARD_AMOUNT = 5;

/**
 * Bubbles pop once every ~700ms at most; a slightly higher cap keeps up with
 * a fast thumb without stacking so many voices that it turns into a drone.
 */
const MAX_CONCURRENT_POPS = 6;
const POP_REPLAY_GAP_MS = 70;

/**
 * The pop sound. Drop the file at `assets/bubble-pop.wav` — it is required
 * lazily and inside a try/catch so the screen still runs before it exists.
 */
function loadBubblePopSource() {
	try {
		return require("../../assets/sounds/bubble-pop.wav");
	} catch {
		return null;
	}
}

/**
 * A tiny fixed pool of preloaded players. `useAudioPlayer` creates exactly one
 * voice, so a second tap would restart the first and the board would sound
 * glitchy under a fast thumb. Each `play(voice)` on the return value is fired
 * on the native side, so taps never wait on the UI thread.
 */
function useAudioPlayers(source: number | null) {
	const p0 = useAudioPlayer(source ?? undefined);
	const p1 = useAudioPlayer(source ?? undefined);
	const p2 = useAudioPlayer(source ?? undefined);
	const p3 = useAudioPlayer(source ?? undefined);
	const p4 = useAudioPlayer(source ?? undefined);
	const p5 = useAudioPlayer(source ?? undefined);

	return useMemo(
		() => ({
			seekTo: (voice: number, seconds: number) =>
				[p0, p1, p2, p3, p4, p5][voice]?.seekTo(seconds),
			play: (voice: number) => {
				const player = [p0, p1, p2, p3, p4, p5][voice];
				if (!player) return;
				// A voice that just finished needs to rewind before it can re-fire.
				if (player.playing) {
					player.seekTo(0).then(() => player.play());
				} else {
					player.play();
				}
			},
		}),
		[p0, p1, p2, p3, p4, p5]
	);
}

const PALETTE = [
	{
		light: "#FFF9EB",
		border: "#F2D79E",
		spark: "#E8A855",
	},
	{
		light: "#FFEFEA",
		border: "#F3B4A3",
		spark: "#E07A5F",
	},
	{
		light: "#F0F7EE",
		border: "#A8D3A2",
		spark: "#6A994E",
	},
	{
		light: "#F6F2FF",
		border: "#BFB0ED",
		spark: "#9B84D3",
	},
	{
		light: "#EFF7FD",
		border: "#A2CEF2",
		spark: "#5B9BD5",
	},
];

const INITIAL_POPPED = [2, 7, 11, 19];

const formatTimer = (seconds: number) =>
	`${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(
		seconds % 60
	).padStart(2, "0")}`;

type BubbleProps = {
	index: number;
	popped: boolean;
	onPress: (index: number) => void;
};

function TactileBubble({ index, popped, onPress }: BubbleProps) {
	const palette = PALETTE[index % PALETTE.length];

	const [scale] = useState(() => new Animated.Value(popped ? 0.88 : 1));
	const [highlightOpacity] = useState(
		() => new Animated.Value(popped ? 0.15 : 1)
	);

	useEffect(() => {
		Animated.parallel([
			Animated.spring(scale, {
				toValue: popped ? 0.88 : 1,
				friction: 6,
				tension: 180,
				useNativeDriver: true,
			}),
			Animated.timing(highlightOpacity, {
				toValue: popped ? 0.15 : 1,
				duration: 180,
				useNativeDriver: true,
			}),
		]).start();
	}, [popped, scale, highlightOpacity]);

	const handlePress = () => {
		Animated.sequence([
			Animated.spring(scale, {
				toValue: 0.84,
				friction: 5,
				tension: 250,
				useNativeDriver: true,
			}),
			Animated.spring(scale, {
				toValue: 0.88,
				friction: 6,
				tension: 180,
				useNativeDriver: true,
			}),
		]).start();

		onPress(index);
	};

	return (
		<Pressable
			accessibilityLabel={`Tactile bubble ${index + 1}`}
			onPress={handlePress}
			style={styles.bubbleWrapper}
		>
			<Animated.View
				style={[
					styles.bubbleShadow,
					{
						transform: [{ scale }],
						shadowOpacity: popped ? 0.05 : 0.14,
					},
				]}
			>
				<View
					style={[
						styles.bubble,
						{
							backgroundColor: palette.light,
							borderColor: palette.border,
						},
						popped && styles.poppedBubble,
					]}
				>
					{/* Soft inner highlight */}
					<Animated.View
						pointerEvents="none"
						style={[
							styles.bubbleHighlight,
							{
								opacity: highlightOpacity,
							},
						]}
					/>

					{/* Bottom inner shadow */}
					<View
						pointerEvents="none"
						style={[
							styles.bubbleBottomShade,
							popped && styles.poppedBottomShade,
						]}
					/>
				</View>
			</Animated.View>
		</Pressable>
	);
}

export default function BubblePopScreen() {
	const router = useRouter();

	const [popped, setPopped] = useState<number[]>(INITIAL_POPPED);
	const [elapsed, setElapsed] = useState(0);
	const [hapticsOn, setHapticsOn] = useState(true);
	const [soundOn, setSoundOn] = useState(true);
	const [seedsEarned, setSeedsEarned] = useState(0);

	const seedsAwardedRef = useRef(0);
	const seedRewardInFlightRef = useRef(false);

	// One pooled player per pop voice, so rapid taps can overlap instead of
	// cutting each other off. Missing file just means silent bubbles.
	const popSource = useMemo(loadBubblePopSource, []);
	const popPlayers = useAudioPlayers(popSource);
	const popVoiceRef = useRef(0);
	const lastPopAtRef = useRef(0);

	const soundOnRef = useRef(soundOn);
	soundOnRef.current = soundOn;

	// So the pop still plays with the iOS ringer switch flipped.
	useEffect(() => {
		setAudioModeAsync({ playsInSilentMode: true }).catch(() => {
			/* audio session is best-effort */
		});
	}, []);

	/** Fire the bubble-pop sound. Never awaited — haptics must stay instant. */
	const playPopSound = useCallback(() => {
		if (!soundOnRef.current) return;
		const now = Date.now();
		if (now - lastPopAtRef.current < POP_REPLAY_GAP_MS) return;
		lastPopAtRef.current = now;

		void (async () => {
			try {
				const voice = popVoiceRef.current;
				popVoiceRef.current = (voice + 1) % MAX_CONCURRENT_POPS;
				await popPlayers.seekTo(voice, 0);
				popPlayers.play(voice);
			} catch {
				/* never let a sound failure break the tap */
			}
		})();
	}, [popPlayers]);

	useEffect(() => {
		const timer = setInterval(() => {
			setElapsed((current) => current + 1);
		}, 1000);

		return () => clearInterval(timer);
	}, []);

	/**
	 * Every completed 30 seconds of play is worth 5 seeds. Rewards accumulate
	 * for as long as the session runs, so a longer visit keeps growing the
	 * garden, and the metric simply counts the seeds this session added.
	 */
	useEffect(() => {
		const milestone = Math.floor(elapsed / SEED_REWARD_SECONDS);

		if (milestone <= seedsAwardedRef.current || seedRewardInFlightRef.current) {
			return;
		}

		seedRewardInFlightRef.current = true;

		earnSeeds(SEED_REWARD_AMOUNT)
			.then(() => {
				seedsAwardedRef.current = milestone;
				setSeedsEarned(milestone * SEED_REWARD_AMOUNT);
			})
			.catch(() => {
				/* seeds are best-effort: the counter still reflects play */
			})
			.finally(() => {
				seedRewardInFlightRef.current = false;
			});
	}, [elapsed]);

	const popBubble = (index: number) => {
		// Only a bubble that was actually re-grown pops: no sound on a
		// double-tap of one that is already flat on the board.
		const alreadyPopped = popped.includes(index);

		setPopped((current) =>
			current.includes(index) ? current : [...current, index]
		);

		if (alreadyPopped) return;

		playPopSound();

		if (hapticsOn) {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => {
				/* haptics are best-effort */
			});
		}

		setTimeout(() => {
			setPopped((current) =>
				current.filter((item) => item !== index)
			);
		}, 4500);
	};

	const resetBoard = () => {
		setPopped([]);
	};

	return (
		<Screen scroll={false}>
			<NavBar
				title="Bubble Pop"
				onBack={() => router.back()}
			/>
			<ScrollView
				contentContainerStyle={styles.content}
				showsVerticalScrollIndicator={false}
			>
				<View style={styles.metricsCard}>
					<View style={styles.metricBlock}>
						<Text style={styles.metricLabel}>
							SESSION TIME
						</Text>

						<Text style={styles.metricValue}>
							{formatTimer(elapsed)}
						</Text>
					</View>

					<View style={styles.metricDivider} />

					<View style={styles.metricBlock}>
						<Text style={styles.metricLabel}>
							SEEDS ADDED
						</Text>

						<Text style={styles.metricValue}>
							{seedsEarned}
						</Text>
					</View>
				</View>

				<Text style={styles.reminder}>
					Every 30 seconds of play adds {SEED_REWARD_AMOUNT} seeds to
					your garden.
				</Text>

				{/* ========================= */}
				{/* TACTILE BUBBLE BOARD */}
				{/* ========================= */}

				<View style={styles.board}>
					{/* Branding */}
					<View style={styles.watermarkRow}>
						<Text style={styles.watermark}>
							✦ WICK SENSORY SANCTUARY
						</Text>
					</View>

					{/* 5 × 5 tactile bubble grid */}
					<View style={styles.grid}>
						{Array.from({
							length: BUBBLE_COUNT,
						}).map((_, index) => (
							<TactileBubble
								key={index}
								index={index}
								popped={popped.includes(index)}
								onPress={popBubble}
							/>
						))}
					</View>
				</View>

				<Text style={styles.instruction}>
					<Text style={styles.touchIcon}>◉</Text>
					{"  "}
					Tap firmly to decompress. Bubbles smoothly regenerate.
				</Text>

				<View style={styles.controlBar}>
					<Text style={styles.soundMode}>
						{soundOn ? "Soft Pop" : "Sound off"}
					</Text>

					<View style={styles.controlActions}>
						<Pressable
							accessibilityLabel={
								soundOn ? "Turn audio off" : "Turn audio on"
							}
							style={styles.resetButton}
							onPress={() => setSoundOn((value) => !value)}
						>
							<Text style={styles.resetIcon}>
								{soundOn ? "🔊" : "🔇"}
							</Text>
						</Pressable>

						<Pressable
							accessibilityLabel={
								hapticsOn
									? "Turn haptics off"
									: "Turn haptics on"
							}
							style={styles.resetButton}
							onPress={() => setHapticsOn((value) => !value)}
						>
							<Text style={styles.resetIcon}>
								{hapticsOn ? "📳" : "🚫"}
							</Text>
						</Pressable>

						<Pressable
							accessibilityLabel="Reset bubbles"
							style={styles.resetButton}
							onPress={resetBoard}
						>
							<Text style={styles.resetIcon}>↻</Text>
						</Pressable>
					</View>
				</View>

			</ScrollView>
		</Screen>
	);
}

const styles = StyleSheet.create({
	screen: {
		flex: 1,
		backgroundColor: "#FFFBEB",
	},

	content: {
		paddingHorizontal: 0,
		paddingBottom: 28,
	},

	metricsCard: {
		marginTop: 4,
		padding: 14,
		borderRadius: 20,
		backgroundColor: "#FFFFFF",
		borderWidth: 1,
		borderColor: "#F4EDE0",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-around",

		shadowColor: "#6B5036",
		shadowOpacity: 0.05,
		shadowRadius: 8,
		shadowOffset: {
			width: 0,
			height: 3,
		},
		elevation: 1,
	},

	metricBlock: {
		flex: 1,
		alignItems: "center",
	},

	metricLabel: {
		fontSize: 9,
		letterSpacing: 0.7,
		color: "#4F453D",
	},

	metricValue: {
		marginTop: 3,
		fontSize: 17,
		fontWeight: "700",
		color: "#523921",
	},

	metricDivider: {
		width: 1,
		height: 28,
		backgroundColor: "#F2EEDE",
	},

	reminder: {
		marginTop: 14,
		textAlign: "center",
		fontSize: 12,
		lineHeight: 18,
		color: "#675F33",
		fontWeight: "600",
	},

	/* ==================================
	   SOFT SILICONE BOARD
	   ================================== */

	board: {
		marginTop: 12,
		padding: 16,
		borderRadius: 30,
		backgroundColor: "#FAF5E7",
		borderWidth: 2,
		borderColor: "#EEDBCA",

		shadowColor: "#6B5036",
		shadowOpacity: 0.08,
		shadowRadius: 12,
		shadowOffset: {
			width: 0,
			height: 5,
		},
		elevation: 2,
	},

	watermarkRow: {
		alignItems: "center",
		marginBottom: 8,
	},

	watermark: {
		fontSize: 9,
		letterSpacing: 1.1,
		color: "#8C6E50",
		opacity: 0.45,
		fontWeight: "700",
	},

	grid: {
		flexDirection: "row",
		flexWrap: "wrap",
		justifyContent: "space-between",
		paddingTop: 4,
	},

	/* Each bubble gets 17.5% width like your original */
	bubbleWrapper: {
		width: "17.5%",
		aspectRatio: 1,
		marginBottom: 10,
		alignItems: "center",
		justifyContent: "center",
	},

	bubbleShadow: {
		width: "100%",
		height: "100%",
		borderRadius: 999,

		shadowColor: "#6B5036",
		shadowOpacity: 0.14,
		shadowRadius: 7,
		shadowOffset: {
			width: 0,
			height: 5,
		},
		elevation: 4,
	},

	bubble: {
		width: "100%",
		height: "100%",
		borderRadius: 999,
		borderWidth: 1.5,
		overflow: "hidden",

		/* subtle outer tactile depth */
		shadowColor: "#6B5036",
		shadowOpacity: 0.12,
		shadowRadius: 4,
		shadowOffset: {
			width: 0,
			height: 2,
		},
	},

	/* HTML ::before equivalent */
	bubbleHighlight: {
		position: "absolute",
		top: "10%",
		left: "15%",
		width: "34%",
		height: "25%",
		borderRadius: 999,

		backgroundColor: "rgba(255,255,255,0.88)",

		transform: [
			{
				rotate: "-25deg",
			},
		],

		shadowColor: "#FFFFFF",
		shadowOpacity: 0.8,
		shadowRadius: 7,
		shadowOffset: {
			width: 0,
			height: 0,
		},
	},

	/* HTML inset bottom shadow approximation */
	bubbleBottomShade: {
		position: "absolute",
		left: "4%",
		right: "4%",
		bottom: "3%",
		height: "42%",
		borderRadius: 999,

		backgroundColor: "rgba(107,80,54,0.055)",
	},

	poppedBubble: {
		/* extra darkening is provided by the inner layer */
		opacity: 0.96,
	},

	poppedBottomShade: {
		backgroundColor: "rgba(107,80,54,0.20)",
		height: "55%",
		bottom: "-7%",
	},

	instruction: {
		marginTop: 10,
		textAlign: "center",
		fontSize: 10,
		color: "#81756C",
	},

	touchIcon: {
		fontSize: 10,
		color: "#81756C",
	},

	controlBar: {
		marginTop: 12,
		padding: 7,
		borderRadius: 24,
		backgroundColor: "#FFFFFF",
		borderWidth: 1,
		borderColor: "#F4EDE0",
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",

		shadowColor: "#6B5036",
		shadowOpacity: 0.05,
		shadowRadius: 5,
		shadowOffset: {
			width: 0,
			height: 2,
		},
		elevation: 1,
	},

	soundMode: {
		marginLeft: 12,
		fontSize: 11,
		fontWeight: "600",
		color: "#6B5036",
	},

	controlActions: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},

	resetButton: {
		width: 32,
		height: 32,
		borderRadius: 16,
		backgroundColor: "#F2EEDE",
		alignItems: "center",
		justifyContent: "center",
	},

	resetIcon: {
		fontSize: 16,
		color: "#523921",
	},

});
