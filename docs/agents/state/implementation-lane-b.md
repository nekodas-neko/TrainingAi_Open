# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The title is how five concurrent sessions stay tellable apart; a renamed
> successor is a lost thread even with a perfect baton.

**Updated:** 2026-08-17 · **By:** the fifth Lane B run · **Q band:** 350–386 (next free: **357**)

## Now
Nothing in flight once PR #50 lands. Eleven items closed today:

- **Q-281 audit half** (v1.318.10, PR #50) — every surface rendering a pillar score enumerated:
  [`docs/reviews/2026-08-17-score-presentation-audit.md`](../../reviews/2026-08-17-score-presentation-audit.md).
  **9 of 14 render a score with no contributors and no trend**; exactly one has all three. Shipped the
  colour-only-state carve-out with it (the Home "accentring" band dot now carries its word), guarded
  by `e2e/score-band-not-colour-only.spec.ts`. **The UI half stays held** per the entry's own
  sequencing. [Journal](../../overview/entries/2026-08-17-score-presentation-audit.md).

- **Q-305's measurement gate** (PR #49, docs-only) — the entry blocked its own implementation on a
  4–8 week re-run. Done over 56 days, and it **inverts the finding**: the §3 table compared against
  the *raw* hypertrophy landmarks, but they are goal-scaled and the active program is
  `powerbuilding` (**×0.8**). Three muscles above MRV, calves at 47% of MEV, lats and upper back
  **in range** rather than below MEV.
  [Journal](../../overview/entries/2026-08-17-volume-landmarks-remeasured.md).

- **Q-350 + Q-355** (v1.318.7) — all eight radiogroups now share `lib/hooks/use-roving-radio-group.ts`
  for arrow keys and a roving tabindex (a **hook**, not the component the entry proposed), and the
  three goal groups no longer eject keyboard focus mid-save.
  [Journal](../../overview/entries/2026-08-17-radiogroup-keyboard-nav.md).

- **Q-457** — `lib/github-release.ts` defaulted `APK_RELEASE_REPO` to the archived private repo.
  Now defaults to the public one, guarded by a test on the URL actually requested.
  [Journal](../../overview/entries/2026-08-17-apk-release-repo-default.md).

- **Q-352** — the E2E harness now has a zero-data account (`e2e/zero-data.setup.ts`), and Q-451 and
  Q-452 are guarded by `e2e/first-run-empty-states.spec.ts`. Carries a **correction** to yesterday's
  Q-452 claim about the heart-rate fields.
  [Journal](../../overview/entries/2026-08-17-zero-data-e2e-fixture.md).

- **Q-309 REFUTED** — a real touch tap on Nutrition works; `.click()` sends a mouse sequence with no
  touch events. Spec now uses `touchscreen.tap()`. Residue is **Q-354**.
  [Journal](../../overview/entries/2026-08-17-nutrition-tap-refuted.md).

- **Q-452** (v1.318.6) — `AiInsightCard` now takes a required `hasData`. **Client half only — the
  prompt half is Q-353, Lane A's.**
  [Journal](../../overview/entries/2026-08-17-ai-insight-sufficiency-gate.md).
- **Q-451** (v1.318.3) — a new account's Workout tab was an empty card with a dead Start button.
  [Journal](../../overview/entries/2026-08-17-workout-select-empty-state.md).
- **Q-450** (v1.318.1) — `/activity` with no type recorded an activity and discarded it on Save.
  [Journal](../../overview/entries/2026-08-17-activity-untyped-entry.md).
- **Q-532** (v1.317.6) — `scrollIntoView` on a sentinel dragged the whole page.
  [Journal](../../overview/entries/2026-08-17-scroll-panel-page-jump.md).
- **Q-261** (v1.317.4) — six bare `<Label>`s fronting button groups.
  [Journal](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. **The queue re-prioritises daily** — re-read it rather than trusting this list.

**Lane B's implementable queue is drained.** The queue was walked end to end on 2026-08-17: what
remains for this lane is either held by its own entry, blocked on the owner, or needs a planning PR
first. Concretely:

1. **Q-531** — ⛔ blocked on an owner decision, see below.
2. **Q-281's UI half** — deliberately held by the entry: it is presentation over numbers that
   Q-500/Q-272/Q-275/Q-277 are about to change, so building it now means building it twice. When it
   is unheld, the audit's recommendation is **trend, not contributors** — only 1 of 14 surfaces shows
   a trend, and contributors are genuinely inapplicable to a chip or a timeline row.
3. **Q-305's surface half** — needs the cross-item design decision the entry raises (one shared
   treatment across Q-278 / Q-302 / Q-305, or a third bespoke card) and therefore a planning PR
   first, per the backlog protocol.
4. **Q-278** — cross-lane: its scope item 1 (generalise `ScoreAvailability`) is `lib/health/`, Lane
   A's. Only the surface sweep is Lane B's, and it depends on item 1. **Read Q-281's audit before
   planning it** — two of its premises are refuted there.

**Q-354 is diagnosed and deliberately parked** (not deleted): the date-swipe `useDrag` binding
swallows mouse clicks on Nutrition — proven by removing it and watching every mouse path start
working — while touch is unaffected. `pointer: { mouse: false }` does not fix it. No supported user
produces mouse input, so a gesture rewrite is not justified.

Everything else in the queue is Lane A's (Kotlin/BLE, sleep-window data, DB sizing, migrations,
scoring, prompts) or was routed there by this lane: **Q-351** (activity `durationMin` 0 → 400),
**Q-353** (the health-insight prompt's "no data") and **Q-356** (the daily CI failure below).

## ⚠️ Blocking everyone, not just this lane
- **Q-356** — `lib/data/postgres/__tests__/periodization-soft-delete.test.ts` fails **14:00–16:00 UTC
  every day, on any branch**: it inserts a session at `now() - 1 hour` (UTC) and queries a
  Brisbane-local day window, so just after Brisbane midnight the fixture lands on the previous local
  day and all five assertions see zero sets. Reproduced against a fresh seed; measured at 14:35 UTC.
  **Lane A's file.** Until it lands, no PR can merge in that window — the required Tests check is
  genuinely red, and merging past it is not an option.

## Blocked
- **Q-531** `[app-shell][devices]` — needs an owner decision, annotated in the backlog. It asks for
  the premise of a shipped IA decision (Q-234) to be re-litigated; do not pick the new structure
  yourself, since the entry's own point is that Q-234 reasoned taxonomically and was wrong in use.

## Owed
- **A TalkBack pass on the S25** (Q-261, Q-350) over More → Goals and More → Edit Profile.
- **A look at Home with the "Accent ring" style selected on the S25** (Q-281) — the new band word is
  **7.5 px**, verified only in a browser harness at 412×915.
- **A drain run on the S25** (Q-532) confirming `/admin/oura-ble` holds still while the log streams.
- **Q-450's device path** — the E2E run took the web fallback, not SQLite+outbox.

## Q numbers used from the band
- **Q-350** — DONE (v1.318.7).
- **Q-355** — DONE (v1.318.7), fixed alongside Q-350 rather than left half-shipped.
- **Q-352** — DONE. Zero-data E2E account + first-run guards.
- **Q-351** — **Lane A's to fix.** A sub-3-second activity rounds `durationMin` to 0 and
  `ActivityLogBody.durationMin` is `.positive()`, so the POST 400s and the activity is lost behind a
  generic toast. Measured (2 s → 400, 5 s → 201). The outbox parses the same schema.
- **Q-353** — **Lane A's to fix.** The health-insight prompt substitutes the literal `"no data"` for
  absent fields and the model reads it as a measured zero.
- **Q-354** — a mouse click on Nutrition's action row reaches the element and the handler does not
  run, this screen only. Touch works. Low priority on a touch-only target.
- **Q-356** — filed for **Lane A**: the daily 14:00–16:00 UTC CI failure above.

## Claimed paths
- **`lib/github-release.ts`** + `lib/__tests__/github-release.test.ts` — neither lane lists them;
  taken for Q-457 with Lane A's baton showing no claims. Release the claim when convenient.
- **`scripts/check-doc-index-size.js`** — not a lane path, but every Lane B PR touches its baseline.
  Both lanes raise it on the same days; **recompute from the merged file, never splice the hunk.**

Otherwise the lane list in [`docs/agents/README.md`](../README.md) §3.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md).
- **`FactorBar` is NOT a colour-only-state violation to fix.** It matches the rule literally (band
  colour on bar and value, no band word) and was inspected and **declined** in the Q-281 audit: the
  sub-score is already rendered as text beside the bar, so the state is in a non-colour channel, and
  a band word on each of 5–7 rows would crowd the densest surface in the app. If it is ever changed,
  the reason is crowding or clarity — not this rule.
