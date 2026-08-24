# A daytime-stress failure stops taking the whole Body Battery card down (TN-4)

**Branch:** `fix/body-battery-stress-guard` · **Lane A**

## What was wrong

`/api/body-battery` threw **31 × HTTP 500 between 10:37 and 20:59 UTC on 2026-08-23** with
`daytime-stress: constants not set — call setDaytimeStressConstants() first`, then stopped on its
own. `buildDaytimeStressSeriesFromModel` was called outside any try, so the throw reached the
route's outer catch and **the entire Body Battery card was down** — when the only thing actually
unavailable was the stress strip.

## What shipped — hardening, explicitly not a root-cause fix

Both changes the entry named as "worth doing regardless of root cause":

1. **Self-inject rather than assume boot got there.** The route now calls
   `tryEnsureServerOuraConstants()` before the stress block. The injector documents this exact use
   ("a composition root that is unsure whether boot reached it should just call it") and is three
   boolean checks after the first call. The **try** variant deliberately — the throwing one would
   turn a missing constants directory back into the 500 this removes.
2. **Guard the stress build.** `buildDaytimeStressSeriesFromModel` is now wrapped in try/catch, the
   same guard and same reasoning as the readiness call two blocks above it. Falling through leaves
   `stressSeries` empty, which the walk already handles — `stressAt` returns null and the
   `STRESS_DRAIN_RATE` term is never applied.

One thing worth recording: the accessor **cannot** be made self-loading, which is the obvious
reading of "lazily self-injecting". Q-545 deliberately keeps `node:fs` out of
`lib/health/daytime-stress.ts`'s module graph because the Oura rollup imports it, and that is the
difference between a rollup that runs in the WebView and one that cannot. The injection belongs at
the server-only call site, which is where it now is.

Also noted while tracing: `lib/data/index.ts` already calls the *swallowing* injector when the
repository handle is built — **so it can fail to take without leaving a trace**, which is consistent
with what production did. That is why the try/catch matters more than the injection.

## Verification — and a vacuous test caught before it shipped

`app/api/body-battery/__tests__/stress-failure-does-not-500.test.ts` mocks the stress builder to
throw the production error verbatim and asserts the route still answers 200 with a real reading.
Removing the guard fails it with **`expected 500 to be 200`** — the production signature exactly.

**The first version of that test passed identically with the guard removed.** It seeded only the
dHRV model row, so `tempBaseline` stayed null and the stress branch was never entered at all. The
branch needs `getOuraDaytimeSignals`, which decodes raw BLE frames — unreachable without real
`body_hex` plus a ring-clock anchor, so the test now overrides that one repository method and
carries a comment saying why the override is load-bearing. A regression test that cannot fail reads
as coverage and is worse than none; running the mutation is the only thing that surfaced it.

- All 5 body-battery test files: 18 passed, stable across 3 consecutive runs.
- Full suite: 4697 passed, 51 skipped, 2 pre-existing unrelated failures (missing `qrcode` in this
  sandbox).
- `pnpm check:rules` — Ran 55 of 55.
- `tsc --noEmit` clean.

**One unexplained flake, recorded rather than dismissed.** An earlier full-suite run showed one
additional failing test which I did not capture by name; two subsequent full runs and three
consecutive body-battery runs were clean. I cannot name it, so I am not claiming it was unrelated —
only that it did not reproduce.

## Not exercised, and the entry stays open

**The root cause is untouched.** Nothing here explains why the constants were unset for those ten
hours, and nothing here would have prevented the underlying condition — the card now degrades
instead of dying, which is a smaller outage, not no outage. Per CLAUDE.md, something that stopped is
not something that was fixed.

Not observed in production or on device; `pnpm dev` could not be run in this sandbox (missing
`@sentry/nextjs`). The `error_events` row prunes on 2026-09-22, so the mechanism has to be caught
before then if it matters.
