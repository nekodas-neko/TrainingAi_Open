import { describe, it, expect } from 'vitest'
import { simplifyRoute, encodeRoute, decodeRoute, type RoutePoint } from '../route-encoding'

describe('simplifyRoute', () => {
  it('keeps short routes unchanged', () => {
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.0001, lng: 0.0001, t: 1000 },
    ]
    expect(simplifyRoute(points, 5)).toEqual(points)
  })

  it('drops collinear points within tolerance', () => {
    // Three points on a near-perfect straight line along the equator.
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0, lng: 0.0005, t: 1000 },
      { lat: 0, lng: 0.001, t: 2000 },
    ]
    const simplified = simplifyRoute(points, 5)
    expect(simplified).toHaveLength(2)
    expect(simplified[0]).toEqual(points[0])
    expect(simplified[1]).toEqual(points[2])
  })

  it('keeps a point that deviates beyond tolerance', () => {
    const points: RoutePoint[] = [
      { lat: 0, lng: 0, t: 0 },
      { lat: 0.001, lng: 0.0005, t: 1000 }, // ~111m north of the line
      { lat: 0, lng: 0.001, t: 2000 },
    ]
    const simplified = simplifyRoute(points, 5)
    expect(simplified).toHaveLength(3)
  })
})

describe('encodeRoute / decodeRoute', () => {
  it('round-trips lat/lng to ~5 decimal places', () => {
    const points: RoutePoint[] = [
      { lat: 38.5, lng: -120.2, t: 0 },
      { lat: 40.7, lng: -120.95, t: 1000 },
      { lat: 43.252, lng: -126.453, t: 2000 },
    ]
    const encoded = encodeRoute(points)
    expect(typeof encoded).toBe('string')
    const decoded = decodeRoute(encoded)
    expect(decoded).toHaveLength(3)
    decoded.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i].lat, 4)
      expect(p.lng).toBeCloseTo(points[i].lng, 4)
    })
  })

  it('returns an empty string for an empty route', () => {
    expect(encodeRoute([])).toBe('')
    expect(decodeRoute('')).toEqual([])
  })
})
