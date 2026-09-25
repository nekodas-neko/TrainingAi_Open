# 2026-09-25 — RV-102: the two halves that change nothing, and the one that is the owner's

**Branch:** `lane-b/rv102-dead-chart-tokens-and-shadow` · **Lane:** Implementation B

RV-102 bundled three things: five dead theme tokens, a duplicated colour table, and a merge of three
chart palettes into one. The first two are invisible defect fixes and shipped. The third changes
what the owner sees every session, so it went to him as `LB-153`.

## Verified before building, and two claims did not hold

**The contrast figure is exact.** `--chart-1` measures **2.72:1** against `--card`, matching the
entry to the digit, and it is the only one of the five under the 3:1 floor — the others are 7.52,
8.64, 4.50 and 4.94.

**"Declared twice… identical today" — the second half is wrong, and it decided the fix.** The
canonical table carries **13** keys; the picker's private copy had **10**, lacking `streakLeft`,
`streakRight` and `recommendedToday`. So this was never a copy-paste to delete on sight: pointing
the picker at the canonical table is only safe because the picker iterates its own
`CARD_WIDGET_DEFS` rather than the table's keys, which had to be checked. It does, so the three
extra keys cannot leak into the settings UI.

**The prescribed home for the shared palette is Lane A's file.** `packages/shared/src/chart-colors.ts`
already exists — `hr-recovery-chart.tsx` imports `resolveColor` from it — and `packages/shared/**`
belongs to Lane A by the path rule. RV-102 assigned the whole entry to Lane B.

## What shipped

Five `--chart-*` tokens gone from both palettes, plus five unused `@theme` aliases. Dead confirmed
by a tracked-files grep across `.ts`/`.tsx`/`.css` — the first attempt at that grep hit `.next/`
build output and returned a wall of minified CSS, which is a good reminder that "grep found it" and
"the source uses it" are different claims. Deleted rather than re-tuned, per the entry's own
preference not to leave a dead alternative; reversal is five lines.

`CARD_DEFAULT_COLORS` is one table, now typed `Record<CardWidgetKey | "streakLeft" | "streakRight" |
"recommendedToday", string>`. That is stronger than what either copy had: adding a widget key now
fails **at the table** instead of arriving at a call site as `undefined`. Mutation-checked — dropping
`collectionWidget` produces `TS2741` at `constants.ts` itself. The `CardWidgetKey` import is
type-only on purpose: a value import would close a real runtime cycle, because `home-prefs` reaches
back to this file through `home-card-widget`.

`app/__tests__/rv102-one-card-colour-table.test.ts` pins all three properties. It excludes itself
from its own scan in JS rather than in git — `git ls-files a b -- '*.ts'` unions pathspecs instead of
filtering, and this file names both of the things it bans. Control-run: all three assertions fail
against `origin/main`.

## What went to the owner

`LB-153`, `Lane: O`, ungated. The three "series 1" colours really are different — `#22c55e`,
`#f97316`, `#f59e0b` — but the case that matters is the workout screen, where set 1 is amber and set
2 is green **by index**, so the colour reads as a verdict on the set. Nothing is broken; which
palette to standardise on is a preference, and merging it would change three surfaces he looks at
daily. The brief carries the recommendation, what he would actually see change, three alternatives
with what each is better at, and the reversal cost (one constant).

**Not exercised:** nothing was opened on the S25 or in a browser — but neither shipped change alters
a pixel, which is why no device check is owed and RV-102 leaves the queue outright rather than
staying with a `Keep:`.
