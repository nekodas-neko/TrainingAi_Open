import { describe, it, expect } from 'vitest'
import {
  reduceGate,
  initGate,
  PROBE_TIMEOUT_MS,
  type MotionGateContext,
} from '../motion-gate'

const probing: MotionGateContext = { state: 'probing', probeDeadlineMs: PROBE_TIMEOUT_MS }
const tracking: MotionGateContext = { state: 'tracking', probeDeadlineMs: null }

describe('reduceGate', () => {
  it('starts GPS on a motion trigger from idle', () => {
    const r = reduceGate(initGate(), { type: 'motionTrigger', now: 0 })
    expect(r.ctx.state).toBe('probing')
    expect(r.ctx.probeDeadlineMs).toBe(PROBE_TIMEOUT_MS)
    expect(r.commands).toEqual(['startGps'])
  })

  it('ignores a motion trigger while probing (no double-start)', () => {
    const r = reduceGate(probing, { type: 'motionTrigger', now: 10 })
    expect(r.ctx).toEqual(probing)
    expect(r.commands).toEqual([])
  })

  it('ignores a motion trigger while tracking', () => {
    const r = reduceGate(tracking, { type: 'motionTrigger', now: 10 })
    expect(r.ctx).toEqual(tracking)
    expect(r.commands).toEqual([])
  })

  it('promotes probing → tracking when a session starts, keeping GPS on', () => {
    const r = reduceGate(probing, { type: 'sessionStarted' })
    expect(r.ctx.state).toBe('tracking')
    expect(r.commands).toEqual([])
  })

  it('does not react to sessionStarted while idle', () => {
    const r = reduceGate(initGate(), { type: 'sessionStarted' })
    expect(r.ctx.state).toBe('idle')
    expect(r.commands).toEqual([])
  })

  it('stops GPS and re-arms the sensor when a tracked session ends', () => {
    const r = reduceGate(tracking, { type: 'sessionEnded' })
    expect(r.ctx.state).toBe('idle')
    expect(r.commands).toEqual(['stopGps', 'armMotion'])
  })

  it('stops GPS and re-arms if a session ends during probing', () => {
    const r = reduceGate(probing, { type: 'sessionEnded' })
    expect(r.ctx.state).toBe('idle')
    expect(r.commands).toEqual(['stopGps', 'armMotion'])
  })

  it('sessionEnded while idle is a no-op', () => {
    const r = reduceGate(initGate(), { type: 'sessionEnded' })
    expect(r.commands).toEqual([])
  })

  it('turns GPS off when the probe times out with no session', () => {
    const r = reduceGate(probing, { type: 'tick', now: PROBE_TIMEOUT_MS })
    expect(r.ctx.state).toBe('idle')
    expect(r.commands).toEqual(['stopGps', 'armMotion'])
  })

  it('keeps probing until the deadline is reached', () => {
    const r = reduceGate(probing, { type: 'tick', now: PROBE_TIMEOUT_MS - 1 })
    expect(r.ctx).toEqual(probing)
    expect(r.commands).toEqual([])
  })

  it('never times out while tracking (deadline is cleared)', () => {
    const r = reduceGate(tracking, { type: 'tick', now: PROBE_TIMEOUT_MS * 10 })
    expect(r.ctx).toEqual(tracking)
    expect(r.commands).toEqual([])
  })

  it('stops GPS on stop while probing/tracking', () => {
    expect(reduceGate(probing, { type: 'stop' }).commands).toEqual(['stopGps'])
    expect(reduceGate(tracking, { type: 'stop' }).commands).toEqual(['stopGps'])
  })

  it('stop while idle issues no commands (GPS already off)', () => {
    const r = reduceGate(initGate(), { type: 'stop' })
    expect(r.ctx.state).toBe('idle')
    expect(r.commands).toEqual([])
  })

  it('runs a full trigger → track → end cycle back to idle', () => {
    let ctx = initGate()
    ctx = reduceGate(ctx, { type: 'motionTrigger', now: 0 }).ctx
    expect(ctx.state).toBe('probing')
    ctx = reduceGate(ctx, { type: 'sessionStarted' }).ctx
    expect(ctx.state).toBe('tracking')
    const end = reduceGate(ctx, { type: 'sessionEnded' })
    expect(end.ctx.state).toBe('idle')
    expect(end.commands).toEqual(['stopGps', 'armMotion'])
  })
})
