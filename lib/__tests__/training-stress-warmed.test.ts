// Q-270. `oura_daily_derived.training_load_ots` was 0 of 89 days in production — and not because
// anything was broken. Every gate of `computeTrainingStress` passed when measured: readiness was
// `ble-derived` on 31 days, `n_history` was 40 against a threshold of 14, RHR was present on 30 of
// 30 days, and the MET grid on 2026-08-13 spanned 1,425 minutes with 1,146 values against floors of
// 720 and 360.
//
// The value was computable every day and written on none, because `/api/training-stress` computes
// and persists only as a side effect of being called — and its only caller was a card on Health →
// Body, for today only, while the Health tab defaults to Training.
//
// The whole fix is one line in the sync-provider warm list, which is exactly why it needs a guard:
// a line that looks like configuration is the load-bearing part, and deleting it silently returns
// the column to empty with nothing failing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('components/sync-provider.tsx', 'utf8')
const ENTRY = /\{\s*key:\s*'training-stress'[^}]*\}/s

describe('training-stress is warmed on launch (Q-270)', () => {
  it('has a warm-list entry at all — the line that populates the column', () => {
    expect(ENTRY.test(SRC)).toBe(true)
  })

  // Without `today: true` the warm write stores a bare value, while the card reads through
  // `readTodayCacheSync`/`cachedFetchToday` and expects a `{date, data}` envelope. Every read would
  // miss, so the warm would be wasted work — and, worse, it would look like it was doing something.
  it('warms with the today envelope the card reads', () => {
    const entry = SRC.match(ENTRY)?.[0] ?? ''
    expect(entry).toMatch(/today:\s*true/)
  })

  // The TTL must be the shared constant, not a literal that happens to equal it today — the
  // one-canonical-TTL-per-key rule, now enforced by check-cache-ttl-divergence.js.
  it('uses the shared TTL constant', () => {
    const entry = SRC.match(ENTRY)?.[0] ?? ''
    expect(entry).toMatch(/TRAINING_STRESS_TTL/)
  })

  // No `?date=`: the route resolves today from the SESSION timezone, which is more correct than the
  // client's `todayInTz()` with no argument. A hardcoded date here would also freeze the warm.
  it('sends no date param, so the server resolves it in the user timezone', () => {
    const entry = SRC.match(ENTRY)?.[0] ?? ''
    expect(entry).toMatch(/url:\s*'\/api\/training-stress'/)
  })
})
