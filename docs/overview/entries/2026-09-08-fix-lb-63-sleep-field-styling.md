## 2026-09-08 — The Sleep Goal field is a field again (LB-63)

**Branch:** `fix/lb-63-sleep-field-styling` · **Lane B**

### What shipped

One className. `components/profile/goal-targets-section.tsx`'s Sleep Goal input carried
`border-0 bg-transparent p-0 h-auto` while Steps, Water and Calories all carry
`border-border bg-muted/60` — so in a column of bordered boxes it rendered as an unbordered strip and
read as text rather than something you can type in. It now matches its siblings.

The file was extracted whole in one commit, so there is no blame trail and no comment claiming the
difference was meant. Sleep is the one goal with no `RecommendedValue` under it — nothing in the app
computes a sleep target — which is a reason for its section to be *shorter* than the others, not for
its control to look like a different kind of thing.

### Why it was a separate PR

It was seen in a screenshot taken to verify **LA-75** (the placeholder copy fix) on the same four
fields, and deliberately left alone there: restyling a control is a design judgement and that was a
correctness fix, so shipping both would have made each harder to review. Filing it under **No
orphaned findings** is what carried the judgement between the two PRs instead of losing it.

### Verification

Rendered on a local `pnpm dev` at the 412 px S25 viewport, signed in as the seeded user — the entry
asked for this specifically ("confirm on the S25 first; the difference is much clearer rendered than
in the class list"), and it is right that it did: the class list understates how much a missing
border changes what the control reads as.

`pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors on the changed file ·
`pnpm build` exit 0 · unit suite green.

**Not exercised:** the APK. A WebView-rendered form carried by a Railway deploy with no rebuild, but
confirmed at the S25 *viewport* rather than on the S25. No test asserted this styling before or
after; nothing selects on it.

Patch bump — user-visible.
