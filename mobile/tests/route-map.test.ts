import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeRoute, decodeRoute } from '@trainingai/shared/activity/route-encoding';
import { estimateDistanceKmAtTime, pointAtDistanceKm } from '@trainingai/shared/activity/scrub';
import { routeFrame, tilesFor } from '../src/features/activities/data/route-shape.ts';
import { tileFileName, tileUrl } from '../src/features/activities/data/map-tiles.ts';
import { activityHistorySpec } from '../src/features/health/data/models.ts';

// A 1 km out-and-back loop in Brisbane: east along a street, north, then back west.
const loop = [
  { lat: -27.47, lng: 153.02 },
  { lat: -27.47, lng: 153.025 },
  { lat: -27.466, lng: 153.025 },
  { lat: -27.466, lng: 153.02 },
];

test('the route fits its box with padding and keeps its true shape', () => {
  const frame = routeFrame(loop, 344, 224, 20)!;
  const xy = loop.map(frame.project);
  for (const { x, y } of xy) {
    assert.ok(x >= 20 - 1e-9 && x <= 324 + 1e-9, `x ${x} inside the padding`);
    assert.ok(y >= 20 - 1e-9 && y <= 204 + 1e-9, `y ${y} inside the padding`);
  }
  // North is up and east is right.
  assert.ok(xy[1].x > xy[0].x);
  assert.ok(xy[2].y < xy[1].y);
  // Metres east and north scale alike: 0.005° of longitude at 27.5° S is about 493 m, 0.004° of
  // latitude about 445 m, so the drawn sides keep that ratio rather than the raw degrees' 5:4.
  const ratio = (xy[1].x - xy[0].x) / (xy[1].y - xy[2].y);
  assert.ok(Math.abs(ratio - 493 / 445) < 0.01, `ratio ${ratio}`);
  // The taller side fills the height; the narrower one is centred.
  assert.ok(Math.abs(xy[1].y - xy[2].y - 184) < 1e-6);
  assert.ok(Math.abs((xy[0].x + xy[1].x) / 2 - 172) < 1e-6);
  assert.match(frame.path(loop), /^M[\d.]+ [\d.]+ L/);
});

test('a route with no extent lands in the middle, and fewer than two points draw nothing', () => {
  const still = routeFrame([loop[0], loop[0], loop[0]], 300, 200, 20)!;
  assert.deepEqual(still.project(loop[0]), { x: 150, y: 100 });
  assert.equal(routeFrame([loop[0]], 300, 200, 20), null);
  assert.equal(routeFrame(loop, 0, 224, 20), null);
});

test('an activity keeps its encoded route, and older rows without one still parse', () => {
  const routePolyline = encodeRoute(loop);
  const parsed = activityHistorySpec.schema.parse({
    activityLogs: [
      { id: 'a', date: '2026-10-20', activityType: 'walk', routePolyline },
      { id: 'b', date: '2026-10-20', activityType: 'walk' },
    ],
  });
  assert.equal(parsed.activityLogs[0].routePolyline, routePolyline);
  assert.equal(decodeRoute(parsed.activityLogs[0].routePolyline!).length, loop.length);
  assert.equal(parsed.activityLogs[1].routePolyline, undefined);
});

test('scrubbing the chart places the marker along the route by the pace series', () => {
  const points = decodeRoute(encodeRoute(loop));
  // 6 min/km throughout: after 3 minutes, half a kilometre along, which is the first corner's
  // neighbourhood (the first side is about 493 m long).
  const paceSeries = [{ tSec: 600, paceSec: 360 }];
  const km = estimateDistanceKmAtTime(paceSeries, 3 * 60);
  assert.ok(Math.abs(km - 0.5) < 1e-9);
  const marker = pointAtDistanceKm(points, km)!;
  assert.ok(Math.abs(marker.lng - 153.025) < 0.0002, `lng ${marker.lng}`);
  assert.ok(marker.lat > -27.47 && marker.lat < -27.4695, `lat ${marker.lat}`);
  // At the start the marker sits on the green start dot.
  assert.deepEqual(pointAtDistanceKm(points, estimateDistanceKmAtTime(paceSeries, 0)), points[0]);
});

test('map tiles cover the box and line up with the drawn route', () => {
  const frame = routeFrame(loop, 344, 224, 20)!;
  const tiles = tilesFor(frame, 344, 224);
  assert.ok(tiles.length >= 1 && tiles.length <= 16);
  assert.ok(tiles.every((t) => t.z === tiles[0].z && t.size <= 512 + 1e-6 && t.size > 128));
  // Together they span the whole box.
  assert.ok(Math.min(...tiles.map((t) => t.left)) <= 0);
  assert.ok(Math.min(...tiles.map((t) => t.top)) <= 0);
  assert.ok(Math.max(...tiles.map((t) => t.left + t.size)) >= 344);
  assert.ok(Math.max(...tiles.map((t) => t.top + t.size)) >= 224);
  // The tile holding the first fix really contains its pixel.
  const { x, y } = frame.project(loop[0]);
  assert.ok(tiles.some((t) => x >= t.left && x <= t.left + t.size && y >= t.top && y <= t.top + t.size));
  assert.equal(tileUrl({ z: 17, x: 120, y: 75 }), 'https://tile.openstreetmap.org/17/120/75.png');
  assert.equal(tileFileName({ z: 17, x: 120, y: 75 }), '17-120-75.png');
});

test('a route with no extent asks for no tiles', () => {
  const still = routeFrame([loop[0], loop[0]], 300, 200, 20)!;
  assert.deepEqual(tilesFor(still, 300, 200), []);
});
