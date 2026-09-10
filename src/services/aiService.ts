/**
 * aiService.ts — Natural Language Processing & Workload Intelligence Engine.
 *
 * Supports:
 *   1. OpenRouter Free Tier (google/gemini-2.0-flash-exp:free, meta-llama/llama-3.3-70b-instruct:free)
 *   2. Google Gemini Free Tier (gemini-1.5-flash / gemini-2.5-flash)
 *   3. Built-in Deterministic NLP Heuristic Fallback (Zero credit consumption, works offline)
 *
 * All functions batch requests to conserve API tokens and prevent rate limit exhaustion.
 */

import type {
  AvailableSlot,
  CalendarEventItem,
  DailyRecoveryPlan,
  LoadBalanceSuggestion,
  RecoverySuggestion,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
} from '@/data/types';
import { toISODate } from '@/services/dateUtils';



/* ── AI Callers ─────────────────────────────────────────────────── */

import { Groq } from 'groq-sdk';

const GROQ_API_KEY = process.env.EXPO_PUBLIC_GROQ_API_KEY;

const groq = GROQ_API_KEY
  ? new Groq({
      apiKey: GROQ_API_KEY,
      dangerouslyAllowBrowser: true,
    })
  : null;

async function callGroq(
  prompt: string,
  systemPrompt?: string
): Promise<string | null> {
  if (!groq) return null;

  try {
    const completion = await groq.chat.completions.create({
      model: 'openai/gpt-oss-120b',

      messages: [
        ...(systemPrompt
          ? [{ role: 'system' as const, content: systemPrompt }]
          : []),
        {
          role: 'user' as const,
          content: prompt,
        },
      ],

      temperature: 0.2,
      max_completion_tokens: 16384,
      top_p: 0.95,

      stream: false,

      reasoning_effort: 'medium',
    });

    const message = completion.choices?.[0]?.message;

    if (!message) {
      console.error('Groq returned no message:', completion);
      return null;
    }

    return message.content ?? null;
  } catch (err) {
    console.error(
      'Groq request failed, falling back to local NLP:',
      err
    );
    return null;
  }
}

async function callAI(
  prompt: string,
  systemPrompt?: string
): Promise<string | null> {
  return callGroq(prompt, systemPrompt);
}



/* ── Rule-Based Deterministic NLP Heuristic Engine ────────────────────────── */

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  academic: [
    'exam', 'quiz', 'test', 'assignment', 'homework', 'thesis', 'lab',
    'study', 'lecture', 'class', 'presentation', 'essay', 'course',
    'midterm', 'final', 'seminar', 'tutorial', 'read chapter',
  ],
  work: [
    'meeting', 'sync', 'standup', 'client', 'sprint', 'review', 'pitch',
    'interview', 'report', 'code', 'deploy', 'office', '1:1', 'demo',
    'workshop', 'project', 'deadline',
  ],
  social: [
    'lunch', 'dinner', 'coffee', 'drinks', 'birthday', 'party', 'hangout',
    'meetup', 'visit', 'celebration', 'gathering', 'reunion', 'brunch',
    'catchup', 'call with',
  ],
  physical: [
    'gym', 'workout', 'run', 'swim', 'yoga', 'cycling', 'soccer',
    'basketball', 'fitness', 'doctor', 'dentist', 'training', 'walk',
    'hike', 'climbing', 'physio',
  ],
  mental: [
    'meditation', 'breathing', 'downtime', 'relax', 'journal', 'therapy',
    'mindfulness', 'break', 'nap', 'reading',
  ],
  errands: [
    'grocery', 'groceries', 'clean', 'laundry', 'shopping', 'buy', 'bank',
    'repair', 'chores', 'cook', 'mail', 'package', 'tidy', 'desk',
  ],
};

function inferCategory(text: string): string {
  const lower = text.toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => lower.includes(k))) {
      return cat;
    }
  }
  return 'academic'; // default to academic/general productivity
}

function inferPriority(text: string, category: string): 'high' | 'medium' | 'low' {
  const lower = text.toLowerCase();
  if (
    lower.includes('exam') ||
    lower.includes('due') ||
    lower.includes('urgent') ||
    lower.includes('critical') ||
    lower.includes('final') ||
    lower.includes('doctor') ||
    lower.includes('deadline') ||
    lower.includes('interview')
  ) {
    return 'high';
  }
  if (
    lower.includes('clean') ||
    lower.includes('tidy') ||
    lower.includes('organize') ||
    lower.includes('optional') ||
    lower.includes('casual') ||
    category === 'errands' ||
    category === 'mental'
  ) {
    return 'low';
  }
  return 'medium';
}

