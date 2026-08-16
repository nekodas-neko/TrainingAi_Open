'use client'

import { useState } from 'react'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  useBackgroundSettingsStore,
  type BackgroundSection,
} from '@/lib/stores/background-settings-store'
import { geocodeLocations } from '@/lib/weather/geocode'
import type { ManualLocation } from '@/lib/weather/types'

const SECTION_LABELS: Record<BackgroundSection, string> = {
  home: 'Home',
  health: 'Health',
  workout: 'Workout',
  nutrition: 'Nutrition',
  more: 'More',
}

const SECTION_ORDER: BackgroundSection[] = ['home', 'health', 'workout', 'nutrition', 'more']

export function DynamicBackgroundSettings() {
  const enabled = useBackgroundSettingsStore((s) => s.enabled)
  const sections = useBackgroundSettingsStore((s) => s.sections)
  const manualLocation = useBackgroundSettingsStore((s) => s.manualLocation)
  const setEnabled = useBackgroundSettingsStore((s) => s.setEnabled)
  const setSectionEnabled = useBackgroundSettingsStore((s) => s.setSectionEnabled)
  const setManualLocation = useBackgroundSettingsStore((s) => s.setManualLocation)

  const [locationQuery, setLocationQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [results, setResults] = useState<ManualLocation[]>([])

  async function handleLocationSearch() {
    const query = locationQuery.trim()
    if (!query) return
    setSearching(true)
    setSearchError(null)
    setResults([])
    try {
      const matches = await geocodeLocations(query)
      if (matches.length === 0) {
        setSearchError('No matches — try a city or suburb name')
        return
      }
      setResults(matches)
    } catch {
      setSearchError('Search failed — try again')
    } finally {
      setSearching(false)
    }
  }

  function handleSelectResult(result: ManualLocation) {
    setManualLocation(result)
    setLocationQuery('')
    setResults([])
    setSearchError(null)
  }

  return (
    <div className="space-y-3 pt-3 mt-3 border-t border-border">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Dynamic background</p>
          <p className="text-[10px] text-muted-foreground">Home &amp; Workout follow time of day &amp; weather; Health, Nutrition, and More use a themed scene</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Dynamic background" />
      </div>

      {enabled && (
        <>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Show on</p>
            {SECTION_ORDER.map((key) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm">{SECTION_LABELS[key]}</span>
                <Switch
                  checked={sections[key]}
                  onCheckedChange={(checked) => setSectionEnabled(key, checked)}
                  aria-label={`Dynamic background on ${SECTION_LABELS[key]}`}
                />
              </div>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Fallback location</p>
            <p className="text-xs text-muted-foreground">
              {manualLocation
                ? `${manualLocation.name} (used if device location is unavailable)`
                : 'Device location is used; set a fallback for when it is unavailable'}
            </p>
            <div className="flex gap-2">
              <Input
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleLocationSearch() }}
                placeholder="City or suburb name, e.g. Brisbane"
                className="flex-1"
              />
              <Button type="button" onClick={handleLocationSearch} disabled={searching}>
                {searching ? '…' : 'Search'}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Search by city or suburb name — postcodes aren&apos;t supported
            </p>
            {searchError && <p className="text-xs text-destructive">{searchError}</p>}
            {results.length > 0 && (
              <div className="rounded-lg border border-border divide-y divide-border overflow-hidden">
                {results.map((result, i) => (
                  <button
                    key={`${result.lat}-${result.lon}-${i}`}
                    type="button"
                    onClick={() => handleSelectResult(result)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                  >
                    {result.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