- **Absent scores are already handled correctly everywhere.** Measured across all 14 surfaces:
  `—` on Home/day-detail, `—` with the band label *suppressed* on the detail hero, element hidden
  elsewhere. **No surface renders a null as 0 and none carries a value forward.** Q-278 says
  otherwise; Q-278 is wrong about this and the entry now says so.
- **Q-451's `programLoaded` is never set in a `finally`.** A failed first load with no cache holds
  the skeleton instead of claiming the account has no program.
- **The inert Start button was removed, not disabled.** A disabled primary CTA still asserts "this is
  the thing to do here", which is false when the prerequisite is elsewhere.
- **Home's `recommendation-card.tsx:281` is NOT the Q-451 bug** — same `x && f(x)` shape, but inside
  a `displaySession ?` branch, so it is redundant defence. Swept and cleared; don't re-file it.
- **Q-450's guard belongs at the destination, not the call sites** — a cold open reaches `/activity`
  with no call site at all.
- **`radiogroup` beat `group` + `aria-pressed`** for pick-one option sets (8 sites vs 1).
- **Q-309 is refuted as a *user-facing* bug** — touch taps work, measured many times. But the
  `useDrag` binding **is** what swallows *mouse* clicks (Q-354), proven by removing it.
- **`coach-content.tsx`'s `scrollIntoView` is correct** — no inner scroll container, so the page is
  genuinely its scroller.
