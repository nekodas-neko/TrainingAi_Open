# The three ACWR thresholds come from one place (Q-306, second issue)

**Branch:** `fix/consolidate-acwr-thresholds` · **Lane A** · no migration · behaviour unchanged

## Why

ACWR drove three separate behaviours at three thresholds, each declared where it was used:

| site | number | behaviour |
|---|---|---|
| `ai-periodization/emergency-deload.ts` | `acwr > 1.5` (inline literal) | fires an emergency deload |
| `health/activity-score.ts` | `ACWR_TAPER_START = 1.5` | starts the over-exertion taper |
| `lib/health/readiness-payload.ts` | `EARLY_DELOAD_ACWR_MIN = 1.2` | shows the early-deload card |

Two of those are the same boundary and nothing said so — they were 1.5 by coincidence of typing, so
moving one would silently have desynchronised a pair nobody knew was a pair. The third is a
deliberate exception, and its reason lived in a comment three files away from the band set it is an
exception to. A canonical `ACWR_THRESHOLDS` already existed and none of the three used it.

## What shipped

`ACWR_THRESHOLDS` (`packages/shared/src/ai-periodization/acwr.ts`) gains `elevatedMin: 1.2` and a
header naming, per boundary, which behaviour acts on it. The three sites now read from it: both
hard actions take `highMax`, and `EARLY_DELOAD_ACWR_MIN` re-exports `elevatedMin` under the name the
card's payload already uses.

**The numbers are untouched, deliberately.** Moving any of them changes who gets an emergency
deload, a score taper, or the deload card — a scoring change, which per CLAUDE.md is the owner's
call and not a tidy-up's side effect. This changes only where each number is written down.

## Verification

Four new tests in `packages/shared/src/ai-periodization/__tests__/acwr-threshold-consolidation.test.ts`.
They **scrape source rather than import values**: the claim is that the number is not retyped, and an
imported value cannot tell a literal `1.5` from a reference to one. Proven by mutation — putting the
literal back in `emergency-deload.ts` fails the trigger case.

`early-deload-thresholds.test.ts` stopped regex-scraping `EARLY_DELOAD_ACWR_MIN`'s numeric literal
(it no longer is one) and asserts against `ACWR_THRESHOLDS.elevatedMin` plus the derivation.

- `pnpm check:rules` — Ran 55 of 55. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- Affected suites (readiness, activity-score, ai-periodization, running recovery gate): 923 pass.
- Full suite: 3954 passed, 814 skipped, 2 pre-existing unrelated failures (missing `qrcode`).

## Not exercised

Nothing was seen on device, and `pnpm dev` could not be run (missing `@sentry/nextjs`). The change is
behaviour-preserving by construction and the value-pinning test says so, so the device risk is the
same as not shipping it.

**Q-306's first issue stays open** and is still blocked on Q-289: consolidating where the trigger
threshold lives does not decide what it should be.