function calculateStressScore(priority: string, category: string, hours: number): number {
  let base = 50;
  if (priority === 'high') base += 25;
  if (priority === 'low') base -= 25;

  if (category === 'academic' || category === 'work') base += 10;
  if (category === 'mental') base -= 25;
  if (category === 'social' || category === 'physical') base -= 10;

  base += Math.min(15, Math.round(hours * 3));
  return Math.max(10, Math.min(95, base));
}

function parseEventDate(
  value: string | undefined,
  eventId: string,
  field: string
): Date {
  if (!value) {
    console.error(`Invalid ${field} date for calendar event ${eventId}:`, value);
    return new Date();
  }

  // Normalize malformed AI output:
  // 2026-09-11T15:00:00:00 -> 2026-09-11T15:00:00
  const normalized = value.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}):00$/,
    "$1"
  );

  const parsed = new Date(normalized);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  console.error(
    `Invalid ${field} date for calendar event ${eventId}:`,
    value
  );

  return new Date();
}


/* ── Public AI API Functions ──────────────────────────────────────────────── */

export function normalizeCategory(cat?: string): string {
  if (!cat) return 'academic';
  const lower = cat.toLowerCase().trim();
  if (lower.includes('acad') || lower.includes('study') || lower.includes('exam') || lower.includes('assign') || lower.includes('class') || lower.includes('course') || lower.includes('homework')) return 'academic';
  if (lower.includes('work') || lower.includes('job') || lower.includes('meet') || lower.includes('office') || lower.includes('client') || lower.includes('sprint') || lower.includes('project')) return 'work';
  if (lower.includes('soc') || lower.includes('friend') || lower.includes('party') || lower.includes('hangout') || lower.includes('dinner') || lower.includes('lunch') || lower.includes('coffee')) return 'social';
  if (lower.includes('phys') || lower.includes('gym') || lower.includes('health') || lower.includes('sport') || lower.includes('workout') || lower.includes('run') || lower.includes('doctor')) return 'physical';
  if (lower.includes('ment') || lower.includes('mind') || lower.includes('meditat') || lower.includes('relax') || lower.includes('down') || lower.includes('breath') || lower.includes('sleep')) return 'mental';
  if (lower.includes('errand') || lower.includes('chore') || lower.includes('clean') || lower.includes('shop') || lower.includes('buy') || lower.includes('grocer') || lower.includes('misc') || lower.includes('other')) return 'errands';
  return 'academic';
}

/**
 * Batched analysis of calendar events for the week.
 * Analyzes title, category, priority, duration, day, capacity hours, stress score, and ranks them.
 */
