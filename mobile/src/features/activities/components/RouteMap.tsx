import { useEffect, useMemo, useState } from 'react';
import { Image, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { LatLng } from '@trainingai/shared/activity/scrub';
import type { RouteZoneRun } from '@trainingai/shared/activity/route-hr-zones';
import { AppText } from '../../../shared/ui/AppText';
import { useTheme } from '../../../shared/theme/ThemeProvider';
import { MAP_ATTRIBUTION, loadTile } from '../data/map-tiles';
import { routeFrame, tilesFor } from '../data/route-shape';

// The current app's ActivityRouteMap (components/activity/activity-route-map.tsx): the route as a
// 4 px line, coloured by heart-rate zone when there is HR to colour it by, a green start, a red
// finish and, while the chart above is scrubbed, a brand dot where that moment happened. It draws
// from the points the phone already holds, so it works offline. Under it sit OpenStreetMap tiles
// when every tile the box needs is on the phone or can be fetched; otherwise (offline, first view)
// a plain panel, so the route is never lost with the signal (#3161).
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
  const tiles = useMemo(() => (frame ? tilesFor(frame, width, HEIGHT) : []), [frame, width]);
  const [loaded, setLoaded] = useState<{ key: string; uris: string[] } | null>(null);
  const tilesKey = tiles.map((t) => `${t.z}/${t.x}/${t.y}`).join(',');
  useEffect(() => {
    if (!tiles.length) return;
    const controller = new AbortController();
    void Promise.all(tiles.map((t) => loadTile(t, controller.signal))).then((uris) => {
      // All or nothing: a map with holes in it is worse than the plain panel.
      if (!controller.signal.aborted && uris.every((uri) => uri))
        setLoaded({ key: tilesKey, uris: uris as string[] });
    });
    return () => controller.abort();
    // tilesKey names the tile set; tiles itself changes identity with every layout.
  }, [tilesKey]);
  const mapUris = loaded?.key === tilesKey ? loaded.uris : null;
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
      {mapUris &&
        tiles.map((tile, index) => (
          <Image
            key={`${tile.z}/${tile.x}/${tile.y}`}
            source={{ uri: mapUris[index] }}
            style={{
              position: 'absolute',
              left: tile.left,
              top: tile.top,
              width: tile.size,
              height: tile.size,
            }}
          />
        ))}
      {frame && start && end && (
        <Svg width={width} height={HEIGHT} style={{ position: 'absolute' }}>
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
      {mapUris && (
        // OpenStreetMap tiles are light in either theme, so the credit is fixed dark-on-light.
        <AppText
          variant="caption"
          style={{
            position: 'absolute',
            right: 4,
            bottom: 2,
            color: '#333',
            backgroundColor: 'rgba(255,255,255,0.7)',
            paddingHorizontal: 3,
          }}
        >
          {MAP_ATTRIBUTION}
        </AppText>
      )}
    </View>
  );
}
