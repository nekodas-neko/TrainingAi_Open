import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { eventName } from '@/lib/oura-ble/decode'

// The native raw store names a row before any JS runs, so `OuraProtocol.EVENT_NAMES` in
// Kotlin duplicates `EVENT_NAMES` in decode.ts. Duplicated tables drift; this reads the map
// straight out of the Kotlin source and fails the moment the two disagree, so a tag added to
// only one side is a red CI check rather than a raw table full of `unknown`.
const KOTLIN_SOURCE = join(
  process.cwd(),
  'android/app/src/main/java/com/trainingai/app/oura/OuraProtocol.kt',
)

function parseKotlinEventNames(): Map<number, string> {
  const src = readFileSync(KOTLIN_SOURCE, 'utf8')
  const start = src.indexOf('private val EVENT_NAMES')
  expect(start, 'EVENT_NAMES not found in OuraProtocol.kt').toBeGreaterThan(-1)
  const body = src.slice(start, src.indexOf('\n    )', start))
  const out = new Map<number, string>()
  for (const [, tag, name] of body.matchAll(/0x([0-9a-f]{2}) to "([a-z0-9_]+)"/g)) {
    out.set(parseInt(tag, 16), name)
  }
  return out
}

const HISTORY_TAGS = Array.from({ length: 0x100 - 0x41 }, (_, i) => 0x41 + i)
const hex = (tag: number) => `0x${tag.toString(16).padStart(2, '0')}`

describe('Kotlin ↔ TS event-name parity', () => {
  it('resolves every history tag identically on both sides', () => {
    const kotlin = parseKotlinEventNames()
    expect(kotlin.size).toBeGreaterThan(50)
    // Both directions in one sweep: a tag present in only one map resolves to `unknown` in
    // the other and shows up here.
    const mismatches = HISTORY_TAGS.map((tag) => ({
      tag,
      ts: eventName(tag),
      kt: kotlin.get(tag) ?? 'unknown',
    }))
      .filter(({ ts, kt }) => ts !== kt)
      .map(({ tag, ts, kt }) => `${hex(tag)}: ts=${ts} kotlin=${kt}`)
    expect(mismatches).toEqual([])
  })
})
