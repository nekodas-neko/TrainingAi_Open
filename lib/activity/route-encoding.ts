import polyline from '@mapbox/polyline'

export interface RoutePoint {
  lat: number
  lng: number
  ele?: number
  t: number // epoch ms
}

const EARTH_RADIUS_M = 6_371_000

/** Projects a point to local flat x/y meters relative to an origin (equirectangular approximation, fine for short routes). */
function toLocalMeters(p: RoutePoint, origin: RoutePoint): { x: number; y: number } {
  const latRad = (origin.lat * Math.PI) / 180
  const x = ((p.lng - origin.lng) * Math.PI) / 180 * EARTH_RADIUS_M * Math.cos(latRad)
  const y = ((p.lat - origin.lat) * Math.PI) / 180 * EARTH_RADIUS_M
  return { x, y }
}

function perpendicularDistanceMeters(point: RoutePoint, lineStart: RoutePoint, lineEnd: RoutePoint): number {
  const p = toLocalMeters(point, lineStart)
  const a = { x: 0, y: 0 }
  const b = toLocalMeters(lineEnd, lineStart)
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (dx === 0 && dy === 0) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.hypot(p.x - projX, p.y - projY)
}

/** Douglas-Peucker simplification. `toleranceMeters` is the max allowed perpendicular deviation for a dropped point. */
export function simplifyRoute(points: RoutePoint[], toleranceMeters: number): RoutePoint[] {
  if (points.length < 3) return points

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistanceMeters(points[i], first, last)
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist > toleranceMeters) {
    const left = simplifyRoute(points.slice(0, maxIdx + 1), toleranceMeters)
    const right = simplifyRoute(points.slice(maxIdx), toleranceMeters)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

/** Encodes a route's lat/lng pairs as a Google polyline string (precision 5). */
export function encodeRoute(points: RoutePoint[]): string {
  if (points.length === 0) return ''
  return polyline.encode(points.map(p => [p.lat, p.lng]))
}

/** Decodes a polyline string back to lat/lng pairs. */
export function decodeRoute(encoded: string): { lat: number; lng: number }[] {
  if (!encoded) return []
  return polyline.decode(encoded).map(([lat, lng]) => ({ lat, lng }))
}
