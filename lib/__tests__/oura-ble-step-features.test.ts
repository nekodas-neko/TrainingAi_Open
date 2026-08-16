import { describe, it, expect } from 'vitest'
import {
  unpack27,
  pairStepFeatures,
  STEP_FEATURE_COLUMNS,
  type StepFeatureFrame,
} from '../oura-ble/step-features'
import { hexToBytes } from '../oura-ble/decode'

describe('unpack27 — real-step feature pairing (0x7e/0x7f)', () => {
  // Ground-truth pinned against Th0rgal/open_health `unpack27` run on this exact
  // input (tools/run_activity_model.py). Any transcription slip in the bit-unpack
  // changes this vector — that is what this test guards.
  const p1 = new Uint8Array([0x81, 0x02, 0x03, 0x84, 0x05, 0x06, 0x07, 0x08, 0x89, 0x0a, 0x0b, 0x8c, 0x0d, 0x0e])
  const p2 = new Uint8Array([0x10, 0x11, 0x92, 0x13, 0x14, 0x95, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0xd5])
  const expected = [105, 27, 28, 259, 5, 7, 4, 5, 6, 7, 8, 275, 20, 23, 12, 13, 14, 16, 17, 293, 38, 41, 21, 22, 23, 24, 25]

  it('produces exactly 27 columns matching the reference vector', () => {
    const cols = unpack27(p1, p2)
    expect(cols).not.toBeNull()
    expect(cols!.length).toBe(STEP_FEATURE_COLUMNS)
    expect(cols).toEqual(expected)
  })

  it('column 0 is derived from feature_2 + carry, not feature_1', () => {
    // Gate column must not move when feature_1 changes, only when p2[10]/carry does.
    const p1b = new Uint8Array(p1)
    p1b[0] = 0x00
    p1b[8] = 0x00
    expect(unpack27(p1b, p2)![0]).toBe(expected[0])
    const p2b = new Uint8Array(p2)
    p2b[10] = 0x3f
    expect(unpack27(p1, p2b)![0]).not.toBe(expected[0])
  })

  it('returns null for a malformed (non-14-byte) body', () => {
    expect(unpack27(p1.slice(0, 13), p2)).toBeNull()
    expect(unpack27(p1, p2.slice(0, 10))).toBeNull()
  })
})

describe('pairStepFeatures — timestamp pairing', () => {
  const p1 = new Uint8Array([0x81, 0x02, 0x03, 0x84, 0x05, 0x06, 0x07, 0x08, 0x89, 0x0a, 0x0b, 0x8c, 0x0d, 0x0e])
  const p2 = new Uint8Array([0x10, 0x11, 0x92, 0x13, 0x14, 0x95, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0xd5])
  const expectedCols = [105, 27, 28, 259, 5, 7, 4, 5, 6, 7, 8, 275, 20, 23, 12, 13, 14, 16, 17, 293, 38, 41, 21, 22, 23, 24, 25]

  it('pairs feature_2 emitted one ds after its feature_1', () => {
    const frames: StepFeatureFrame[] = [
      { ds: 1000, tag: 0x7e, body: p1 },
      { ds: 1001, tag: 0x7f, body: p2 },
    ]
    const paired = pairStepFeatures(frames)
    expect(paired).toHaveLength(1)
    expect(paired[0].ds).toBe(1000)
    expect(paired[0].columns).toEqual(expectedCols)
  })

  it('skips a feature_1 with no matching feature_2 at ds+1', () => {
    const frames: StepFeatureFrame[] = [
      { ds: 1000, tag: 0x7e, body: p1 },
      { ds: 1005, tag: 0x7f, body: p2 }, // wrong offset
    ]
    expect(pairStepFeatures(frames)).toHaveLength(0)
  })

  it('pairs multiple windows and preserves order, ignoring unrelated tags', () => {
    const frames: StepFeatureFrame[] = [
      { ds: 2000, tag: 0x7e, body: p1 },
      { ds: 2001, tag: 0x7f, body: p2 },
      { ds: 2050, tag: 0x50, body: new Uint8Array([1, 2, 3]) }, // activity_information — ignored
      { ds: 2100, tag: 0x7e, body: p1 },
      { ds: 2101, tag: 0x7f, body: p2 },
    ]
    const paired = pairStepFeatures(frames)
    expect(paired.map((p) => p.ds)).toEqual([2000, 2100])
  })
})

describe('real captured ring frames (2026-07-10 idle-labelled dump)', () => {
  // Actual 0x7e/0x7f frames drained from the owner's Ring 5 (committed as a permanent
  // fixture so this real-data validation survives — the earlier round-2/3 captures were
  // lost to the ephemeral scratchpad). This is the "sat still 09:13–09:16" dump; note the
  // capture is contaminated (ring is finger-worn, dump spans ~25 min of buffer), so col0
  // is scattered — it proves the pair+decode path on real bytes, NOT the idle threshold.
  const frames: [number, string, string][] = [
    // [feature_1 ds, feature_1 hex, feature_2 hex]
    [3997982, '52f253e14739b13b76f83ca64653', '7f72a20000953b007574ad403bf1'],
    [3998277, '82dc45145c56568a78e147932d40', '6a5c8fdf3a523654923fad3d5d49'],
    [3998578, '610834293c6542834300002e4600', 'a5474f0000b44b00b1409b3851c1'],
    [3998878, 'b67343a44129825bafd122a73d2e', '994fa6e43ab2375a8f5aae4e8777'],
    [4010522, '4700004d3b00ae3646df4aee4c4c', 'a442420000ce4600a03d5a3f4011'],
    [4011354, 'b5f031c73f5b8f5b439725e14c42', '9e3b403b3ce83338a33ca054727e'],
    [4011655, '40392fc739479a4d42d048c03d00', '8d4245943f7a38308a565b43415d'],
    [4012027, '989655065c3e1f4a9773600c3d55', '3a58530000c25000dd18be488c51'],
    [4012329, '79f2241b3e4d36aaac8546ae3b52', '7f71b2735c1f485b3bb4b33a60a7'],
    [4012630, '503e38b34c00b2344800003b5300', 'ae3d60503ead43298855b1817a0d'],
    [4012927, '65a951965457538155e149914a59', '5492440000953700984bb2659fb3'],
    [4013228, '44bd28d73e5a9549450000523c00', 'a93e431b24ca4800b92b545d5746'],
  ]

  it('pairs all 12 windows and extracts column 0 matching the reference decode', () => {
    const input: StepFeatureFrame[] = []
    for (const [ds, f1, f2] of frames) {
      input.push({ ds, tag: 0x7e, body: hexToBytes(f1) })
      input.push({ ds: ds + 1, tag: 0x7f, body: hexToBytes(f2) })
    }
    const paired = pairStepFeatures(input)
    expect(paired).toHaveLength(12)
    const col0ByDs = Object.fromEntries(paired.map((p) => [p.ds, p.columns[0]]))
    // Ground-truth column-0 values, generated by the reference unpack27 (open_health).
    expect(col0ByDs).toEqual({
      3997982: 693, 3998277: 693, 3998578: 621, 3998878: 699,
      4010522: 361, 4011354: 642, 4011655: 365, 4012027: 761,
      4012329: 719, 4012630: 709, 4012927: 715, 4013228: 338,
    })
  })
})
