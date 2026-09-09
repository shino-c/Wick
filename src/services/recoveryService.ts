// import * as Calendar from 'expo-calendar';
// import * as Location from 'expo-location';
// import { Platform } from 'react-native';
// import AsyncStorage from '@react-native-async-storage/async-storage';
// import { readDb, writeDb } from '@/data/localStore';
// import type { RecoveryDay, WeeklyStressAnalysis, WorkloadAnalysis, WorkloadItem } from '@/data/types';
// import { listWorkloadItems } from './workloadService';
// import { currentUserId, hasSupabase, supabase } from '@/lib/supabaseClient';

// const today = () => new Date().toISOString().slice(0, 10);
// const outdoorStartKey = 'wick.recovery.outdoor-start.v1';
// const gameMinutesKey = 'wick.recovery.game-minutes.v1';
// const outdoorStepGoal = 1000;
// const averageStepLengthMeters = 0.75;
// const outdoorDistanceGoalMeters = outdoorStepGoal * averageStepLengthMeters;
// const distanceInMeters = (first: { latitude: number; longitude: number }, second: { latitude: number; longitude: number }) => {
//   const earthRadius = 6_371_000;
//   const latitudeDelta = ((second.latitude - first.latitude) * Math.PI) / 180;
//   const longitudeDelta = ((second.longitude - first.longitude) * Math.PI) / 180;
//   const latitude = (first.latitude * Math.PI) / 180;
//   const secondLatitude = (second.latitude * Math.PI) / 180;
//   const haversine = Math.sin(latitudeDelta / 2) ** 2 + Math.sin(longitudeDelta / 2) ** 2 * Math.cos(latitude) * Math.cos(secondLatitude);
//   return 2 * earthRadius * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
// };
// const blankDay = (date: string): RecoveryDay => ({ date, completedPlanIds: [], gameCompleted: false, gameMinutes: 0, outdoorCompleted: false, recoveryPct: 0, updatedAt: new Date().toISOString() });
// const fromRow = (row: any): RecoveryDay => ({ date: row.recovery_date, completedPlanIds: row.completed_plan_ids ?? [], gameCompleted: row.game_completed ?? false, gameMinutes: row.game_minutes ?? 0, outdoorCompleted: row.outdoor_completed ?? false, recoveryEventId: row.recovery_event_id ?? null, recoveryEventStart: row.recovery_event_start ?? null, recoveryPct: row.recovery_pct ?? 0, updatedAt: row.updated_at ?? new Date().toISOString() });
// const calculatePct = (day: RecoveryDay) => Math.min(100, (day.outdoorCompleted ? 40 : 0) + Math.min(60, day.completedPlanIds.length * 30) + day.gameMinutes * 5);

// const isMissingGameMinutesColumn = (error: { code?: string; message?: string } | null) =>
//   error?.code === 'PGRST204' && error.message?.includes('game_minutes');

// async function readLocalGameMinutes(date: string) {
//   const raw = await AsyncStorage.getItem(`${gameMinutesKey}:${date}`);
//   return raw ? Number(raw) || 0 : 0;
// }

// async function saveLocalGameMinutes(date: string, minutes: number) {
//   await AsyncStorage.setItem(`${gameMinutesKey}:${date}`, String(minutes));
// }

// export function findRecoverySlot(items: WorkloadItem[], now = new Date()): Date {
//   const start = new Date(now);
//   start.setHours(15, 0, 0, 0);
//   const todayItems = items.filter((item) => {
//     if (!item.scheduledStart || !item.scheduledEnd || item.status !== 'scheduled') return false;
//     return new Date(item.scheduledStart).toDateString() === start.toDateString();
//   });
//   const conflicts = todayItems.map((item) => [
//     new Date(item.scheduledStart as string).getTime(),
//     new Date(item.scheduledEnd as string).getTime(),
//   ]);
//   while (conflicts.some(([occupiedStart, occupiedEnd]) => start.getTime() < occupiedEnd && start.getTime() + 30 * 60_000 > occupiedStart)) {
//     start.setMinutes(start.getMinutes() + 30);
//   }
//   return start;
// }

