# Implementation Agent (B) 🚧 — baton

> **Successor sessions are titled `Implementation Agent (B) 🚧`** — exactly, emoji included. The
> title is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread
> even with a perfect baton.

**Updated:** 2026-08-20 · **By:** the seventh Lane B run · **Next ID:** `LB-1` (unused — this run
split and refuted rather than filing, so the letter is still at its start)

## Now
Nothing in flight. Five PRs merged this run, all green, nothing left open.

## This run (2026-08-20, seventh) — the queue's top four, and three of them were wrong

The top of the queue was docs debt and stale premises. **Three of the four entries taken did not
survive re-verification**, which is the run's actual finding: `next-item.js` tells you what is
startable, never whether it is true.

- **PS-1 SHIPPED** (#266) — `docs/agents/README.md` §3 listed `lib/coach/` as Lane A while Q-407 told
  whoever took it the directory *"belongs to neither lane's declared paths"*. **Six `app/api/coach/**`
  routes import it** (nine imports; `apply.ts` and `patch.ts` also write storage), so the path rule
  answers Lane A twice over. Q-407 also cited a README section that does not exist. Grepped for the
  same shape elsewhere: none.
  [Journal](../../overview/entries/2026-08-20-docs-lane-coach-contradiction.md).

- **PS-2 SHIPPED** (#268) — the extracted doc-size history was deduped. **PS-2 said one block,
  duplicated twice, byte-identical. It was eight records, two of them appearing three times, and
  none byte-identical.** Three of the eight differ in their *opening line*, so grouping by first line
  finds five of eight and looking for exact repeats finds none; a similarity sweep over whole records
  finds all eight above 0.80. **Deduping was a merge, not a delete** — each copy had drifted and
  carried a fact the others lacked. Two independent records had been glued inside duplicates with no
  blank line and would have gone with a wholesale delete.
  [Journal](../../overview/entries/2026-08-20-docs-baseline-history-dedupe.md).

- **Q-362 REPRODUCED AND SPLIT** (#272) — the entry asked to establish the collision before fixing
  it. Two same-named sessions on one Brisbane day return **one** `workoutDurations` key holding only
  the later window. The consumer half was recorded as "one line in one file"; **it is three files**,
  and `day-overlay-sheet` groups by name and then calls `loadSessionHr(sessExercises[0].workoutSessionId)`
  — **one session's heart rate under a card listing both**, which is a worse bug than the duplicated
  duration it was filed for. Now `Q-362a` (Lane A, the route) and `Q-362b` (Lane B, `Needs: Q-362a`).
  [Journal](../../overview/entries/2026-08-20-docs-split-day-log-session-identity.md).

- **Q-423 REFUTED** (#273) — *"the per-set RPE prefill is measurably low"*, 233 raises against 32
  lowers. **The prefill reads `planned_pct`, and 312 of the 625 sets have none** — the column only
  exists since July 2026. Reproducing the entry's table with `COALESCE(planned_pct, intensity_pct)`
  returns its +0.41 and its 7.11 exactly, so the missing 312 were scored against the *achieved*
  intensity. On the 313 that carry one: **288 unchanged, 25 raised, 0 lowered, +0.125**, and
  `floor(pct/10)` is the modal rating at **all sixteen** observed percentages. `round` misses five and
  turns 25 under-prefills into **82 over-prefills**.
  [Review](../../reviews/2026-08-20-rpe-prefill-mapping-fit.md) ·
  [Journal](../../overview/entries/2026-08-20-docs-refute-rpe-prefill-mapping.md).

- **Q-359's fixture SHIPPED** (#275) — the only code this run. Q-402's fix had merged **unguarded**:
  three attempts to drive it measured zero `/api/nutrition/energy-balance` requests. Both blockers are
  fixtures now (`ensureEnergyBalanceProfile`, `enableHomeCards` in `e2e/fixtures.ts`) and
  `e2e/home-card-invalidation-refetch.spec.ts` drives the mechanism end to end. Mutation-checked both
  ways. [Journal](../../overview/entries/2026-08-20-home-card-invalidation-guard.md).

## Next
Work the queue top-down with `node scripts/next-item.js --lane B`, and **re-verify the premise before
building** — three of four failed that this run.

1. **Q-359's remainder** is twelve latent fetch-once sites, all unmounting, none able to bite. Judge
   each individually; it is not a codemod. Low value now that the fixture and guard exist.
2. **Q-323 / the `calorie-budget-surface` batch (Q-417 + Q-415)** — three calorie budgets disagreeing
   across Home and Nutrition. This is the real next work and it is genuinely Lane B.
3. **Q-406 before Q-395** — `food-row.tsx` has to be extracted first; both landing files sit on the
   800-line limit, so a rework has nowhere to land until it is.

## Do not re-litigate
- **`lib/coach/**` is Lane A.** Settled by PS-1 against the import trace, not by the path list.
- **`floor(pct/10)` is the right RPE prefill.** Refuted on production data, with the candidate
  mappings scored. Do not re-propose `round`, and note the review also records **why Q-423's own
  acceptance criterion picks the wrong answer**: 92% of the ratings were never touched, so they *are*
  the prefill, and any statistic over all of them is the prefill agreeing with itself.
- **The seeded user is missing only `date_of_birth`**, not `height_cm`/`sex` — both are present. The
  older note in Q-359 saying otherwise is corrected.
- Everything in the previous baton's "Do not re-litigate" still stands: `FactorBar` is not a
  colour-only violation, absent scores are handled correctly on all 14 surfaces, Q-309 is refuted as
  a user-facing bug while Q-354 (mouse clicks on Nutrition) is real and parked, `radiogroup` beat
  `group` + `aria-pressed`, and `coach-content.tsx`'s `scrollIntoView` is correct.

## Owed (device / physical — unchanged from the previous run)
- A **test print** of the meal label, black band first (Q-389) — 0.49–0.66 mm per module, ink spread
  is the expected failure and presents as "the scanner is broken".
- The meal-label **camera scan on device**, the Web Share hand-off, and the two new fonts (Q-389).
- A **TalkBack pass** on the S25 over More → Goals and More → Edit Profile (Q-261, Q-350).
- Home with the **"Accent ring"** style on the S25 (Q-281) — the band word is 7.5 px, verified only
  in a browser at 412×915.
- A **drain run** on the S25 confirming `/admin/oura-ble` holds still while the log streams (Q-532).
- **Q-450's device path** — the E2E run took the web fallback, not SQLite + outbox.

## Claimed paths
None held. The previous run's four "release when convenient" claims
(`packages/shared/src/nutrition/label-payload.ts`, `lib/github-release.ts`, `lib/sqlite/cache.ts`,
`.github/workflows/ci.yml`) are released — every branch holding them has merged, and a claim whose
branch is gone is gone with it.

This run touched `docs/doc-size-baseline.json` and `docs/doc-size-baseline-history.md`, neither a
lane path; both are shared by every agent and neither is held.

## Gotchas worth carrying
- **`get_check_runs` lags reality; attempting the merge is the reliable check.** Confirmed twice this
  run — #266 merged cleanly while the endpoint still read `Tests: in_progress`. `merge_pull_request`
  validates against real branch protection and cannot merge a genuinely pending check.
- **`main` can sit over the doc-size ratchet, and then Custom Rules is red on every branch.** Hit
  this run on a PR touching neither `projectOverview.md` nor the baseline. Raise to main's number and
  record it; do not trim another lane's landed work to satisfy a counter. Third occurrence — **Q-424**
  is the entry for it.
- **Two same-day baseline raises collide on one line.** Also hit this run: raised to 7841, main raised
  to 7848 within the hour. **Take `origin/main`'s file whole and re-measure the merged tree** — never
  splice the hunk.
- **`node_modules` can be stale against `main`.** `pnpm dev` died on a missing `@sentry/nextjs` that
  `package.json` lists; `pnpm install --frozen-lockfile` fixed it in six seconds. Suspect this before
  suspecting the app.
- **A backgrounded `pnpm dev` is killed with its task.** `setsid nohup pnpm dev > log 2>&1 &` survives;
  a plain background task does not.
- **The aged local seed still bites, exactly as recorded.** `goal-invalidation.spec.ts` needs today's
  `body_metrics` row to carry **steps**; this container's seed was filled on 08-18, so 08-20 had no
  row. Not a regression — top the row up. CI reseeds every run and never sees it.
- **The read-only production endpoint works from the sandbox** and is how Q-423 was settled:
  `curl -sX POST …/api/admin/db-query -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET"`. The secret
  is present in the environment. **Row-scoped to the owner** — never write a finding as though it
  covered other accounts.
- **`pnpm check:rules` ran 50 of 50 on 2026-08-20** (45 on 08-19). Quote the count, never "pass".
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the session hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`.
- **There is still no component-test infrastructure** — both vitest projects are `environment: 'node'`
  and `@testing-library/react` is absent. E2E is the only automated route to UI behaviour.
- **Mutation-check every guard you add.** Both guards this run were mutation-checked; the Q-359 one
  went red with its own message under the pre-Q-402 shape.
- **Check what a passing assertion would ACCEPT, not just that it passes.** Carried forward from the
  sixth run's Q-411 near-miss, and it is what caught Q-423's confounded criterion here.
