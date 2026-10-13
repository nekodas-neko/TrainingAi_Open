import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { normalizeMuscle } from '@trainingai/shared/muscles';
import { muscleGeometry } from '../assets/muscleGeometry';
import { useTheme } from '../theme/ThemeProvider';
import { Skeleton } from './Skeleton';

export type MuscleActivation = { muscle: string; role: 'main' | 'secondary' | 'injured' };
const slugs: Record<string, string> = {
  chest: 'chest',
  shoulders: 'deltoids',
  biceps: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm',
  abs: 'abs',
  obliques: 'obliques',
  'hip flexors': 'abs',
  quads: 'quadriceps',
  adductors: 'adductors',
  calves: 'calves',
  traps: 'trapezius',
  'upper back': 'upper-back',
  back: 'upper-back',
  lats: 'upper-back',
  'lower back': 'lower-back',
  glutes: 'gluteal',
  hamstrings: 'hamstring',
};

const figures = {
  front: muscleGeometry.front.map((part) => ({ slug: part.slug, path: part.paths.join(' ') })),
  back: muscleGeometry.back.map((part) => ({ slug: part.slug, path: part.paths.join(' ') })),
};

function MuscleFigure({
  side,
  colors,
  fit,
}: {
  side: keyof typeof figures;
  colors: Map<string, string>;
  fit: 'width' | 'contain';
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!width || ready) {
      return;
    }
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setReady(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [width, ready]);
  return (
    <View
      style={{ flex: 1, minWidth: 0, minHeight: 0, justifyContent: 'center', overflow: 'hidden' }}
    >
      <View
        style={
          fit === 'contain'
            ? { width: '100%', height: '100%' }
            : { width: '100%', aspectRatio: 0.5, flexShrink: 0 }
        }
        onLayout={(event) => {
          const next = event.nativeEvent.layout.width;
          if (next > 0) {
            setWidth(next);
          }
        }}
      >
        {width > 0 && (
          <Svg
            width="100%"
            height="100%"
            viewBox={side === 'front' ? '0 0 724 1448' : '724 0 724 1448'}
            preserveAspectRatio="xMidYMid meet"
          >
            {figures[side].map((part) => (
              <Path
                key={part.slug}
                d={part.path}
                fill={
                  colors.get(part.slug) ??
                  (part.slug === 'head' ? theme.anatomy.head : theme.anatomy.untrained)
                }
                stroke={theme.anatomy.outline}
                strokeWidth={0.5}
              />
            ))}
          </Svg>
        )}
        {!ready && (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { alignItems: 'center', gap: theme.spacing.sm }]}
          >
            <Skeleton style={{ width: '22%', height: '12%', borderRadius: theme.radii.pill }} />
            <Skeleton style={{ width: '65%', height: '40%' }} />
            <View
              style={{ width: '50%', flex: 1, flexDirection: 'row', gap: theme.spacing.sm }}
            >
              <Skeleton style={{ flex: 1 }} />
              <Skeleton style={{ flex: 1 }} />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

export const MuscleMap = memo(
  function MuscleMap({
    assignments,
    fit = 'width',
  }: {
    assignments: readonly MuscleActivation[];
    fit?: 'width' | 'contain';
  }) {
    const { theme } = useTheme();
    const colors = new Map<string, string>();
    for (const assignment of assignments) {
      const slug = slugs[normalizeMuscle(assignment.muscle)];
      if (slug && (assignment.role !== 'secondary' || !colors.has(slug))) {
        colors.set(slug, theme.anatomy[assignment.role]);
      }
    }
    return (
      <View
        accessible
        accessibilityLabel={`Session muscles: ${assignments.map((item) => `${item.muscle}, ${item.role}`).join('; ') || 'unavailable'}`}
        style={{ flex: 1, minHeight: 0, flexDirection: 'row', gap: theme.spacing.lg }}
      >
        {(['front', 'back'] as const).map((side) => (
          <MuscleFigure key={side} side={side} colors={colors} fit={fit} />
        ))}
      </View>
    );
  },
  (previous, next) =>
    (previous.fit ?? 'width') === (next.fit ?? 'width') &&
    previous.assignments.length === next.assignments.length &&
    previous.assignments.every(
      (item, index) =>
        item.muscle === next.assignments[index].muscle &&
        item.role === next.assignments[index].role,
    ),
);
