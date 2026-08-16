'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { cn } from '@trainingai/shared/utils'
import { getTileProvider } from '@trainingai/shared/map-tiles'
import type { RouteZoneRun } from '@/lib/activity/route-hr-zones'

interface LatLng {
  lat: number
  lng: number
}

interface ActivityRouteMapProps {
  points: LatLng[]
  className?: string
  /** When set, renders an extra marker at this position — driven by the hero chart's scrub
   *  handler so the map tracks where on the route a given HR/pace moment happened. */
  activePoint?: LatLng | null
  /** Per-run HR-zone colors from `buildRouteZoneSegments` — when present, the route draws as
   *  these colored runs instead of one flat brand-color line. Null/omitted falls back to flat. */
  zoneSegments?: RouteZoneRun[] | null
}

const THROTTLE_MS = 2000

function useIsOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  return online
}

export function ActivityRouteMap({ points, className, activePoint, zoneSegments }: ActivityRouteMapProps) {
  const [displayPoints, setDisplayPoints] = useState(points)
  const lastUpdateRef = useRef(0)
  const online = useIsOnline()

  useEffect(() => {
    const elapsed = Date.now() - lastUpdateRef.current
    if (elapsed >= THROTTLE_MS) {
      lastUpdateRef.current = Date.now()
      setDisplayPoints(points)
      return
    }
    const timeout = setTimeout(() => {
      lastUpdateRef.current = Date.now()
      setDisplayPoints(points)
    }, THROTTLE_MS - elapsed)
    return () => clearTimeout(timeout)
  }, [points])

  const positions = useMemo<[number, number][]>(
    () => displayPoints.map(p => [p.lat, p.lng]),
    [displayPoints],
  )

  const bounds = useMemo<[[number, number], [number, number]]>(() => [
    [Math.min(...positions.map(p => p[0])), Math.min(...positions.map(p => p[1]))],
    [Math.max(...positions.map(p => p[0])), Math.max(...positions.map(p => p[1]))],
  ], [positions])

  if (displayPoints.length === 0) return null

  const tiles = getTileProvider()

  if (!online) {
    return (
      <div className={cn('flex items-center justify-center rounded-xl bg-muted/60 border border-border text-center px-4', className)}>
        <p className="text-xs text-muted-foreground">Map unavailable offline — {displayPoints.length} GPS points recorded</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* attributionControl={false}: the Leaflet/Thunderforest/OSM attribution is a license
          requirement (ODbL + Thunderforest ToS), not decorative — hidden here only because this
          app is personal-use-only for now. MUST be restored (or replaced with a compliant
          collapsed/info-icon treatment that still shows the text) before any public release —
          see docs/public-launch-checklist.md. */}
      <MapContainer bounds={bounds} boundsOptions={{ padding: [20, 20] }} className="h-full w-full rounded-xl" scrollWheelZoom={false} attributionControl={false}>
        <TileLayer attribution={tiles.attribution} url={tiles.url} />
        {zoneSegments && zoneSegments.length > 0 ? (
          zoneSegments.map((run, i) => (
            <Polyline
              key={i}
              positions={run.positions.map(p => [p.lat, p.lng] as [number, number])}
              pathOptions={{ color: run.color, weight: 4 }}
            />
          ))
        ) : (
          <Polyline positions={positions} pathOptions={{ color: 'var(--color-brand)', weight: 4 }} />
        )}
        <CircleMarker center={positions[0]} radius={6} pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }} />
        <CircleMarker center={positions[positions.length - 1]} radius={6} pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }} />
        {activePoint && (
          <CircleMarker
            center={[activePoint.lat, activePoint.lng]}
            radius={8}
            pathOptions={{ color: 'var(--color-brand)', fillColor: 'var(--color-brand)', fillOpacity: 1, weight: 2 }}
          />
        )}
      </MapContainer>
    </div>
  )
}
