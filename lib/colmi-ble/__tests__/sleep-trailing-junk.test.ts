import { describe, it, expect } from 'vitest'
import { decodeBigData } from '@/lib/colmi-ble/decode'

const hex = (h: string) => Uint8Array.from(h.match(/../g)!.map(b => parseInt(b, 16)))

/**
 * Two REAL captures of the same night from `colmi_raw_frames`, 32 minutes apart.
 *
 * The later frame declares **60** stage-bytes where the earlier declares **42**. The first 42 are
 * byte-identical; the extra 18 are `00 ff 00 ff 00 ff 00 aa 03 01 00 ff 00 ff 00 02 02 06`. Decoded
 * as spans that gave three of stage 0 for 255 minutes each and turned a 8.9-hour night into
 * **19.1 hours** in the database (2026-09-02).
 *
 * So the declared length bounds the block and does not vouch for its contents.
 */
const CLEAN = 'bc272d00a39001002a0c0581010225031d0218040e0224030c021e04100231032802070503023503130220041b0239031d0213'
const JUNK  = 'bc273f001ae401003c0c058f010225031d0218040e0224030c021e04100231032802070503023503130220041b0239031d021300ff00ff00ff00aa030100ff00ff00020206'

function night(h: string) {
  const f = decodeBigData(hex(h))
  if (f.kind !== 'sleep') throw new Error(`expected sleep, got ${f.kind}`)
  return f.sessions[0]
}

describe('a sleep frame whose declared length over-counts', () => {
  it('drops the junk tail rather than adding ten hours of stage-0 sleep', () => {
    const s = night(JUNK)
    expect(s.stages.some(x => x.stage === 0)).toBe(false)
    expect(s.stages.some(x => x.minutes === 255)).toBe(false)
    const total = s.stages.reduce((n, x) => n + x.minutes, 0)
    expect(total).toBe(533)                       // 8.9 h, not 19.1
  })

  it('reads the same night identically from either capture', () => {
    expect(night(JUNK).stages).toEqual(night(CLEAN).stages)
  })

  it('keeps only real stages — 2 light, 3 deep, 4 REM, 5 awake', () => {
    for (const h of [CLEAN, JUNK]) {
      expect(night(h).stages.every(x => x.stage >= 2 && x.stage <= 5)).toBe(true)
    }
  })
})
