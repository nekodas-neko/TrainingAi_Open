import { describe, it, expect } from 'vitest'
import { initGaitConfirm, pushGaitWindow, CONFIRM_WINDOW_COUNT, MAX_WINDOW_GAP_MS } from '../gait-confirm'
import type { GaitConfirmContext } from '../gait-confirm'

function pushAll(ctx: GaitConfirmContext, windows: { state: 'idle' | 'walk' | 'run'; atMs: number }[]) {
  let cur = ctx
  let lastConfirmed = null as ReturnType<typeof pushGaitWindow>['confirmed']
  for (const w of windows) {
    const r = pushGaitWindow(cur, w)
    cur = r.ctx
    lastConfirmed = r.confirmed
  }
  return { ctx: cur, confirmed: lastConfirmed }
}

describe('gait-confirm', () => {
  it('does not confirm before CONFIRM_WINDOW_COUNT consecutive in-locomotion windows', () => {
    expect(CONFIRM_WINDOW_COUNT).toBe(3)
    const { confirmed } = pushAll(initGaitConfirm(), [
      { state: 'walk', atMs: 0 },
      { state: 'walk', atMs: 30_000 },
    ])
    expect(confirmed).toBeNull()
  })

  it('confirms walk on the 3rd consecutive in-band window, backdated to the first', () => {
    const { confirmed } = pushAll(initGaitConfirm(), [
      { state: 'walk', atMs: 1_000 },
      { state: 'walk', atMs: 31_000 },
      { state: 'walk', atMs: 61_000 },
    ])
    expect(confirmed).toEqual({ activityType: 'walk', startMs: 1_000 })
  })

  it('confirms run when the streak is run-majority', () => {
    const { confirmed } = pushAll(initGaitConfirm(), [
      { state: 'run', atMs: 0 },
      { state: 'run', atMs: 30_000 },
      { state: 'walk', atMs: 60_000 },
    ])
    expect(confirmed).toEqual({ activityType: 'run', startMs: 0 })
  })

  it('resets the streak on an idle window (a lifting set cannot sustain 90s)', () => {
    const { confirmed } = pushAll(initGaitConfirm(), [
      { state: 'walk', atMs: 0 },
      { state: 'walk', atMs: 30_000 },
      { state: 'idle', atMs: 45_000 }, // resets
      { state: 'walk', atMs: 60_000 },
    ])
    expect(confirmed).toBeNull()
  })

  it('does not confirm across a drain burst delivering windows an hour apart (not a real streak)', () => {
    // A drain can deliver a burst of windows covering the whole preceding hour "in order" but not
    // temporally consecutive — three in-band windows an hour apart must not confirm a walk
    // backdated to the first one.
    const { confirmed } = pushAll(initGaitConfirm(), [
      { state: 'walk', atMs: 0 },
      { state: 'walk', atMs: 3_600_000 },
      { state: 'walk', atMs: 7_200_000 },
    ])
    expect(confirmed).toBeNull()
  })

  it('a gap just past MAX_WINDOW_GAP_MS restarts the streak instead of extending it', () => {
    const { confirmed, ctx } = pushAll(initGaitConfirm(), [
      { state: 'walk', atMs: 0 },
      { state: 'walk', atMs: 30_000 },
      { state: 'walk', atMs: 60_000 + MAX_WINDOW_GAP_MS + 1 }, // gap from the last window
    ])
    expect(confirmed).toBeNull()
    expect(ctx.streak).toHaveLength(1)
  })

  it('confirms only once per session even after further windows', () => {
    let ctx = initGaitConfirm()
    ;({ ctx } = pushGaitWindow(ctx, { state: 'walk', atMs: 0 }))
    ;({ ctx } = pushGaitWindow(ctx, { state: 'walk', atMs: 30_000 }))
    const first = pushGaitWindow(ctx, { state: 'walk', atMs: 60_000 })
    expect(first.confirmed).not.toBeNull()
    const second = pushGaitWindow(first.ctx, { state: 'run', atMs: 90_000 })
    expect(second.confirmed).toBeNull()
    expect(second.ctx.confirmedThisSession).toBe(true)
  })
})
