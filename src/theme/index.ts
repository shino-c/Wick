/**
 * Wick design tokens — taken from the Figma swatch set.
 * Every screen pulls colour/spacing/type from here; nothing hardcodes a hex.
 */

export const colors = {
  /** Page background — warm cream. */
  cream: '#FFFBEB',
  /** Card surface, sits on cream. */
  surface: '#FFFFFF',
  /** Highlight / primary accent — the soft yellow. */
  yellow: '#FDF1A9',
  yellowDeep: '#F2DE7A',
  yellowWash: '#FEF8D6',
  /** Primary action + brand brown. */
  brown: '#6B5038',
  brownSoft: '#8C6E50',
  /** Ink. */
  ink: '#3D3A34',
  inkSoft: '#6E6A61',
  inkFaint: '#9A968C',
  /** Hairlines. */
  line: '#EDE7D6',
  lineStrong: '#DED6BF',

  /** Semantic — stress states. Muted on purpose: this is a calming app. */
  calm: '#5B9E7E',
  calmWash: '#E6F2EB',
  warn: '#D9A441',
  warnWash: '#FBF1DC',
  alert: '#C2624C',
  alertWash: '#F8E8E3',

  /** Dark surface used by the full-screen focus / escalation states. */
  night: '#22201C',
  nightSoft: '#33302A',
  nightLine: '#45413A',
  onNight: '#F5F1E4',
  onNightSoft: '#A9A396',
} as const;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const spacing = (n: number) => n * 4;

export const font = {
  regular: 'Rubik_400Regular',
  medium: 'Rubik_500Medium',
  semibold: 'Rubik_600SemiBold',
  bold: 'Rubik_700Bold',
} as const;

export const type = {
  display: { fontFamily: font.semibold, fontSize: 34, letterSpacing: -0.6 },
  title: { fontFamily: font.semibold, fontSize: 22, letterSpacing: -0.3 },
  heading: { fontFamily: font.medium, fontSize: 16, letterSpacing: -0.1 },
  body: { fontFamily: font.regular, fontSize: 14, lineHeight: 20 },
  small: { fontFamily: font.regular, fontSize: 12, lineHeight: 17 },
  /** All-caps eyebrow used above cards and on the nav bars. */
  eyebrow: { fontFamily: font.medium, fontSize: 10, letterSpacing: 1.6 },
  mono: { fontFamily: font.medium, fontSize: 13, letterSpacing: 0.4 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#6B5038',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;

/** Colour for a stress bucket, so the badge can never disagree with the number. */
export function stressColor(score: number) {
  if (score < 30) return { fg: colors.calm, bg: colors.calmWash };
  if (score < 60) return { fg: colors.warn, bg: colors.warnWash };
  return { fg: colors.alert, bg: colors.alertWash };
}
