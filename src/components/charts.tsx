import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop, Line as SvgLine } from 'react-native-svg';
import { colors } from '@/theme';
import { Txt } from './base';

/** Build a smooth-ish path (Catmull-Rom → bezier) through evenly spaced points. */
function buildPath(values: number[], w: number, h: number, pad = 4) {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({
    x: pad + i * stepX,
    y: pad + (1 - (v - min) / span) * (h - pad * 2),
  }));
  if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;

  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function Sparkline({
  values,
  width = 280,
  height = 72,
  color = colors.brown,
  fill = false,
  markerIndex,
  markerColor = colors.alert,
  baseline,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  /** Draws a vertical tick — used to mark the enforced-break moment on the session curve. */
  markerIndex?: number;
  markerColor?: string;
  /** Optional dashed comparison line (e.g. the 7-day expected trajectory). */
  baseline?: number[];
}) {
  if (values.length < 2) {
    return <View style={{ width, height }} />;
  }
  const d = buildPath(values, width, height);
  const area = `${d} L ${width - 4} ${height} L 4 ${height} Z`;
  const markerX =
    markerIndex != null ? 4 + (markerIndex / (values.length - 1)) * (width - 8) : null;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={color} stopOpacity={0.22} />
          <Stop offset="1" stopColor={color} stopOpacity={0} />
        </LinearGradient>
      </Defs>
      {fill && <Path d={area} fill="url(#spark)" />}
      {baseline && baseline.length === values.length && (
        <Path
          d={buildPath(baseline, width, height)}
          stroke={colors.inkFaint}
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="none"
        />
      )}
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinecap="round" />
      {markerX != null && (
        <SvgLine
          x1={markerX}
          y1={2}
          x2={markerX}
          y2={height - 2}
          stroke={markerColor}
          strokeWidth={1.5}
          strokeDasharray="3 3"
        />
      )}
    </Svg>
  );
}

/** Circular progress ring — the focus timer and the breathing pacer both use it. */
export function Ring({
  progress,
  size = 220,
  stroke = 8,
  color = colors.yellow,
  track = colors.nightLine,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - clamped)}
        />
      </Svg>
      {children}
    </View>
  );
}

/** Seven dots, one per weekday — the Circles weekly grid. */
export function DotWeek({ tones, labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] }: { tones: string[]; labels?: string[] }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      {tones.map((t, i) => (
        <View key={i} style={{ alignItems: 'center', gap: 6 }}>
          <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: t }} />
          <Txt v="small" color={colors.inkFaint}>
            {labels[i] ?? ''}
          </Txt>
        </View>
      ))}
    </View>
  );
}