// export async function getRecoveryDay(date = today()): Promise<RecoveryDay> {
//   if (hasSupabase) {
//     const userId = await currentUserId(); if (!userId) return blankDay(date);
//     const { data, error } = await supabase.from('recovery_days').select('*').eq('user_id', userId).eq('recovery_date', date).maybeSingle();
//     if (error) throw error;
//     if (!data) return blankDay(date);
//     const day = fromRow(data);
//     if (day.gameMinutes === 0) day.gameMinutes = await readLocalGameMinutes(date);
//     return day;
//   }
//   const db = await readDb();
//   const stored = db.recoveryDays.find((day) => day.date === date);
//   return stored ? { ...stored, gameMinutes: stored.gameMinutes ?? 0 } : blankDay(date);
// }

// async function updateDay(mutate: (day: RecoveryDay) => void) {
//   const day = await getRecoveryDay(); mutate(day); day.recoveryPct = calculatePct(day); day.updatedAt = new Date().toISOString();
//   if (hasSupabase) {
//     const userId = await currentUserId(); if (!userId) throw new Error('Sign in before saving recovery progress.');
//     const payload = { user_id: userId, recovery_date: day.date, completed_plan_ids: day.completedPlanIds, game_completed: day.gameCompleted, game_minutes: day.gameMinutes, outdoor_completed: day.outdoorCompleted, recovery_event_id: day.recoveryEventId ?? null, recovery_event_start: day.recoveryEventStart ?? null, recovery_pct: day.recoveryPct, updated_at: day.updatedAt };
//     const { error } = await supabase.from('recovery_days').upsert(payload, { onConflict: 'user_id,recovery_date' });
//     if (!error) return day;
//     if (!isMissingGameMinutesColumn(error)) throw error;

//     // Older Supabase projects may not have applied the game_minutes migration yet.
//     // Keep the app usable until that SQL migration is run, without losing the local reward.
//     await saveLocalGameMinutes(day.date, day.gameMinutes);
//     const { game_minutes: _gameMinutes, ...legacyPayload } = payload;
//     const legacyResult = await supabase.from('recovery_days').upsert(legacyPayload, { onConflict: 'user_id,recovery_date' });
//     if (legacyResult.error) throw legacyResult.error;
//     return day;
//   }
//   await writeDb((db) => { const index = db.recoveryDays.findIndex((item) => item.date === day.date); if (index >= 0) db.recoveryDays[index] = day; else db.recoveryDays.push(day); }); return day;
// }

// export const completeRecoveryGame = () => updateDay((day) => { day.gameCompleted = true; });

// export const recordRecoveryMinute = () => updateDay((day) => {
//   day.gameMinutes += 1;
//   day.gameCompleted = true;
// });

// /** Records an outcome that another Wick/device system has verified. It cannot undo progress. */
// export const recordVerifiedPlan = (id: string) => updateDay((day) => {
//   if (!day.completedPlanIds.includes(id)) day.completedPlanIds.push(id);
// });

// /** Requests foreground consent only; no coordinates are stored, only a verified result. */
// type OutdoorStart = { latitude: number; longitude: number; date: string };
// async function currentOutdoorPosition() {
//   if (Platform.OS === 'web') throw new Error('Outdoor verification is available from the Wick mobile app.');
//   const permission = await Location.requestForegroundPermissionsAsync();
//   if (permission.status !== 'granted') throw new Error('Location permission is needed to verify that you left your starting location.');
//   const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
//   if (!Number.isFinite(position.coords.latitude) || !Number.isFinite(position.coords.longitude)) throw new Error('Could not confirm your location. Try again outside with GPS enabled.');
//   return position.coords;
// }

// /** Keeps a starting point on-device only until the walk is verified or cancelled. */
// export async function startOutdoorRecovery() {
//   const coords = await currentOutdoorPosition();
//   await AsyncStorage.setItem(outdoorStartKey, JSON.stringify({ latitude: coords.latitude, longitude: coords.longitude, date: today() } satisfies OutdoorStart));
// }

// export async function hasOutdoorRecoveryStarted() {
//   const raw = await AsyncStorage.getItem(outdoorStartKey);
//   return !!raw && (JSON.parse(raw) as OutdoorStart).date === today();
// }

