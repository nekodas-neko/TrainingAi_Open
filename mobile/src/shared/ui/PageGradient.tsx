import { useId } from 'react';
import { StyleSheet, View } from 'react-native';
import { gradientStops } from './gradientStops';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

/** A top-to-bottom gradient filling its parent, behind everything else. */
export function PageGradient({ css }: { css: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0%" y1="0%" x2="0%" y2="100%">
            {gradientStops(css).map((stop, index) => (
              <Stop
                key={index}
                offset={stop.offset}
                stopColor={stop.color}
                stopOpacity={stop.opacity}
              />
            ))}
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}
