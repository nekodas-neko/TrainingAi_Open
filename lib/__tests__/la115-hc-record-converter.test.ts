// LA-115 — every record type `health-connect-sync.ts` reads through `readRecords` must have a branch
// in the plugin's `RecordConverter`. The fallback is `record.toString()`, a Kotlin string, so an
// unhandled type reads every field as `undefined` and the date filter after it drops everything
// with no error. Three types we asked for (HRV, SpO2, the HR series) sat on that fallback.
//
// The converter checked is the INSTALLED one, `node_modules`, which `pnpm install` builds from
// `patches/@devmaxime__capacitor-health-connect.patch`. So this also fails if the patch stops
// applying.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sync = readFileSync(join(root, 'lib/health-connect-sync.ts'), 'utf8')
const converter = readFileSync(join(root,
  'node_modules/@devmaxime/capacitor-health-connect/android/src/main/java/com/devmaxime/capacitor/health/connect/RecordConverter.kt'), 'utf8')

// The name → class pairs from connect-client 1.1.0-alpha11's RecordsTypeNameMap.kt (read from the
// pinned sources jar). Note `HeartRateSeries` → `HeartRateRecord`: the SDK keeps the legacy name.
const RECORD_CLASS: Record<string, string> = {
  Steps: 'StepsRecord', Weight: 'WeightRecord', ActivitySession: 'ExerciseSessionRecord',
  SleepSession: 'SleepSessionRecord', RestingHeartRate: 'RestingHeartRateRecord',
  BodyFat: 'BodyFatRecord', Nutrition: 'NutritionRecord',
  HeartRateVariabilityRmssd: 'HeartRateVariabilityRmssdRecord',
  OxygenSaturation: 'OxygenSaturationRecord', HeartRateSeries: 'HeartRateRecord',
}

const readTypes = [...sync.matchAll(/readRecords\(\{[^}]*type: '(\w+)'/g)].map(m => m[1])

/** The body of one `is XRecord -> { … }` branch. */
function branch(cls: string): string {
  const start = converter.indexOf(`is ${cls} ->`)
  if (start < 0) return ''
  const next = converter.indexOf('\n        is ', start + 1)
  return converter.slice(start, next < 0 ? undefined : next)
}

describe('Health Connect record conversion (LA-115)', () => {
  it('finds the readRecords calls it is guarding', () => {
    expect(readTypes).toEqual(expect.arrayContaining(['HeartRateSeries', 'HeartRateVariabilityRmssd', 'OxygenSaturation']))
  })

  it('every type read has a converter branch, so nothing falls to record.toString()', () => {
    const missing = readTypes.filter(t => !RECORD_CLASS[t] || !branch(RECORD_CLASS[t]))
    expect(missing).toEqual([])
  })

  it('writes the keys the sync reads', () => {
    expect(branch('HeartRateVariabilityRmssdRecord')).toMatch(/put\("time",[\s\S]*put\("heartRateVariabilityMillis", record\.heartRateVariabilityMillis\)/)
    // Percentage is a wrapper class; the sync averages numbers, so the branch must unwrap it.
    expect(branch('OxygenSaturationRecord')).toMatch(/put\("percentage", record\.percentage\.value\)/)
    expect(branch('HeartRateRecord')).toMatch(/put\("beatsPerMinute", sample\.beatsPerMinute\)[\s\S]*put\("samples", samplesArray\)/)
  })

  it('no readRecords call needs an `as any` to get past the type union any more', () => {
    expect(sync).not.toMatch(/readRecords\(\{[^}]*\} as any\)/)
  })
})