// export async function verifyOutdoorRecovery(planId = 'walk'): Promise<RecoveryDay> {
//   const raw = await AsyncStorage.getItem(outdoorStartKey);
//   if (!raw) throw new Error('Start the location check before leaving, then verify after your walk.');
//   const start = JSON.parse(raw) as OutdoorStart;
//   if (start.date !== today()) throw new Error('That walk check expired. Start a new one before leaving.');
//   const coords = await currentOutdoorPosition();
//   const distance = distanceInMeters({ latitude: start.latitude, longitude: start.longitude }, { latitude: coords.latitude, longitude: coords.longitude });
//   if (distance < outdoorDistanceGoalMeters) {
//     throw new Error(`You are ${Math.round(distance)}m from where you started. Walk about ${outdoorStepGoal.toLocaleString()} steps, then verify again.`);
//   }
//   await AsyncStorage.removeItem(outdoorStartKey);
//   return updateDay((day) => { day.outdoorCompleted = true; if (!day.completedPlanIds.includes(planId)) day.completedPlanIds.push(planId); });
// }

// export async function reserveRecoveryBlock(requestedStart?: Date): Promise<{ start: Date; eventId: string }> {
//   if (Platform.OS === 'web') throw new Error('Calendar blocks can be added from the Wick mobile app.');
//   const permission = await Calendar.requestCalendarPermissions();
//   if (permission.status !== 'granted') throw new Error('Calendar access is needed to reserve your recovery block.');
//   const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
//   const writable = calendars.find((calendar) => calendar.allowsModifications);
//   if (!writable) throw new Error('No writable device calendar was found.');
//   const start = requestedStart ?? findRecoverySlot(await listWorkloadItems());
//   if (start.getTime() < Date.now() + 5 * 60_000) throw new Error('That recovery window has already started. Choose the next available window.');
//   const end = new Date(start.getTime() + 30 * 60_000);
//   const event = await writable.createEvent({ title: 'Wick recovery block', notes: 'A protected 30-minute reset reserved by Wick.', startDate: start, endDate: end, availability: Calendar.Availability.BUSY });
//   const eventId = event.id;
//   await updateDay((day) => { day.recoveryEventId = eventId; day.recoveryEventStart = start.toISOString(); }); return { start, eventId };
// }

// export async function getRecoveryWeek(): Promise<RecoveryDay[]> {
//   const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 6);
//   const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(start); date.setDate(start.getDate() + index); return date.toISOString().slice(0, 10); });
//   if (hasSupabase) { const userId = await currentUserId(); if (!userId) return dates.map(blankDay); const { data, error } = await supabase.from('recovery_days').select('*').eq('user_id', userId).gte('recovery_date', dates[0]).lte('recovery_date', dates[6]); if (error) throw error; const rows = new Map((data ?? []).map((row: any) => [row.recovery_date, fromRow(row)])); return dates.map((date) => rows.get(date) ?? blankDay(date)); }
//   const db = await readDb(); return dates.map((date) => db.recoveryDays.find((day) => day.date === date) ?? blankDay(date));
// }

// export interface RecoveryPlanItem { id: string; icon: string; title: string; detail: string; reason: string; }
// export function createRecoveryPlan(load: WorkloadAnalysis, stress: WeeklyStressAnalysis | null): RecoveryPlanItem[] {
//   const driver = stress?.domainDriver ?? load.spikingCategory; const plans: RecoveryPlanItem[] = [];
//   if (driver === 'physical') plans.push({ id: 'physical', icon: '🏃', title: 'Campus gym or easy walk', detail: 'A protected 30-minute movement block', reason: 'Movement is your current recovery lever.' });
//   if (driver === 'social') plans.push({ id: 'social', icon: '💬', title: 'Join a Circle recovery challenge', detail: 'Complete a shared recovery action', reason: 'Connection is the current recovery lever.' });
//   if (driver === 'errands') plans.push({ id: 'errands', icon: '🛒', title: 'Batch your errand run', detail: 'One route, then stop for the day', reason: 'Reduce the number of transitions.' });
//   if (driver === 'mental' || driver === 'academic') plans.push({ id: 'walk', icon: '🚶', title: 'Take an outdoor walk', detail: 'Verify it with your device location', reason: 'A change of environment can reset the day.' });
//   if (load.isOverloaded) plans.unshift({ id: 'calendar', icon: '📅', title: 'Reserve recovery time', detail: 'Wick adds a real calendar block', reason: 'Your workload is near capacity.' });
//   if (!plans.some((plan) => plan.id === 'walk')) plans.push({ id: 'walk', icon: '🚶', title: 'Take an outdoor walk', detail: 'Verify it with your device location', reason: 'A change of environment can reset the day.' });
//   return plans.slice(0, 3);
// }
