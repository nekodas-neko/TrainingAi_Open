## 2026-07-28 — Stop escalating the ring's live-HR loop when the chest strap already covers (v1.229.3)

Follow-up to the same session's chest-strap bug-fix batch. The owner asked how HR source
precedence works during a workout — specifically, whether attaching the chest strap "powers down"
the Oura ring. Investigating the read path (`activeSourceId()` correctly prefers the strap) turned
up a separate write-path bug: the ring's aggressive live loop was never actually gated on the
strap's presence.

### What was wrong

`lib/live-hr/manager.ts`'s `wants()`:

```ts
function wants(s: LiveHrSource): boolean {
  return ambientIds.has(s.id) ? (ambientWanted || workoutWanted) : workoutWanted
}
```

The ring (`oura_ble`, not in `ambientIds`) was wanted whenever `workoutWanted` was true — full
stop, regardless of whether the strap was already connected and covering. So during every workout
with the strap on, `OuraRingSource.start()` still ran: `CONNECTED_LIVE` mode plus a `triggerHrBurst()`
call every 10s and a `drainHistory()` call every 20s, for the whole session. Since the strap already
wins `activeSourceId()`'s read-path precedence, none of those ring beats were ever surfaced — pure
battery drain for zero benefit. This directly contradicts Goal 3 of the plan that shipped the
always-on chest strap (`docs/superpowers/plans/2026-07-19-always-on-chest-strap-hr.md`): "No new
drain on the Oura ring." The plan's own design section describes exactly this gate ("escalate the
ring only when `activeSourceId() !== 'chest_strap'`") — it was written down and never implemented.

### What shipped

1. **`wants()` gates the ring on strap-absence.** For a non-ambient source (the ring), wanted now
   requires `workoutWanted && activeSourceId() !== 'chest_strap'`.
2. **A 10s periodic re-check for the duration of a workout.** There's no push notification for a
   source's `connectionState()` changing — BLE connects/disconnects happen deep in native code —
   so without this, the gate would only ever be evaluated at the moment `start()`/`stop()` is
   called. `start()` now also arms a `setInterval` that calls `reconcile()` every 10s (matching the
   cadence of `OuraRingSource`'s own burst/drain timers); `stop()` clears it. This is what lets the
   ring escalate to cover a gap if the strap disconnects or comes off mid-workout, and de-escalate
   again once it reconnects, without the caller (workout screen, guided walk, fitness test) doing
   anything differently — the fix is entirely inside the manager.
3. **Read-path precedence is untouched.** `activeSourceId()`, the sample-subscribe filter, and
   every consumer of `useLiveHr()`/`getCurrent()` are unchanged — this only affects which sources
   the manager chooses to *start*.

### Tests were asserting the old (wrong) behaviour

Two of the five `describe('liveHrManager — ambient vs workout decoupling')` tests explicitly
asserted the ring always escalates during a workout, using a `LifecycleSource` fake whose
`connectionState()` flipped to `'connected'` the instant `start()` was called — unrealistically
instant, and it made the new gating's "ring should escalate until the strap actually connects"
case untestable. Decoupled the fake's connection state from its start/stop lifecycle (added an
explicit `.connect()` test helper, matching how a real BLE handshake completes some time after the
foreground service starts) and rewrote the two affected tests plus added three new ones:
- ring escalates while the strap is started-but-not-yet-connected,
- ring does NOT escalate once the strap is connected,
- ring de-escalates automatically once the strap connects mid-workout (fake timers,
  `vi.advanceTimersByTimeAsync`),
- ring re-escalates if the strap drops mid-workout,
- the periodic timer actually stops on `stop()` (no reconcile — and no ring restart — after the
  workout ends).

16/16 tests in `lib/live-hr/__tests__/manager.test.ts` pass.

### Consumers checked, unaffected

Every screen driving the manager (`workout-screen.tsx`, `guided-walk/walk-active.tsx`,
`fitness-tests/test-active.tsx`, `activity/run-active-screen.tsx`) and every reader
(`useLiveHr()` → `live-hr-chart.tsx`, `run-hr-zone-hero.tsx`, `test-hr-display.tsx`,
`measure-hr-now.tsx`) only consumes the resolved `bpm`/`live`/`stale`/`getCurrent()` output — none
of them branch on which underlying source is actually running, so this change is invisible to them
functionally. One minor, accepted diagnostic-clarity nuance: `getDiagnostics()` falls back to
whichever source *declares* a `getDiagnostics()` method when none is connected, which is the ring —
so the admin/debug HR diagnostics panel would show the ring's idle "disconnected, 0 frames" state
while the strap is actually covering fine. That panel is a niche debug tool behind a toggle, not
touched in this pass.

### Verification

`tsc --noEmit` clean, `eslint` clean on both touched files, full `pnpm test` — same single
pre-existing failure before and after this change (`implausible-cadence.test.ts`, a local sandbox
`DATABASE_URL` environment quirk unrelated to this diff, confirmed via `git stash` that it fails
identically without these changes).

**Not exercised — on-device.** This is a pure behavior-timing change to when native BLE calls fire;
whether the ring's actual battery drain improves during a real workout with the strap connected can
only be confirmed on the S25. See the Known-Issues row.
