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
  CalendarEventItem,
  LoadBalanceSuggestion,
  TaskAnalysis,
  WeeklyCapacityAnalysis,
} from '@/data/types';

const OPENROUTER_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY;

/* ── AI Callers ─────────────────────────────────────────────────── */

async function callOpenRouter(prompt: string, systemPrompt?: string): Promise<string | null> {
  if (!OPENROUTER_KEY) return null;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://wick.app',
        'X-Title': 'Wick Stress & Workload',
      },
      body: JSON.stringify({
        model: 'nex-agi/nex-n2.5-pro:free',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      console.warn(`OpenRouter HTTP ${res.status}:`, await res.text());
      return null;
    }
    const json = await res.json();
    return json?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    console.warn('OpenRouter request failed, falling back to local NLP:', err);
    return null;
  }
}

async function callGeminiDirect(prompt: string, systemInstruction?: string): Promise<string | null> {
  if (!GEMINI_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_KEY}`;
    const body: any = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`Gemini Direct HTTP ${res.status}:`, await res.text());
      return null;
    }
    const json = await res.json();
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (err) {
    console.warn('Gemini request failed, falling back to local NLP:', err);
    return null;
  }
}

async function callAI(prompt: string, systemPrompt?: string): Promise<string | null> {
  if (OPENROUTER_KEY) {
    const response = await callOpenRouter(prompt, systemPrompt);
    if (response) return response;
  }
  if (GEMINI_KEY) {
    const response = await callGeminiDirect(prompt, systemPrompt);
    if (response) return response;
  }
  return null;
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

/* ── Public AI API Functions ──────────────────────────────────────────────── */

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
  - category: a short, descriptive category name (dynamically determined based on the event context, but reuse existing category names where applicable to keep the total number of unique categories under 6)
  - priority: one of ["high", "medium", "low"]
  - estimated_duration_hours: number (0.5 to 8)
  - stress_score: number (0 to 100)
  - rank: number (1 is highest priority/urgency)
  - ai_reasoning: short sentence explaining why this task has this rank and priority

  Guidelines for category:
  - Do not use a fixed list of categories.
  - Invent intuitive, concise category names (1-2 words, e.g., "Engineering", "Health", "Social") as needed.
  - Group similar events together by intentionally reusing category names across multiple items instead of creating a new category for every single event.

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
          const start = original ? new Date(original.startDate) : new Date();
          const end = original?.endDate ? new Date(original.endDate) : undefined;
          return {
            id: item.id || `task-${idx}-${Date.now()}`,
            title: item.title || original?.title || 'Untitled Task',
            category: item.category || 'academic',
            priority: item.priority || 'medium',
            estimated_duration_hours: Number(item.estimated_duration_hours) || 1,
            scheduled_date: start.toISOString().split('T')[0],
            scheduled_start_time: start.toTimeString().slice(0, 5),
            scheduled_end_time: end ? end.toTimeString().slice(0, 5) : undefined,
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
      console.warn('Failed to parse AI output, proceeding with deterministic heuristic:', e);
    }
  }

  // Fallback: Deterministic NLP Heuristic Engine
  const mapped = events.map((ev, index) => {
    const start = new Date(ev.startDate);
    const end = ev.endDate ? new Date(ev.endDate) : null;
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
      scheduled_date: start.toISOString().split('T')[0],
      scheduled_start_time: start.toTimeString().slice(0, 5),
      scheduled_end_time: end ? end.toTimeString().slice(0, 5) : undefined,
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

  // Calculate category breakdown percentages
  const catHours: Record<string, number> = {};
  for (const t of tasks) {
    const c = t.category || 'academic';
    catHours[c] = (catHours[c] || 0) + (Number(t.estimated_duration_hours) || 1);
  }

  const breakdown: Record<string, number> = {};
  for (const [c, h] of Object.entries(catHours)) {
    breakdown[c] = usedCapacityHours > 0 ? Math.round((h / usedCapacityHours) * 100) : 0;
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
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1);

  return {
    week_start: weekStart.toISOString().split('T')[0],
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
        return {
          title: parsed.title,
          category: parsed.category || 'academic',
          priority: parsed.priority || 'medium',
          estimated_duration_hours: Number(parsed.estimated_duration_hours) || 1,
          scheduled_date: parsed.scheduled_date || new Date().toISOString().split('T')[0],
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
      console.warn('AI NLP parse error, falling back to local heuristic:', e);
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
    scheduled_date: targetDate.toISOString().split('T')[0],
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

  // Find lower-priority or flexible tasks that can be deferred
  const deferrable = tasks.filter(
    (t) =>
      t.status !== 'completed' &&
      t.status !== 'deferred' &&
      (t.priority === 'low' || t.priority === 'medium') &&
      (t.category === 'errands' || t.category === 'academic' || t.category === 'work')
  );

  // Sort lowest priority first
  deferrable.sort((a, b) => {
    if (a.priority === 'low' && b.priority !== 'low') return -1;
    if (b.priority === 'low' && a.priority !== 'low') return 1;
    return (b.estimated_duration_hours || 1) - (a.estimated_duration_hours || 1);
  });

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

