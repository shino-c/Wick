/**
 * Perceived-stress questionnaire (Pillar 3 baseline).
 *
 * Five items adapted from the Perceived Stress Scale short form, worded for the
 * last week. Two items are positively worded and reverse-scored, which is what
 * stops people straight-lining down one column.
 *
 * Normalisation follows the shared rule: (raw_sum / max_possible_sum) * 100, so
 * the result lands on the same 0–100 scale as the biometric and load signals
 * and can be fused without any further conversion.
 */

export interface Item {
  id: string;
  prompt: string;
  /** Positively worded — a high answer means LESS stress. */
  reverse?: boolean;
}

export const LIKERT = ['Never', 'Almost never', 'Sometimes', 'Fairly often', 'Very often'] as const;
const MAX_PER_ITEM = LIKERT.length - 1;

export const ITEMS: Item[] = [
  { id: 'q1', prompt: 'In the last week, how often have you felt unable to control the important things in your life?' },
  { id: 'q2', prompt: 'How often have you felt confident about your ability to handle your problems?', reverse: true },
  { id: 'q3', prompt: 'How often have you felt that things were going your way?', reverse: true },
  { id: 'q4', prompt: 'How often have you felt difficulties were piling up so high you could not overcome them?' },
  { id: 'q5', prompt: 'How often have you felt drained by your schedule, even after resting?' },
];

/** @returns 0–100, where 100 is maximum perceived stress. */
export function scoreQuestionnaire(answers: Record<string, number>): number {
  let sum = 0;
  for (const item of ITEMS) {
    const raw = answers[item.id] ?? 0;
    sum += item.reverse ? MAX_PER_ITEM - raw : raw;
  }
  return Math.round((sum / (ITEMS.length * MAX_PER_ITEM)) * 1000) / 10;
}

/* ── 1-tap quick stress flag ──────────────────────────────────────── */

export interface QuickFlag {
  emoji: string;
  label: string;
  score: number;
}

/**
 * The quick flag feeds the same calibration loop as the questionnaire, so it
 * has to land on the same 0–100 scale. It is weighted a little toward the
 * extremes because people reach for it when something is noticeably off.
 */
export const QUICK_FLAGS: QuickFlag[] = [
  { emoji: '🧘', label: 'Calm', score: 8 },
  { emoji: '🙂', label: 'Fine', score: 28 },
  { emoji: '😐', label: 'Tense', score: 48 },
  { emoji: '😰', label: 'Stressed', score: 72 },
  { emoji: '🔥', label: 'Overloaded', score: 92 },
];

/** Onboarding slider — a coarse first read before the full questionnaire. */
export function sliderLabel(score: number): string {
  if (score < 20) return 'Relaxed';
  if (score < 40) return 'Mostly steady';
  if (score < 60) return 'Mildly tense';
  if (score < 80) return 'Stressed';
  return 'Very stressed';
}
