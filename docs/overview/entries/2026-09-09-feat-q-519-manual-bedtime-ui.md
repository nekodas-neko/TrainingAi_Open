## 2026-09-09 — The bedtime you remember (Q-519, UI half)

**Branch:** `feat/manual-bedtime-entry` · **Lane B** · PR #1011

### What shipped

A card on Health → Sleep for the latest night: set a remembered bedtime, change it, clear it. Queued
through the `manual_bedtime` outbox domain so it survives offline, with a direct POST as the fallback
where there is no local store.

**The engine had shipped on 2026-08-26 and nothing could write to it.** Migration 233, the repository
method, the route, the outbox domain, the local column and the one read site all existed; the control
did not. That is the shape OR-105 is about — work that reads as done because most of it is.

### What it deliberately does not touch

`manual_sleep_start` and nothing else. Not the measured start, not a duration, not an efficiency, not
a synthesised end. The original design wrote the remembered value into `sleep_start` and leaned on the
per-field merge; the audit that design commissioned found three consumers deriving behaviour from the
*window* rather than the stored columns — one turning a 3-hour night into **9 hours at 34%
efficiency**, another moving five awake hours into a nightly training set with no fragmentation
needed. The card shows the measured start beside the field as the contrast that makes the control make
sense, and changes nothing else on the screen.

### The date rule, which is the trap

A night dated `D` begins the **evening before** when the remembered time is before midnight, and on
`D` itself when it is after. So 23:00 and 00:30 for the same night belong to different days, and
getting it backwards stores a value 24 hours out.

The split is at **noon** — the same anchor `minutesFromNoon` uses, for the same reason: nobody's
bedtime lands at midday. `bedtimeInstant` owns it, tested across the noon boundary, month ends
(`2026-09-01 → 08-31`, `2026-01-01 → 2025-12-31`, `2026-03-01 → 02-28`) and the timezone (23:00
Brisbane is 13:00 UTC — a UTC-built instant is ten hours out).

**It changes nothing the app computes today**, and that is written down because it is why someone
would delete it: the sole reader, `/api/user/bedtime-estimate`, passes the value through
`minutesFromNoon` and sees only the clock time. The date is there for the row being honest and for
the first display that ever shows it.

### The gap this leaves, and it is Lane A's

**`/api/sleep-sessions` does not return `manualSleepStart`** — the repository maps the column
(`adapter.ts:2716`), the route's field list omits it. So the card reads the value from the local
store instead, which means on the **web** build the saved bedtime reads as unset while the write
works; on the APK it reads correctly. Reading through the screen's own rows was not an option either:
they are local-first only until the network answers, and the network payload overwrites them without
the field.

One line, in an `app/api/**` path, so it is filed on Q-519 rather than taken here.

### Verification

9 unit tests over the date logic, including every refusal — `parseClock` returns null for `24:00`,
`23:60`, `2315` and a bare `23:1`, because whatever it returns becomes a stored timestamp.
`e2e/manual-bedtime.spec.ts` drives the real screen at 412 dp and intercepts the route: saving posts
an ISO instant, and **clearing posts an explicit `null`** rather than omitting the key, which the
route's `.strict()` schema requires.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · full unit suite green ·
the new e2e green.

**Not exercised:** the S25 and Samsung WebView, and the offline path — the queued mutation draining
after a reconnect is the half a browser cannot show. The engine half was never device-verified either
(its local column arrives through `reconcileSchema` on a real device, and no APK has run), so that
check now covers both halves.
