import type { LatLng } from '@trainingai/shared/activity/scrub';

export type RouteFrame = {
  // Where a point lands in the box, in pixels from its top-left.
  project: (point: LatLng) => { x: number; y: number };
  // An SVG path through the points, in the same pixels.
  path: (points: LatLng[]) => string;
};

// Fits a route into a width × height box with `padding` on every side, keeping its true shape:
// longitude is scaled by the cosine of the route's mean latitude, as the current app's Leaflet map
// does at walking scale, and the shorter side is centred. A route with no extent (every fix on the
// same spot) lands in the middle. Null for fewer than two points: there is no route to draw.
export function routeFrame(
  points: LatLng[],
  width: number,
  height: number,
  padding: number,
): RouteFrame | null {
  if (points.length < 2 || width <= padding * 2 || height <= padding * 2) return null;
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const xs = points.map((p) => p.lng * kx);
  const ys = points.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale = Math.min(spanX ? innerW / spanX : Infinity, spanY ? innerH / spanY : Infinity);
  const k = Number.isFinite(scale) ? scale : 0;
  const offsetX = padding + (innerW - spanX * k) / 2;
  const offsetY = padding + (innerH - spanY * k) / 2;
  const project = (p: LatLng) => ({
    x: offsetX + (p.lng * kx - minX) * k,
    y: offsetY + (-p.lat - minY) * k,
  });
  return {
    project,
    path: (line) =>
      line
        .map((p, i) => {
          const { x, y } = project(p);
          return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' '),
  };
}
