import type { LatLng } from '@trainingai/shared/activity/scrub';

export type RouteFrame = {
  // Where a point lands in the box, in pixels from its top-left.
  project: (point: LatLng) => { x: number; y: number };
  // An SVG path through the points, in the same pixels.
  path: (points: LatLng[]) => string;
  // The same box in Web Mercator world units (0..1 across the whole map), so map tiles can sit
  // under the line: where a world point lands in pixels, the reverse, and pixels per world unit.
  worldToPixel: (u: number, v: number) => { x: number; y: number };
  pixelToWorld: (x: number, y: number) => { u: number; v: number };
  pixelsPerWorld: number;
};

// Web Mercator, as OpenStreetMap tiles use: u runs east and v south, both 0..1 over the world.
export function toWorld(p: LatLng) {
  const lat = Math.max(-85.0511, Math.min(85.0511, p.lat));
  const sin = Math.sin((lat * Math.PI) / 180);
  return { u: (p.lng + 180) / 360, v: 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI) };
}

// Fits a route into a width × height box with `padding` on every side, keeping its true shape:
// points go through Web Mercator, the projection the current app's Leaflet map and the tiles use,
// and the shorter side is centred. A route with no extent (every fix on the same spot) lands in
// the middle. Null for fewer than two points: there is no route to draw.
export function routeFrame(
  points: LatLng[],
  width: number,
  height: number,
  padding: number,
): RouteFrame | null {
  if (points.length < 2 || width <= padding * 2 || height <= padding * 2) return null;
  const world = points.map(toWorld);
  const minX = Math.min(...world.map((w) => w.u));
  const minY = Math.min(...world.map((w) => w.v));
  const spanX = Math.max(...world.map((w) => w.u)) - minX;
  const spanY = Math.max(...world.map((w) => w.v)) - minY;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(spanX ? innerW / spanX : Infinity, spanY ? innerH / spanY : Infinity);
  const k = Number.isFinite(scale) ? scale : 0;
  const offsetX = padding + (innerW - spanX * k) / 2;
  const offsetY = padding + (innerH - spanY * k) / 2;
  const worldToPixel = (u: number, v: number) => ({
    x: offsetX + (u - minX) * k,
    y: offsetY + (v - minY) * k,
  });
  const project = (p: LatLng) => {
    const w = toWorld(p);
    return worldToPixel(w.u, w.v);
  };
  return {
    project,
    worldToPixel,
    pixelToWorld: (x, y) =>
      k ? { u: minX + (x - offsetX) / k, v: minY + (y - offsetY) / k } : { u: minX, v: minY },
    pixelsPerWorld: k,
    path: (line) =>
      line
        .map((p, i) => {
          const { x, y } = project(p);
          return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' '),
  };
}

export type MapTile = { z: number; x: number; y: number; left: number; top: number; size: number };

const MAX_TILES = 16;

// The OpenStreetMap tiles that cover the box, each with where it sits in pixels. The zoom is the
// lowest one whose tiles are no bigger than 512 px, so a phone-width box needs a handful of tiles.
// Empty when the route has no extent to zoom to.
export function tilesFor(frame: RouteFrame, width: number, height: number): MapTile[] {
  const k = frame.pixelsPerWorld;
  if (!k) return [];
  let z = Math.max(0, Math.min(18, Math.ceil(Math.log2(k / 512))));
  for (;;) {
    const n = 2 ** z;
    const a = frame.pixelToWorld(0, 0);
    const b = frame.pixelToWorld(width, height);
    const x0 = Math.max(0, Math.floor(a.u * n));
    const x1 = Math.min(n - 1, Math.floor(b.u * n));
    const y0 = Math.max(0, Math.floor(a.v * n));
    const y1 = Math.min(n - 1, Math.floor(b.v * n));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES && z > 0) {
      z -= 1;
      continue;
    }
    const tiles: MapTile[] = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const { x: left, y: top } = frame.worldToPixel(x / n, y / n);
        tiles.push({ z, x, y, left, top, size: k / n });
      }
    }
    return tiles;
  }
}