export async function analyzeCalendarTasks(
  events: CalendarEventItem[],
  options?: { perceivedStressBaseline?: number }
): Promise<TaskAnalysis[]> {
  if (!events || events.length === 0) return [];

  // Attempt AI processing if API key is configured
  const prompt = `Analyze these ${events.length} calendar events for the current week. Return a JSON array with:
  - id: matching event id
  - title: clear, concise task title
  - category: one of ["academic", "work", "social", "physical", "mental", "errands"]
  - priority: one of ["high", "medium", "low"]
  - estimated_duration_hours: number (0.5 to 8)
  - stress_score: number (0 to 100)
  - rank: number (1 is highest priority/urgency)
  - ai_reasoning: short sentence explaining why this task has this rank and priority

Events: ${JSON.stringify(events.map(e => ({ id: e.id, title: e.title, start: e.startDate, end: e.endDate })))}

Baseline stress baseline: ${options?.perceivedStressBaseline ?? 50} / 100.
OUTPUT STRICT VALID JSON ONLY (no markdown fences, just [ ... ]).`;

  const rawAi = await callAI(prompt, 'You are an expert workload & cognitive stress analysis AI.');
  if (rawAi) {
    try {
      const clean = rawAi.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(clean);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item, idx) => {
          const original = events.find(e => e.id === item.id) || events[idx];
          const eventId = original?.id || item.id || `task-${idx}`;
          const start = parseEventDate(original?.startDate, eventId, 'start');
          const end = original?.endDate
            ? parseEventDate(original.endDate, eventId, 'end')
            : undefined;
          const category = normalizeCategory(item.category);
          return {
            id: item.id || `task-${idx}-${Date.now()}`,
            title: item.title || original?.title || 'Untitled Task',
            category,
            priority: (item.priority === 'high' || item.priority === 'low' ? item.priority : 'medium') as 'high' | 'medium' | 'low',
            estimated_duration_hours: Number(item.estimated_duration_hours) || 1,
            scheduled_date: toISODate(start),
            scheduled_start_time: start.toTimeString().slice(0, 5),
            scheduled_end_time: end ? end.toTimeString().slice(0, 5) : undefined,
            allDay: Boolean(original?.allDay),
            capacity_hours: Number(item.estimated_duration_hours) || 1,
            stress_score: Math.min(100, Math.max(0, Number(item.stress_score) || 50)),
            rank: Number(item.rank) || (idx + 1),
            ai_reasoning: item.ai_reasoning || 'Ranked based on cognitive load and deadline.',
            status: 'pending' as const,
            calendar_event_id: original?.id,
            calendar_provider: 'device',
          };
        });
      }
    } catch (e) {
      console.error('Failed to parse AI output, proceeding with deterministic heuristic:', e);
    }
  }

  // Fallback: Deterministic NLP Heuristic Engine
  const mapped = events.map((ev, index) => {
    const start = parseEventDate(ev.startDate, ev.id, 'start');
    const end = ev.endDate ? parseEventDate(ev.endDate, ev.id, 'end') : null;
    const durationHours =
      start && end && end.getTime() > start.getTime()
        ? Math.max(0.5, Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 10) / 10)
        : 1;

    const category = inferCategory(ev.title);
    const priority = inferPriority(ev.title, category);
    const stressScore = calculateStressScore(priority, category, durationHours);

    return {
      id: ev.id,
      title: ev.title || 'Untitled Task',
      category,
      priority,
      estimated_duration_hours: durationHours,
      scheduled_date: toISODate(start),
      scheduled_start_time: start.toTimeString().slice(0, 5),
      scheduled_end_time: end ? end.toTimeString().slice(0, 5) : undefined,
      allDay: Boolean(ev.allDay),
      capacity_hours: durationHours,
      stress_score: stressScore,
      rank: 0,
      ai_reasoning: `${priority.toUpperCase()} priority: ${category} load contributing ${stressScore}% stress.`,
      status: 'pending' as const,
      calendar_event_id: ev.id,
      calendar_provider: 'device',
    };
  });

  // Rank tasks by priority weight (high > medium > low), then stress score descending
  const priorityWeight: Record<string, number> = { high: 3, medium: 2, low: 1 };
  mapped.sort((a, b) => {
    const pDiff = (priorityWeight[b.priority] || 2) - (priorityWeight[a.priority] || 2);
    if (pDiff !== 0) return pDiff;
    return (b.stress_score ?? 50) - (a.stress_score ?? 50);
  });

  return mapped.map((t, idx) => ({ ...t, rank: idx + 1 }));
}

/**
 * Analyzes total and used weekly capacity, category percentages, overload warning,
 * and weekly stress based on onboarding baseline and scheduled tasks.
 */
