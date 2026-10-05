# LA-82 — a stand-in heart-rate anchor read exactly like a real one

**Branch:** `fix/la82-stand-in-hr-sources` · **Version:** 1.484.2

Lane A's half shipped on 2026-09-28: `resolveHrProfile` guards all three of its reads, so a
transient fault no longer takes a screen down — it substitutes a value and **names the substitution
in the source field**. Nothing rendered those fields.

Re-verified against `main` before building, because TN-32 had just changed a neighbouring surface:
`observed-hr-card.tsx` still tested `=== "observed"` and printed everything else as
*"age-estimated"*, and the hub's heart card carried no source at all. Both claims held.

## What that meant

- `maxHrSource: 'estimated-age-unread'` is the **generic 190**, not 220 − age. For this owner that
  moves every zone boundary by 6 bpm, and it read identically to an estimate from a known age.
- `restingHrSource: 'unavailable'` (the read failed, 60 assumed) was indistinguishable from
  `'default'` (never measured) — and from a real measurement.

## What shipped

`components/health/hr-source-copy.ts` — one place both surfaces take their wording from, so they
cannot drift into describing the same provenance two ways:

| source | reads as | stand-in |
|---|---|---|
| `observed` | your recorded max | no |
| `estimated` | age-estimated | no |
| `estimated-age-unread` | **a stand-in**, with what it costs the zones | **yes** |
| resting `measured` | *(nothing said)* | — |
| resting `default` | assumed — wear your ring overnight | yes |
| resting `unavailable` | a stand-in — couldn't be read | yes |

Both stand-in lines end with *"zone boundaries are approximate until it loads"*, which is the part
the reader can act on, and a test asserts every stand-in carries it.

One judgement worth recording: **"Still learning your range" is suppressed while a stand-in shows.**
That line describes a profile being built; a value that could not be *read* is a different thing to
tell someone, and showing both at once says two contradictory things about the same number.

## Verified

- `la82-hr-source-copy.test.ts` — **6 tests**, including the age-unread/age-estimated split that is
  the defect, `default` and `unavailable` asserted to say different things, and both fields
  degrading quietly to "not a stand-in" on a payload cached before the route sent them.
- `e2e/la82-stand-in-hr-sources.spec.ts` — **3 tests** at 412 px dark against the real hub, which is
  the entry's own *Done when*: with the age unread the hub renders **and says the max is a
  stand-in**. Plus the failed-resting case suppressing "still learning", and a clean profile saying
  nothing, anchored on a positive assertion so it cannot pass vacuously.
- `npx tsc --noEmit` · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors ·
  `pnpm test` **9,541 passed** · `pnpm build`.

## Not exercised

- **A real failed read.** The sources are injected; reproducing `getUserById` failing would need the
  database taken away mid-request, which the sandbox cannot do. The engine's own guards are Lane A's
  and already tested.
- **The device.** No native, safe-area or gesture change.
