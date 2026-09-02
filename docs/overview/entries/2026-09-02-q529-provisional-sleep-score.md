# Q-529 — a still-syncing night now says so, on all three surfaces that show it

**Branch:** `fix/mark-provisional-sleep-score` · **Lane:** B · **Domain:** `[sleep]` `[app-shell]`

The owner, 2026-08-20: *"that wake up time is way off, I woke up around 6am"* — a screenshot at 06:46
Brisbane showing a night the ring had not finished uploading, scored **47**, rendered exactly as a
finished night would be.

## The entry was stale, and that made the job smaller

Q-529's central claim: *"sleep stores no equivalent [provisional flag], so partial and finished
scores are indistinguishable."* True when it was written. **`lib/sleep/provisional.ts` shipped for
BF-83 on 2026-09-01**, and `/api/sleep-sessions` has returned a per-night `provisional` flag ever
since — computed per request from the rollup's coverage watermark rather than stored, because what it
describes changes without the row changing.

So the flag was already reaching the client in the JSON. **Four separate local `SleepRow` interface
declarations dropped it on the floor** — `health-content.tsx`, `health-sections.tsx`,
`session-select-content.tsx` and `sleep-content.tsx` each restate the payload, and none declared the
field. `provisional` was rendered for readiness contributors and the body-battery anchor, and for no
sleep surface at all.

The entry's own "first action" (build a recompute path) was therefore the wrong half, and the fix it
listed third — *"do not render a number that will change"*, marked as the only part shippable without
an APK — was the whole of the remaining work.

## What shipped

Three surfaces, because a mark on one of them is worse than none: the number the owner sees first is
the Home chip, and marking only the detail screen would leave the reported failure untouched.

- **The Home score chip** already had a qualified-number mechanism — a `TriangleAlert` glyph plus an
  aria-label suffix, driven by `lowWear` and `limited`. `provisional` joins it rather than inventing
  a second visual language. **The predicate was written out at three sites** (label glyph, band
  layout, compact layout), so a third qualifier had to find all three; it is now
  `components/health/score-qualifier.ts`, which is also what makes it testable — the chip row is
  `.tsx` and both vitest projects run `environment: 'node'`.
- **The Body tab's sleep card** gets a "Still syncing" pill. Once, not per figure: the duration, the
  score and all six stat chips move together, so badging each would say one thing six times.
- **The `/health/sleep` detail screen** gets the caveat in full, because that is where the chip's
  glyph leads and the glyph has no room for words.

**The aria phrase reads every qualifier that applies**, not the first. They are independent — a night
can be both short on wear and still syncing — and a listener who hears only one takes the number as
settled.

**An absent flag reads as settled.** The local-store seed has no rollup watermark to compute it from,
so offline the field is `undefined`; `?.provisional === true` is what stops that badging every
historical night as still-filling. That matches `isNightProvisional`'s own treatment of null
coverage.

## A hotspot, and the way out of it

`session-select-content.tsx` is shrink-only at 1448 lines, and adding the field pushed it to 1452 —
the same gate that caught LB-47. Rather than trim a comment to squeeze under, its local `SleepRow`
(a strict subset of the canonical one, and the fifth copy in the repo) became a `Pick<>` of the real
type. That removes lines from the hotspot instead of adding them, and the `Pick` is the honest
shape: it names the fields Home actually uses, and keeps the local-store seed's narrow object literal
assignable.

## What the caveat turned up, which is not this entry's

Q-529 said to re-read `computed_at` for 2026-08-20 before building anything. It has moved and the
score now reads **62**, so this is latency rather than a missing recompute — the alternative the
caveat named.

But the wider read is worse than the entry assumed. **`oura_daily_derived` holds four distinct
`computed_at` stamps in its entire history**, with a **nine-day gap** (2026-08-24 → 2026-09-02) in
which nothing was written, and the most recent pass rewrote 85 rows minutes after a Railway deploy.
If deploys are what recompute scores, the refresh cadence is release frequency. Filed as **LB-53**
for Lane A. It makes this change more load-bearing rather than less: the provisional state may
persist for far longer than the ~9-minute window Q-529 measured.

## Verification

11 unit tests, the predicate and the aria phrase driven directly, with **nine mutations killing
them**: provisional not counted as a qualifier, an empty cell marked, the provisional phrase silent,
only the first qualifier spoken, the oldest night read instead of the newest, an absent flag not
forced false, the sleep cell dropping the flag, and the card and detail screen each unmarked.

Two e2e specs in a real browser, stubbing the payload in both directions — a provisional night shows
the badge and its explanation, a settled night shows neither. Stubbed rather than seeded because the
real flag needs the ring's clock anchors and a rollup watermark, neither of which the seed database
has: against it every night reads final and the marked case is unreachable.

`pnpm check:rules` **Ran 67 of 67**; `tsc`, `check-test-typecheck` and lint clean.

## Not exercised

**A real still-syncing morning.** The flag is only true while the rollup has not read past a night's
end, which needs the ring mid-upload — the sandbox has neither. So the badge has been seen in a
browser against a stubbed payload and never against a genuine one; the device check is opening the
app during the morning upload window and confirming the mark appears, then clears once the night
settles. Also unexercised: the offline path, where `getLocalStore` returns null off the APK, so the
`undefined`-reads-as-settled branch has never run on a device.
