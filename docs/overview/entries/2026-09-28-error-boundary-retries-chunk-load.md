# 2026-09-28 — LB-184: a chunk that did not arrive is retried, not shown as a crash

**Lane B.** Branch `fix/error-boundary-retries-chunk-load`. v1.481.1.

## Where this came from

`LB-178`'s third cause, found by reading the retained first attempt of a failing E2E run: Home had
crashed to the root error boundary with

> Failed to load chunk `/_next/static/chunks/components_activity_exercise-detected-card_tsx_….js`
> … (ecmascript, next/dynamic entry, async loader)

The spec's assertions never ran and it reported *"the sheet never auto-opened"*, which reads as a
broken feature.

## Why this candidate rather than the other two

Three fixes were available: drop `next/dynamic` for that card, build the app for E2E instead of
running `next dev`, or teach the boundary to retry. **The third is the only one that is also a
user-facing fix.** On the device a transient chunk fetch — a patchy moment on mobile data — put the
owner on an error screen until he tapped *Try again*. And the boundary already half-agreed with
this: its own comment calls an **offline** chunk failure *"expected"* and it auto-recovers on the
`online` event. Online, it dead-ended.

Building for E2E is still the structural answer to `next dev` compiling on demand, and it is
`.github/` rather than this lane's, so it stays open on `LB-178`.

## What it does

- **`lib/chunk-load-error.ts`** — `isChunkLoadError()`. Its own module because the strings come from
  three producers (webpack/Turbopack, Next's `next/dynamic` async loader, the native ESM loader) and
  because the decision it drives makes a false positive expensive.
- **`app/error.tsx`** — retries once, after 400 ms, **only while online**.

**The guard is module-level, and that is load-bearing.** `reset()` re-renders the errored segment,
so a failing retry remounts the boundary — a `useState` or `useRef` guard would be reset along with
it and the page would reload forever.

**The first failure is deliberately not reported.** A chunk that arrives on the second attempt is
noise; one that does not comes straight back through the boundary with the retry already spent, and
is reported then — once, and only when it is real.

**The match is deliberately narrow.** A false positive silently reloads a screen that was genuinely
broken, which hides a defect and is strictly worse than the dead end being removed.

## Verified

- **`lib/__tests__/chunk-load-error.test.ts`** — 5 tests. The **verbatim** message from the CI
  screenshot is asserted, alongside the other three producers' forms, and six near-misses that must
  NOT match (`Failed to fetch`, a hydration mismatch, a bare `chunk`, an ordinary TypeError). Two
  more pin the boundary's wiring: the guard is module-level, and the retry never fires offline.
- **Control-run three ways, each mutation asserted as applied:** loosening the match to any `chunk`
  → the near-miss case fails; the guard demoted to a `const` that is never set → the module-level
  assertion fails; dropping the `!isOffline` condition → the offline assertion fails.
- `tsc` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full `pnpm test` green ·
  `pnpm build` clean.

## Not exercised

**The retry itself was never observed firing.** Provoking a real chunk-load failure needs either a
dev server mid-compile or a throttled network, and neither is arrangeable in the harness — so the
classifier is tested by calling it and the wiring by reading it, not by watching a screen recover.
**Whether this reduces the E2E churn is measurable and unmeasured**: the next census is the test.
Not device-verified, and the device case — a transient fetch failure on mobile data — is exactly the
one no sandbox can produce.
