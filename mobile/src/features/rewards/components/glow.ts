import type { ViewStyle } from 'react-native';

/** achievements-grid.tsx / level-sheet.tsx `box-shadow: 0 0 Npx colour`; Android draws it as elevation. */
export function glow(color: string, radius: number, opacity = 0.5): ViewStyle {
  return {
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: radius,
    shadowOffset: { width: 0, height: 0 },
    elevation: Math.round(radius / 2),
  };
}
