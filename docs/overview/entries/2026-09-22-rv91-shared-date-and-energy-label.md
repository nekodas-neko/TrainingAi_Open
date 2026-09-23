# 2026-09-22 — RV-91: a raw ISO date on two screens, and one `Cal` among 155 `kcal`

**Branch:** `fix/rv91-raw-iso-date-and-cal-label` · **Lane:** Implementation B · **Version:** 1.464.5

## What shipped

- **`components/health/activity-history-card.tsx:142`** and
  **`components/activity/activity-detail-sheet.tsx:148`** rendered `{log.date}` — the raw
  `2026-09-15` — on the line directly above a correctly formatted `formatTime12h()`. Both now call
  `formatDateDisplay`, the history row at `'short'` and the sheet header at `'long'`.
- **`components/home-day-timeline.tsx:117`** said `Cal` where the rest of the app says `kcal`.
  Re-counted on the day: **155 `kcal`, exactly 1 `Cal`**. A food Calorie *is* a kilocalorie, so
  neither label was wrong and the defect was the disagreement — 155 to 1 decides it.
- **A sibling the entry does not name:** `app/health/day/day-detail-content.tsx:186` hand-rolled the
  same long-form date. Its noon-UTC anchor rendered in UTC was correct — that pairing is what kept
  the day from shifting — and `formatDateDisplay` reaches the same string by constructing
  component-wise, which is the Q-130 fix. Routed through the helper here, per the sibling-surface
  rule.

## The entry quoted a comment instead of running the function

RV-91 says the same day reads *"Monday, 15 September"* in the day detail. **That string does not
exist anywhere.** It is the wording of `formatDateDisplay`'s own header comment, which is wrong
twice: `en-AU` is **day-first** and puts **no comma** before the day. Measured — `'short'` returns
**`15 Sept`** (not `Sep 15`) and `'long'` returns **`Tuesday 15 September`**. The day detail was
rendering the comma-less form all along.

Both facts are now pinned by assertions rather than left in prose, and the comment itself is in
`packages/shared`, which is Lane A's — so it is **filed, not edited**.

## Filed rather than dropped: LB-125

RV-91 closes with *"Also noted, not filed: four hand-rolled `toLocaleDateString` option bags sit
beside the shared helper."* Removing the entry would have dropped that, so it is now **LB-125**:
five remaining call sites (the count after this PR absorbs two), of which **three are a bare
`{ weekday: 'short' }`** that one new `style` variant would take, plus the wrong comment above. The
`style` half is Lane A's; the call sites are Lane B's.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean on the changed files.
- `components/health/__tests__/rv91-shared-date-and-energy-label.test.ts` — run against the unfixed
  files as a control, **4 of its 5 cases go red**. The fifth is a characterisation test of the pure
  formatter and correctly does not move; it is what caught the wrong comment.
- The `Cal`/`kcal` half is asserted as a **repo-wide count over `git ls-files`**, not against one
  file, because the defect *was* the count: one site disagreeing with 155 is invisible from inside
  that file. It also asserts `kcal` is still the majority, so the rule cannot be inverted quietly.

**Not exercised:** no device sitting. Render-only string changes in no device-gated class. No e2e —
the two assertions are a source shape and a pure function, and neither needs a browser.