export async function analyzeWeeklyCapacity(
  tasks: TaskAnalysis[],
  options?: { perceivedStressBaseline?: number }
): Promise<WeeklyCapacityAnalysis> {
  const baseStress = options?.perceivedStressBaseline ?? 50;

  // Personalize standard capacity: high baseline stress reduces max weekly threshold
  const totalCapacityHours = baseStress > 70 ? 32 : 40;

  const usedCapacityHours = tasks.reduce(
    (sum, t) => sum + (Number(t.estimated_duration_hours) || 1),
    0
  );

  const usedCapacityRounded = Math.round(usedCapacityHours * 10) / 10;
  const capacityPct = Math.round((usedCapacityRounded / totalCapacityHours) * 100);
  const overloadWarning = capacityPct >= 85;

  // Calculate category breakdown percentages across standard categories
  const standardCategories = ['academic', 'work', 'social', 'physical', 'mental', 'errands'];
  const catHours: Record<string, number> = {
    academic: 0,
    work: 0,
    social: 0,
    physical: 0,
    mental: 0,
    errands: 0,
  };
  for (const t of tasks) {
    const c = normalizeCategory(t.category);
    catHours[c] = (catHours[c] || 0) + (Number(t.estimated_duration_hours) || 1);
  }

  const breakdown: Record<string, number> = {};
  for (const c of standardCategories) {
    breakdown[c] = usedCapacityHours > 0 ? Math.round(((catHours[c] || 0) / usedCapacityHours) * 100) : 0;
  }

  // Composite weekly stress score
  const avgTaskStress =
    tasks.length > 0
      ? tasks.reduce((sum, t) => sum + (t.stress_score ?? 50), 0) / tasks.length
      : 40;
  const compositeStress = Math.min(
    100,
    Math.round(baseStress * 0.35 + (capacityPct / 100) * 40 + avgTaskStress * 0.25)
  );

  // Generate actionable reasoning
  let reasoning = 'Your weekly capacity is well balanced.';
  if (capacityPct >= 100) {
    reasoning = `Overload Warning (${capacityPct}% capacity). You exceed your weekly cognitive limit. Deferring low-priority tasks is recommended.`;
  } else if (capacityPct >= 85) {
    reasoning = `Near Limit (${capacityPct}% capacity). Ensure your schedule supports active recovery blocks.`;
  }

  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(now);
  weekStart.setDate(diff);

  return {
    week_start: toISODate(weekStart),
    total_capacity_hours: totalCapacityHours,
    used_capacity_hours: usedCapacityRounded,
    overload_warning: overloadWarning,
    category_breakdown: breakdown,
    stress_score: compositeStress,
    ai_reasoning: reasoning,
  };
}

/**
 * Natural language parser for quick-adding tasks.
 * Example inputs: "2 assignment due Fri", "Exam Thursday 2pm", "Clean kitchen tonight".
 */
export async function parseQuickTaskNLP(
  input: string,
  context?: { currentWeekStart?: string }
): Promise<Omit<TaskAnalysis, 'id' | 'createdAt'>> {
  const prompt = `Parse this user task input into a structured schedule object:
Input: "${input}"

Return a strict JSON object with:
- title: concise cleaned task title
- category: one of ["academic", "work", "social", "physical", "mental", "errands"]
- priority: one of ["high", "medium", "low"]
- estimated_duration_hours: number (e.g. 1, 2)
- scheduled_date: ISO date string (YYYY-MM-DD) for this week
- scheduled_start_time: string in HH:MM format (24h), or null
- scheduled_end_time: string in HH:MM format (24h), or null
- stress_score: number 0-100
- ai_reasoning: short rationale

Reference current date: ${new Date().toISOString().split('T')[0]}
OUTPUT STRICT JSON ONLY.`;

  const rawAi = await callAI(prompt, 'You are an intelligent NLP task scheduling assistant.');
  if (rawAi) {
    try {
      const clean = rawAi.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed && parsed.title) {
        const category = normalizeCategory(parsed.category);
        return {
          title: parsed.title,
          category,
          priority: (parsed.priority === 'high' || parsed.priority === 'low' ? parsed.priority : 'medium') as 'high' | 'medium' | 'low',
          estimated_duration_hours: Number(parsed.estimated_duration_hours) || 1,
          scheduled_date: parsed.scheduled_date || toISODate(),
          scheduled_start_time: parsed.scheduled_start_time || '09:00',
          scheduled_end_time: parsed.scheduled_end_time || undefined,
          capacity_hours: Number(parsed.estimated_duration_hours) || 1,
          stress_score: Number(parsed.stress_score) || 50,
          rank: 1,
          ai_reasoning: parsed.ai_reasoning || 'Auto-parsed from quick input.',
          status: 'pending',
          calendar_provider: 'device',
        };
      }
    } catch (e) {
      console.error('AI NLP parse error, falling back to local heuristic:', e);
    }
  }

  // Heuristic Fallback
  const lower = input.toLowerCase();
  const category = inferCategory(input);
  const priority = inferPriority(input, category);

  // Extract hours if mentioned (e.g. "2h", "3 hours", "30 mins")
  let hours = 1;
  const hourMatch = lower.match(/(\d+(?:\.\d+)?)\s*(?:h|hr|hours?)/);
  const minMatch = lower.match(/(\d+)\s*(?:m|min|minutes?)/);
  if (hourMatch) {
    hours = parseFloat(hourMatch[1]);
  } else if (minMatch) {
    hours = Math.round((parseInt(minMatch[1], 10) / 60) * 10) / 10;
  } else if (lower.includes('assignment') || lower.includes('exam') || lower.includes('study')) {
    hours = 2;
  }

  // Determine target date from day mentions
  const now = new Date();
  let targetDate = new Date(now);
  const daysOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const targetDayIdx = daysOfWeek.findIndex(d => lower.includes(d));

  if (targetDayIdx >= 0) {
    const currentDay = now.getDay();
    const diff = (targetDayIdx + 7 - currentDay) % 7;
    targetDate.setDate(now.getDate() + (diff === 0 ? 0 : diff));
  } else if (lower.includes('tomorrow')) {
    targetDate.setDate(now.getDate() + 1);
  }

  // Extract time if specified (e.g. "2pm", "14:00", "at 9")
  let startTime = '10:00';
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (timeMatch && (timeMatch[3] || lower.includes('at '))) {
    let h = parseInt(timeMatch[1], 10);
    const m = timeMatch[2] || '00';
    const ampm = timeMatch[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    startTime = `${h.toString().padStart(2, '0')}:${m}`;
  }

  // Calculate end time
  const startHour = parseInt(startTime.split(':')[0], 10);
  const endHour = Math.min(23, startHour + Math.ceil(hours));
  const endTime = `${endHour.toString().padStart(2, '0')}:${startTime.split(':')[1]}`;

  const cleanTitle = input
    .replace(/\b(?:due|at|on|for|tomorrow|today|fri|sat|sun|mon|tue|wed|thu)\b.*/gi, '')
    .trim() || input;

  const stressScore = calculateStressScore(priority, category, hours);

  return {
    title: cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1),
    category,
    priority,
    estimated_duration_hours: hours,
    scheduled_date: toISODate(targetDate),
    scheduled_start_time: startTime,
    scheduled_end_time: endTime,
    capacity_hours: hours,
    stress_score: stressScore,
    rank: 1,
    ai_reasoning: `Auto-categorized as ${category} with ${priority} priority.`,
    status: 'pending',
    calendar_provider: 'device',
  };
}

