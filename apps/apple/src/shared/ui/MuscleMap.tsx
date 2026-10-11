import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { normalizeMuscle } from '@trainingai/shared/muscles';
import { muscleGeometry } from '../assets/muscleGeometry';
import { useTheme } from '../theme/ThemeProvider';

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

export function MuscleMap({ assignments }: { assignments: readonly MuscleActivation[] }) {
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
        <View
          key={side}
          style={{ flex: 1, minWidth: 0, justifyContent: 'center', overflow: 'hidden' }}
        >
          <View style={{ width: '100%', aspectRatio: 0.5, flexShrink: 0 }}>
            <Svg
              width="100%"
              height="100%"
              viewBox={side === 'front' ? '0 0 724 1448' : '724 0 724 1448'}
              preserveAspectRatio="xMidYMid meet"
            >
              {muscleGeometry[side].flatMap((part) =>
                part.paths.map((path, index) => (
                  <Path
                    key={`${part.slug}-${index}`}
                    d={path}
                    fill={
                      colors.get(part.slug) ??
                      (part.slug === 'head' ? theme.anatomy.head : theme.anatomy.untrained)
                    }
                    stroke={theme.anatomy.outline}
                    strokeWidth={0.5}
                  />
                )),
              )}
            </Svg>
          </View>
        </View>
      ))}
    </View>
  );
}
