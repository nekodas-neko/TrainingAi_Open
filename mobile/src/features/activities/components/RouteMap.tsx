import { useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { LatLng } from '@trainingai/shared/activity/scrub';
import type { RouteZoneRun } from '@trainingai/shared/activity/route-hr-zones';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { routeFrame } from '../data/route-shape';

// The current app's ActivityRouteMap (components/activity/activity-route-map.tsx): the route as a
// 4 px line, coloured by heart-rate zone when there is HR to colour it by, a green start, a red
// finish and, while the chart above is scrubbed, a brand dot where that moment happened. It draws
// from the points the phone already holds, so it works offline. What sits under the line, map tiles
// or a plain panel, waits on the owner's call (#3161); until then it is the plain panel.
const HEIGHT = 224;
const PADDING = 20;

export function RouteMap({
  points,
  activePoint = null,
  zoneSegments = null,
}: {
  points: LatLng[];
  activePoint?: LatLng | null;
  zoneSegments?: RouteZoneRun[] | null;
}) {
  const { theme } = useTheme();
  const [width, setWidth] = useState(0);
  const frame = useMemo(() => routeFrame(points, width, HEIGHT, PADDING), [points, width]);
  // The shared builder names the brand colour the CSS way for a reading-less run.
  const colour = (value: string) => (value.startsWith('var(') ? theme.colors.brand : value);
  const start = frame?.project(points[0]);
  const end = frame?.project(points[points.length - 1]);
  const active = frame && activePoint ? frame.project(activePoint) : null;
  return (
    <View
      accessibilityLabel={`Route map, ${points.length} GPS points`}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={{
        height: HEIGHT,
        borderRadius: theme.radii.control,
        overflow: 'hidden',
        backgroundColor: theme.colors.raised,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      {frame && start && end && (
        <Svg width={width} height={HEIGHT}>
          {zoneSegments?.length ? (
            zoneSegments.map((run, index) => (
              <Path
                key={index}
                d={frame.path(run.positions)}
                fill="none"
                stroke={colour(run.color)}
                strokeWidth={4}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))
          ) : (
            <Path
              d={frame.path(points)}
              fill="none"
              stroke={theme.colors.brand}
              strokeWidth={4}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          <Circle cx={start.x} cy={start.y} r={6} fill={theme.status.success} />
          <Circle cx={end.x} cy={end.y} r={6} fill={theme.status.danger} />
          {active && (
            <Circle
              cx={active.x}
              cy={active.y}
              r={8}
              fill={theme.colors.brand}
              stroke={theme.colors.background}
              strokeWidth={2}
            />
          )}
        </Svg>
      )}
    </View>
  );
}