/**
 * Recommends low-priority, flexible tasks to defer when weekly capacity is strained.
 */
export async function suggestLoadBalance(
  tasks: TaskAnalysis[],
  capacity?: WeeklyCapacityAnalysis
): Promise<LoadBalanceSuggestion[]> {
  if (!tasks || tasks.length === 0) return [];

  // Prefer low-priority work. Only consider medium-priority work when there
  // are no eligible low-priority tasks to defer.
  const candidatesByPriority = (priority: 'low' | 'medium') => tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'deferred' &&
      t.priority === priority &&
      (t.category === 'errands' || t.category === 'academic' || t.category === 'work')
  );

  const lowPriorityTasks = candidatesByPriority('low');
  const deferrable = lowPriorityTasks.length > 0
    ? lowPriorityTasks
    : candidatesByPriority('medium');

  deferrable.sort(
    (a, b) => (b.estimated_duration_hours || 1) - (a.estimated_duration_hours || 1)
  );

  const candidates = deferrable.slice(0, 3);
  return candidates.map((task) => {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    return {
      taskId: task.id,
      taskTitle: task.title,
      reason: `${task.category.toUpperCase()} • ${task.priority} priority. Deferring relieves ${task.estimated_duration_hours}h load.`,
      suggestedDate: nextWeek.toISOString().split('T')[0],
      hoursSaved: task.estimated_duration_hours || 1,
    };
  });
}

/* ── Daily recovery plan ─────────────────────────────────────────── */

export interface RecoveryPlanContext {
  /** ISO date the plan is for. */
  date: string;
  /** Real free windows computed from the day's scheduled tasks. */
  slots: AvailableSlot[];
  /** Share of the week's capacity already used, 0-100. */
  capacityPct: number;
  overloaded: boolean;
  /** Latest measured stress score, 0-100, or null when none exists. */
  stressScore: number | null;
  /** Perceived stress baseline from onboarding, or null. */
  baseline: number | null;
  /** ids the user already completed today (not suggested again). */
  completedToday: string[];
}

