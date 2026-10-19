// Moved from lib/activity/route-encoding.ts so TrainingAi Preview records routes with the same code
// (#2845). The polyline codec is written out here rather than pulled from @mapbox/polyline, which
// the shared package cannot depend on; it is that library's algorithm, including its Python 2
// rounding, so a route encodes to the same string on both apps.

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

// Google's algorithm rounds halves away from zero (Python 2), not toward +∞ like Math.round.
function roundHalfAway(value: number): number {
  return Math.floor(Math.abs(value) + 0.5) * (value >= 0 ? 1 : -1)
}

function encodeDelta(current: number, previous: number): string {
  let coordinate = (roundHalfAway(current * 1e5) - roundHalfAway(previous * 1e5)) * 2
  if (coordinate < 0) coordinate = -coordinate - 1
  let output = ''
  while (coordinate >= 0x20) {
    output += String.fromCharCode((0x20 | (coordinate & 0x1f)) + 63)
    coordinate /= 32
  }
  return output + String.fromCharCode((coordinate | 0) + 63)
}

/** Encodes a route's lat/lng pairs as a Google polyline string (precision 5). */
export function encodeRoute(points: { lat: number; lng: number }[]): string {
  let output = ''
  for (let i = 0; i < points.length; i++) {
    const prev = i === 0 ? { lat: 0, lng: 0 } : points[i - 1]
    output += encodeDelta(points[i].lat, prev.lat) + encodeDelta(points[i].lng, prev.lng)
  }
  return output
}

/** Decodes a polyline string back to lat/lng pairs. */
export function decodeRoute(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = []
  let index = 0
  let lat = 0
  let lng = 0
  const next = () => {
    let shift = 1
    let result = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result += (byte & 0x1f) * shift
      shift *= 32
    } while (byte >= 0x20)
    return result & 1 ? (-result - 1) / 2 : result / 2
  }
  while (index < encoded.length) {
    lat += next()
    lng += next()
    points.push({ lat: lat / 1e5, lng: lng / 1e5 })
  }
  return points
}
