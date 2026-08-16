import { describe, it, expect, beforeEach } from 'vitest'
import { onFrames, onStatus, subscribeGateFeed, type GateFeedEvent } from '../gate-feed'
import { bytesToHex } from '../decode'
import type { OuraFrameEvent, OuraBleStatus } from '../plugin'

// Same reference feature_1/feature_2 bodies as oura-ble-step-features.test.ts —
// paired, this decodes to a non-walking window (column 0 = 105, well under the
// walking threshold), so a second, higher-magnitude pair is used for the
// walking case.
const p1 = new Uint8Array([0x81, 0x02, 0x03, 0x84, 0x05, 0x06, 0x07, 0x08, 0x89, 0x0a, 0x0b, 0x8c, 0x0d, 0x0e])
const p2 = new Uint8Array([0x10, 0x11, 0x92, 0x13, 0x14, 0x95, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0xd5])

function le32Hex(ds: number): string {
  const b = new Uint8Array(4)
  b[0] = ds & 0xff
  b[1] = (ds >>> 8) & 0xff
  b[2] = (ds >>> 16) & 0xff
  b[3] = (ds >>> 24) & 0xff
  return bytesToHex(b)
}

// Builds a raw gate-frame hex string: tag byte + len byte + 4-byte LE ds + body.
function frame(tag: number, ds: number, body: Uint8Array): OuraFrameEvent {
  const payloadHex = le32Hex(ds) + bytesToHex(body)
  const len = payloadHex.length / 2
  return { tag, subOp: null, hex: tag.toString(16).padStart(2, '0') + len.toString(16).padStart(2, '0') + payloadHex }
}

describe('gate-feed', () => {
  let events: GateFeedEvent[]
  const listener = (ev: GateFeedEvent) => events.push(ev)

  beforeEach(() => {
    events = []
  })

  // subscribeGateFeed registers the listener (and tries to attach real plugin
  // listeners, which no-ops off-device since getOuraBle() returns null in this
  // environment); frames/status are then fed directly through the exported
  // onFrames/onStatus, which emit synchronously to whatever's registered.

  it('pairs a 0x7e/0x7f window and emits it once', async () => {
    const unsub = await subscribeGateFeed(listener)
    onFrames([frame(0x7e, 5000, p1), frame(0x7f, 5001, p2)])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'window', ds: 5000 })
    unsub()
  })

  it('dedups out-of-order re-delivery of the same ds', async () => {
    const unsub = await subscribeGateFeed(listener)
    onFrames([frame(0x7e, 6000, p1), frame(0x7f, 6001, p2)])
    onFrames([frame(0x7e, 6000, p1), frame(0x7f, 6001, p2)])
    expect(events).toHaveLength(1)
    unsub()
  })

  it('ignores non-gate tags', async () => {
    const unsub = await subscribeGateFeed(listener)
    onFrames([{ tag: 0x50, subOp: null, hex: '5003010203' }])
    expect(events).toHaveLength(0)
    unsub()
  })

  it('emits disconnect on a terminal status', async () => {
    const unsub = await subscribeGateFeed(listener)
    onStatus({ state: 'disconnected' } as OuraBleStatus)
    expect(events).toEqual([{ type: 'disconnect' }])
    unsub()
  })

  it('does not emit disconnect on a live status', async () => {
    const unsub = await subscribeGateFeed(listener)
    onStatus({ state: 'connected' } as OuraBleStatus)
    expect(events).toHaveLength(0)
    unsub()
  })
})