/** Gentle, optional activities grouped by the length of free time they fit in. */
const GENTLE_ACTIVITIES: {
  id: string;
  emoji: string;
  title: string;
  detail: string;
  minutes: number;
  targetType: 'steps' | 'minutes';
  targetValue: number;
}[] = [
  { id: 'breath', emoji: '🌬️', title: 'A slow minute of breathing', detail: 'In for four, out for four, wherever you are.', minutes: 5, targetType: 'minutes', targetValue: 5 },
  { id: 'water', emoji: '💧', title: 'A full glass of water, really slowly', detail: 'No rush. Just you and the glass.', minutes: 5, targetType: 'minutes', targetValue: 5 },
  { id: 'stretch', emoji: '🧎', title: 'A gentle stretch from your chair', detail: 'Reach up, roll your shoulders, let them drop.', minutes: 10, targetType: 'minutes', targetValue: 10 },
  { id: 'tea', emoji: '🍵', title: 'A warm drink, no screens nearby', detail: 'Hold the cup with both hands. That is the whole task.', minutes: 15, targetType: 'minutes', targetValue: 15 },
  { id: 'walk', emoji: '🌳', title: 'A short walk without a destination', detail: 'Pace is nothing. Leaving your desk is everything.', minutes: 20, targetType: 'steps', targetValue: 2000 },
  { id: 'window', emoji: '🪟', title: 'Two minutes looking out a window', detail: 'Watch one thing move. A cloud, a tree, a street.', minutes: 10, targetType: 'minutes', targetValue: 10 },
  { id: 'music', emoji: '🎧', title: 'One song, eyes closed', detail: 'Pick a song you love. Nothing else for its length.', minutes: 10, targetType: 'minutes', targetValue: 10 },
  { id: 'journal', emoji: '📓', title: 'A few unpolished sentences', detail: 'Whatever is on your mind. No full sentences required.', minutes: 15, targetType: 'minutes', targetValue: 15 },
  { id: 'stroll', emoji: '🚶', title: 'A slow stroll around the block', detail: 'If the weather agrees. If not, this can wait.', minutes: 30, targetType: 'steps', targetValue: 3000 },
  { id: 'bath', emoji: '🛁', title: 'Unhurried time to reset', detail: 'Warm water, nothing else competing for your attention.', minutes: 45, targetType: 'minutes', targetValue: 45 },
];

/** Clamp an AI-provided number into something sensible for the target type. */
function clampTarget(targetType: 'steps' | 'minutes', minutes: number, raw?: number): number {
  if (targetType === 'steps') {
    const steps = Math.round(Number(raw) || 0);
    if (steps >= 500 && steps <= 10000) return steps;
    return 2000;
  }
  return Math.max(1, Math.round(minutes));
}

function normalizeTargetType(raw: unknown): 'steps' | 'minutes' {
  const value = String(raw ?? '').toLowerCase();
  return value === 'steps' ? 'steps' : 'minutes';
}

/**
 * The day's note must be one warm line. AI models occasionally wrap JSON
 * strings, so this collapses every run of whitespace (including newlines)
 * into a single space and keeps only the first sentence — the UI can then
 * always show one calm line, never a wrapped paragraph.
 */
function normalizeNote(raw: unknown, fallback: string): string {
  const collapsed = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!collapsed) return fallback;
  const firstSentence = collapsed.split(/(?<=[.!?])\s+/)[0].trim();
  const MAX_LENGTH = 140;
  if (firstSentence.length <= MAX_LENGTH) return firstSentence;
  return `${firstSentence.slice(0, MAX_LENGTH).trimEnd().replace(/[.,;|]+$/, '')}…`;
}

