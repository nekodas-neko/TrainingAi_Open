# RV-103 — the failure line was fifteen seconds away, and nothing filled the gap

**Branch:** `fix/rv103-balance-refresh-in-flight` · **Entry:** RV-103 (sweep-2 FAILURE addressed, device check owed) · **Version:** unchanged

## The failure

RV-103 shipped on 2026-09-22 and the device check **failed** on sweep 2. With `energy-balance`
blocked at the network, logging a food left the card on **"320 kcal left" for 7 seconds** with no
failure line and no Retry — a pre-write number presented as current.

The tempting reading is that the reporting never worked. It does. Every channel the original fix
added is wired correctly, and **none of them could have fired in seven seconds.**

## Measured, not reasoned about

`fetchWithRetry` makes four attempts with 2.5 s + 5 s + 7.5 s of backoff between them. Driven with
fake timers:

| at | attempts run | `onExhausted` |
|---|---|---|
| 7 s | 2 | not yet |
| 15 s | 4 | fired |

So the honest report is **fifteen seconds** away. The other channel cannot help: `onRevalidateError`
fires only when a cached value was painted, and the write's own `invalidateNutritionWrite()` has just
emptied the key — on the post-write path it is silent by construction. That leaves fifteen seconds
in which the screen has nothing to say and says nothing.

That is the defect: **not a missing failure state, a missing in-flight one.**

## Fix

`useEnergyBalanceRefetch` exposes `refreshing`, raised when a refetch starts and cleared on all three
exits — a painted value, exhaustion, and a failed revalidation. `EnergyCard` renders *"Refreshing
your budget…"* in the **same slot** the failure line uses, so the card does not reflow when one
becomes the other, and the two are mutually exclusive at the render site as well as at the hook.

Nothing about the retry ladder changed. Shortening it would trade self-healing for speed, and
`fetch-with-retry.ts` is Lane A's file in any case; the gap is covered where it is felt.

## Verification

- **Three new tests.** The timing table above is one of them, driving the real `fetchWithRetry` with
  a dead fetch and fake timers. **Control-run against `origin/main`: two of the three go red** — the
  hook and card assertions. The timing test passes on `main` too, and that is correct: it documents
  the mechanism the device hit rather than guarding this change. Saying so beats implying all three
  discriminate.
- One older assertion in the same file needed loosening: it pinned `if (d) setBalance(d)` as exact
  text, and the in-flight clear now sits beside it. The invariant it exists for — never write null
  into the balance — is unchanged and still asserted.
- `app/nutrition/__tests__` + `components/nutrition/__tests__`: 42 files, **370 tests** green.
- `pnpm check:rules` **Ran 77 of 77** · `tsc --noEmit` clean · test-typecheck at baseline.

**Not exercised:** the S25, which is the point of the entry and why it keeps its `Keep:` under
`Lane: DV`. The device check now covers both lines — refreshing within about a second, the failure
line and Retry replacing it at ~15 s, both legible at the S25 width. Blocking the route needs CDP at
the network layer, because `page.route` cannot see service-worker fetches. Samsung WebView
rendering, safe-area and drifted production data untested.
