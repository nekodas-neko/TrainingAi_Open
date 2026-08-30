// The rule behind `check-plugin-proxy-thenable.js`, tested against fixtures rather than the tree.
//
// A check whose only evidence is "it passes today" cannot show it would have caught the bug it was
// written for. These fixtures are the two real shapes: the one that shipped broken
// (`components/workout/voice-log-button.tsx` returning the raw `registerPlugin()` proxy, which hung
// the getter and left the Voice button unrendered on the APK) and the two that look identical and
// are correct (`return BleClient` — a plain class instance, not a proxy).
import { describe, it, expect } from 'vitest'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { findProxyReturns, NOT_A_PROXY } = require('../lib/plugin-proxy-scan.js') as {
  findProxyReturns: (sources: { file: string; src: string }[]) => { file: string; line: number; name: string; pkg: string }[]
  NOT_A_PROXY: Map<string, string>
}

const BROKEN = `
async function getNativeSpeech() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return SpeechRecognition
  } catch { return null }
}
`

const FIXED = `
async function getNativeSpeech() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return { plugin: SpeechRecognition }
  } catch { return null }
}
`

const BLE = `
async function getBle() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return null
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    return BleClient
  } catch { return null }
}
`

describe('findProxyReturns', () => {
  it('catches the shape that shipped', () => {
    const found = findProxyReturns([{ file: 'voice-log-button.tsx', src: BROKEN }])
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({
      name: 'SpeechRecognition',
      pkg: '@capacitor-community/speech-recognition',
    })
  })

  it('reports the line the return is on, not the line the import is on', () => {
    // The fix belongs at the return; pointing at the import sends the reader to the wrong place.
    const [found] = findProxyReturns([{ file: 'x.tsx', src: BROKEN }])
    expect(BROKEN.split('\n')[found.line - 1]).toContain('return SpeechRecognition')
  })

  it('passes the wrapped form', () => {
    expect(findProxyReturns([{ file: 'voice-log-button.tsx', src: FIXED }])).toHaveLength(0)
  })

  // The precision that matters: two real call sites have this exact shape and are correct.
  it('passes `return BleClient`, which is an instance rather than a proxy', () => {
    expect(findProxyReturns([{ file: 'lib/colmi-ble/ble.ts', src: BLE }])).toHaveLength(0)
  })

  it('exempts BleClient by name, with the reason recorded rather than assumed', () => {
    expect(NOT_A_PROXY.get('BleClient')).toMatch(/plain instance, not a proxy/)
  })

  it('never flags `return Capacitor`, which is the platform helper', () => {
    const src = `
async function f() {
  const { Capacitor } = await import('@capacitor/core')
  return Capacitor
}
`
    expect(findProxyReturns([{ file: 'f.ts', src }])).toHaveLength(0)
  })

  it('ignores a file with no Capacitor dynamic import at all', () => {
    expect(findProxyReturns([{ file: 'plain.ts', src: 'async function f() { const X = 1; return X }' }])).toHaveLength(0)
  })

  it('only flags a binding that came from the import, not any local in the same file', () => {
    // This file DOES import a plugin, so the scan reaches the returns — and must still ignore a
    // return of something it never imported. Without the `bound.has(name)` guard every helper in
    // every plugin file becomes an offender.
    const src = `
async function getNativeSpeech() {
  const { Capacitor } = await import('@capacitor/core')
  if (!Capacitor.isNativePlatform()) return null
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
  return { plugin: SpeechRecognition }
}

async function describeState() {
  const summary = 'idle'
  return summary
}
`
    expect(findProxyReturns([{ file: 'f.ts', src }])).toHaveLength(0)
  })
})
