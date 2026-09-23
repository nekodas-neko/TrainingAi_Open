# 2026-09-23 — LB-129: the day review on a cold flip into Nutrition

**Branch:** `fix/lb129-day-review-cold-flip` · **Lane B** · v1.465.19

## What shipped

`EndOfDayReview` is now a **static** import in `app/nutrition/nutrition-content.tsx` rather than a
second `dynamic({ ssr: false })` nested inside the tab's own lazy chunk. The screen is already
code-split and warmed on idle by the shell, so the inner boundary kept almost nothing out of the
initial bundle while adding a chunk that has to be fetched at the moment the sheet opens.

**This is a plausible fix, not a demonstrated one, and the entry says so.** Reversal is one line.

## What was actually measured

Instrumented in the Playwright harness, driving the real app:

- **The param is not the problem.** At the failing timing the effect reads
  `sp=review=day loc=?review=day` and `reviewOpen` goes `false → true`. No error, no `pageerror`.
- **`EndOfDayReview`'s component body never runs** while `reviewOpen` is true — its chunk had not
  resolved. The defect is downstream of the param, in chunk loading.
- **It is a race with a clean bracket:** flip the instant `settleRouteBoundary` returns and the
  sheet does not appear within 12 s; wait 1500 ms and it opens; 6000 ms, sooner.

## Why this is not closed

**The harness cannot separate this from a dev-compiler artefact.** It drives `pnpm dev`, where a
cold chunk is compiled on demand — seconds, visible in the server log. With the fix reverted and the
window widened to 20 s the sheet *did* appear, so the chunk resolves late rather than never. In a
production build it is prebuilt.

A production-mode run would settle it and is **not available in this sandbox**: `next start` sets
`NODE_ENV=production`, which turns the pg pool's SSL on, and the local Postgres speaks none, so every
request dies. Only the device or a Railway preview can tell the two apart. `Gate: device`.

## Two traps, both of which cost a pass

- **The obvious probe gives a false pass.** Flip, then read `[role="dialog"]` — Home auto-opens the
  Morning Check-in for a user who has not done one, so the role is satisfied before the flip and the
  assertion passes without the day review ever appearing.
- **The spec was deleted rather than committed.** It passed with the fix *and* with the fix
  reverted, so it was a green tick proving nothing — the same failure LB-133 was about. A regression
  guard for this needs a control run showing it red first, and on this evidence none can be written
  in the sandbox.

## Also ruled out

The **back-dismiss machinery**, the most tempting candidate because `sheet-back-stack.ts` carries a
documented bug where *"the dialog closed on the frame it opened"* (BF-34). `handlePop` runs only on
a `popstate`, and a tab flip emits none — `tab-shell.tsx:103` uses `replaceState`. The timeline also
shows the sheet never opening rather than opening and closing.

## Not exercised

Device, native SQLite, safe-area, Samsung WebView, drifted prod data — and, unusually, **the
production build itself**, which is the one surface that would make this conclusive.
