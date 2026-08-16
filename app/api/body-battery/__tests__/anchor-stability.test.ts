import { describe, it, expect } from 'vitest'
import { resolveAnchor } from '../anchor'

describe('resolveAnchor', () => {
  it('uses the derived readiness score when it exists', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: 77, ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  it('falls back to our own sleep score before readiness has been computed', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 61, anchorSource: 'sleep', provisional: true })
  })

  it('upgrades a provisional sleep anchor to readiness exactly once', () => {
    expect(resolveAnchor({
      persisted: { anchor: 61, anchorSource: 'sleep' }, derivedReadiness: 77,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  // The bug: without this, a later read that momentarily cannot see the derived row re-anchors
  // the whole day's curve back onto the sleep score and the number visibly jumps.
  it('never moves off a readiness anchor once the day has one', () => {
    expect(resolveAnchor({
      persisted: { anchor: 77, anchorSource: 'readiness' }, derivedReadiness: null,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  // A readiness recompute later in the day (different inputs, e.g. a logged check-in) must not
  // move the curve either — the day is settled on the number it was settled on.
  it('keeps the frozen anchor even when readiness has since changed', () => {
    expect(resolveAnchor({
      persisted: { anchor: 77, anchorSource: 'readiness' }, derivedReadiness: 84,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 77, anchorSource: 'readiness', provisional: false })
  })

  it('clamps and defaults when there is nothing at all', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: null, cloud: null,
    })).toEqual({ anchor: 50, anchorSource: 'default', provisional: true })
  })

  it('uses the frozen Cloud columns only as a legacy last resort', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: null,
      cloud: { readinessScore: 70, sleepScore: 65 },
    })).toEqual({ anchor: 70, anchorSource: 'readiness', provisional: false })
  })

  it('falls to the Cloud sleep score when Cloud has no readiness', () => {
    expect(resolveAnchor({
      persisted: null, derivedReadiness: null, ownSleepScore: null,
      cloud: { readinessScore: null, sleepScore: 65 },
    })).toEqual({ anchor: 65, anchorSource: 'sleep', provisional: true })
  })

  it('clamps an out-of-range score from any arm', () => {
    expect(resolveAnchor({ persisted: null, derivedReadiness: 140, ownSleepScore: null, cloud: null }).anchor).toBe(100)
    expect(resolveAnchor({ persisted: null, derivedReadiness: -5, ownSleepScore: null, cloud: null }).anchor).toBe(0)
    expect(resolveAnchor({ persisted: { anchor: 250, anchorSource: 'readiness' }, derivedReadiness: null, ownSleepScore: null, cloud: null }).anchor).toBe(100)
  })

  // A persisted sleep/default anchor is NOT frozen — it is the fallback the day started on, and
  // re-deriving it is how the upgrade above becomes reachable.
  it('does not freeze a persisted provisional anchor', () => {
    expect(resolveAnchor({
      persisted: { anchor: 50, anchorSource: 'default' }, derivedReadiness: null,
      ownSleepScore: 61, cloud: null,
    })).toEqual({ anchor: 61, anchorSource: 'sleep', provisional: true })
  })
})