- **Q-452 gates in the client, not the route** — a client gate costs no request at all.
- **The heart-rate `hasData` gate uses the trend series** because that mirrors what the *prompt*
  reads (`body_metrics`). **Not** because `data.hrMin`/`recentHrv` are broken — an earlier note here
  claimed they were live-ring-only and null, and that was wrong (`recentHrv` is 65 for the seeded
  user). Corrected 2026-08-17.

## Gotchas worth carrying
- **`scripts/check-doc-index-size.js` is a shrink-only baseline** on `projectOverview.md`,
  `docs/implementation-backlog.md` and `CLAUDE.md`, and it *will* fail your PR. Trim into the journal
  or a review doc first — those it does not govern. Q-281's first draft was 20 over and the ratchet
  was right: everything but the owed device check belonged in the review doc.
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`.
- **A localStorage-preference-dependent screen is testable** — `page.addInitScript(() => localStorage.setItem(...))`
  before `goto`. Q-281's guard does this rather than driving the settings UI, so an unrelated screen
  cannot break it. `ta_score_ring_style` is the key for the Home score-ring style.
- **Every committed spec runs as one seeded user who has a program, logs and metrics**, except those
  that `test.use({ storageState: ZERO_DATA_STORAGE_STATE })` (Q-352's account).
- **Write E2E specs for real flows — they find things reading cannot.** The Q-450 spec failed on its
  first run for an unrelated reason, which is how Q-351 was found.
- **`.click()` does not always activate a button in the mobile context** — see Q-309 and the note in
  `e2e/water-log-write-path.spec.ts`. First suspect when a click silently does nothing.
- **There is no component-test infrastructure** — both vitest projects are `environment: 'node'` and
  `@testing-library/react` is absent. E2E is the only automated route to UI behaviour.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red (Q-259's lesson).
  Q-452's first guard **passed** under mutation and had to be rewritten to assert on the *request*.
  Asserting "the thing is absent" is not a guard when it is absent either way.
- **A long-lived local DB ages out of its seeded window.** `seed.sql` fills 14 days ending at the
  *user's* Brisbane today, and `setup.sh` will not re-seed a non-empty `users` table — so once the
  session crosses Brisbane midnight (14:00 UTC), `e2e/goal-invalidation.spec.ts` fails locally while
  CI (fresh seed every run) stays green. Not a regression. Top up today's `body_metrics` row.
- **A fixed short wait is not a measurement on a cold dev server.** A 6 s probe read a not-yet-loaded
  `/api/readiness-score` as "no data" and produced a wrong, confidently-stated finding. Use `toPass`
  with a real budget; `goal-round-trip` records 39.7 s cold.
- **The remote branch ref goes stale after every squash-merge**, and push is rejected as "behind".
  Force-push is not permitted here — `git fetch origin <branch> && git merge FETCH_HEAD` is a content
  no-op that clears it. Verify with `git diff HEAD origin/main --stat` before pushing.
- **`pnpm check:rules` ran 38 of 38 on 2026-08-17.** Quote the count, never "pass" — it moves.