export async function generateDailyRecoveryPlan(ctx: RecoveryPlanContext): Promise<DailyRecoveryPlan> {
  const prompt = `Create a gentle, optional daily recovery plan for a stressed student.
Today is ${ctx.date}. Their real free windows are: ${ctx.slots.length > 0 ? ctx.slots.map(s => `${s.start}-${s.end} (${s.minutes} min)`).join(', ') : 'none found'}.
Weekly capacity used: ${ctx.capacityPct}%${ctx.overloaded ? ' (heavy week)' : ''}.
Latest stress: ${ctx.stressScore ?? 'unknown'}/100. Baseline: ${ctx.baseline ?? 'unknown'}/100.
Already done today: ${ctx.completedToday.length > 0 ? ctx.completedToday.join(', ') : 'nothing yet'}.

Reply with STRICT JSON:
{
  "note": "ONE short line only (single sentence, 8-18 words, no line breaks): warm and uplifting, something that lets a stressed student put the shoulders down and breathe — encouraging relief, never pressure. Examples of the tone: 'Whatever today held, there is still room for a softer breath.' / 'One small kindness to yourself is plenty.'",
  "suggestions": [
    {
      "id": "unique-slug",
      "emoji": "one emoji",
      "title": "15-45 char gentle activity title",
      "detail": "one gentle sentence, optional and kind",
      "minutes": 5-45 matching a free window's length,
      "targetType": "steps" for walking plans, otherwise "minutes",
      "targetValue": number (target action: for steps 500-5000 real steps, for minutes the same length as "minutes"),
      "reason": "one soft sentence tied to their real situation"
    }
  ]
}
Rules: 3 suggestions max. Every suggestion must fit one of their free windows. For walking plans prefer a real step target (500-5000) that feels reachable today. Never use 'must', 'should', 'streak', 'complete this', 'don't break'. If there are no free windows, suggest only 1-2 micro-pauses (5 min) that fit anywhere.
OUTPUT STRICT VALID JSON ONLY (no markdown fences).`;

  const rawAi = await callAI(prompt, 'You are a kind, low-pressure recovery companion for stressed students.');
  if (rawAi) {
    try {
      const clean = rawAi.trim().replace(/^```(?:json)?/, '').replace(/```$/, '').trim();
      const parsed = JSON.parse(clean);
      if (parsed && Array.isArray(parsed.suggestions)) {
        const suggestions: RecoverySuggestion[] = parsed.suggestions
          .slice(0, 3)
          .map((s: any, idx: number) => {
            const minutes = Number(s.minutes) || 10;
            const targetType = normalizeTargetType(s.targetType);
            return {
              id: String(s.id || `ai-${idx}`),
              emoji: String(s.emoji || '🌿'),
              title: String(s.title || 'A small pause'),
              detail: String(s.detail || ''),
              minutes,
              reason: String(s.reason || 'It just might feel nice.'),
              targetType,
              targetValue: clampTarget(targetType, minutes, Number(s.targetValue)),
              slot: ctx.slots.find((slot) => slot.minutes >= minutes),
            };
          });
        return {
          date: ctx.date,
          slots: ctx.slots,
          suggestions: suggestions.length > 0 ? suggestions : heuristicSuggestions(ctx),
          note: normalizeNote(parsed.note, 'Here is one idea at a time. Take whatever feels okay.'),
        };
      }
    } catch (e) {
      console.error('Failed to parse AI recovery plan, using local heuristic:', e);
    }
  }
  return { date: ctx.date, slots: ctx.slots, suggestions: heuristicSuggestions(ctx), note: normalizeNote(heuristicNote(ctx), 'Here are ideas, never obligations.') };
}

function heuristicNote(ctx: RecoveryPlanContext): string {
  if (ctx.overloaded) return 'This week is carrying a lot. Even one tiny pause can soften it.';
  if ((ctx.stressScore ?? 50) >= 60) return 'Things feel heavier than usual. A small reset might help.';
  return 'You have some open time today. Here are ideas, not obligations.';
}

function heuristicSuggestions(ctx: RecoveryPlanContext): RecoverySuggestion[] {
  const taken = ctx.completedToday;
  const pool = GENTLE_ACTIVITIES.filter((a) => !taken.includes(a.id) && a.minutes <= (ctx.slots[0]?.minutes ?? a.minutes));
  const picks = pool.slice(0, 3);
  return picks.length > 0
    ? picks.map((a) => ({
        id: a.id,
        emoji: a.emoji,
        title: a.title,
        detail: a.detail,
        minutes: a.minutes,
        targetType: a.targetType,
        targetValue: a.targetValue,
        reason: ctx.overloaded ? 'A tiny reset can soften a heavy week.' : 'You deserve a gentle pause.',
        slot: ctx.slots.find((s) => s.minutes >= a.minutes),
      }))
    : [
        {
          id: 'breath',
          emoji: '🌬️',
          title: 'A slow minute of breathing',
          detail: 'In for four, out for four, wherever you are.',
          minutes: 5,
          targetType: 'minutes',
          targetValue: 5,
          reason: 'A tiny reset can soften a heavy week.',
          slot: ctx.slots[0],
        },
      ];
}

