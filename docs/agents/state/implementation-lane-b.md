# Implementation Lane B — baton

**Updated:** 2026-08-17 · **By:** the first session to run as Lane B · **Q band:** 350–386 (next free: **351**)

## Now
Nothing in flight. Q-261 shipped as v1.317.4 — the six bare `<Label>`s in `components/profile/` that
front button groups rather than controls. Five became `role="radiogroup"` + `aria-labelledby`
following the three sites that already used that shape; Timezone dropped `<Label>` because nothing
was being labelled. Guard: `e2e/profile-group-labelling.spec.ts`, both assertions proven lethal by
mutation. Journal:
[`entries/2026-08-17-profile-group-labelling.md`](../../overview/entries/2026-08-17-profile-group-labelling.md).

## Next
Work the queue top-down and take the highest Lane-B-owned item, re-verifying its premise against
`main` first. As of 2026-08-17 the candidates in queue order:

1. **Q-309** `[nutrition][app-shell]` — a touch tap on Nutrition's action row does not activate the
   button while a synthesised click does. The highest Lane B item now, and a live interaction bug
   rather than polish.
2. **Q-350** — the radiogroup keyboard sweep filed below. Low priority; fine to let Q-282's scanner
   force it.

Everything above Q-309 was Lane A's (Q-310 `app/api/workout-data`, Q-306 CI publish gate, Q-307 MET
table, Q-263 cache-group audit, the scoring entries).

## Blocked
Nothing.

## Owed
- **A TalkBack pass on the S25** over More → Goals and More → Edit Profile. Playwright asserts
  Chromium's accessibility tree, which proves the names and checked state are exposed but is not the
  same as hearing the announcement. This is why the Q-261 Known-Issues row stays in
  `projectOverview.md` instead of moving to the resolved archive.

## Q numbers used from the band
- **Q-350** — eight `role="radiogroup"`s in the app, none with arrow-key navigation. Filed, not
  implemented; sits next to Q-282 in the backlog. Wants one shared `components/ui/` primitive across
  all eight sites, not eight hand-rolled copies.

## Claimed paths
None beyond the lane list in [`docs/agents/README.md`](../README.md) §3.

## Do not re-litigate
- The lane contract, authority limits and Q bands are settled in
  [`docs/agents/README.md`](../README.md). Read it rather than re-deciding it.
- **`radiogroup` beat `group` + `aria-pressed` for pick-one option sets.** Both shapes exist in this
  repo; radiogroup is the majority (8 sites vs 1) and the accurate semantic. Q-261's backlog entry
  suggested `role="group"`; that suggestion was considered and not followed.
- **Arrow-key navigation was deliberately left off Q-261's five groups**, to match the three that
  already shipped without it. Five with it beside three without is worse than eight consistent ones.
  That is Q-350's scope, as one sweep.

## Gotchas worth carrying
- **The E2E harness wants the TCP `DATABASE_URL`**, not the socket form the session hook exports:
  `export DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`. Full run
  2.7 min / 14 tests; a `-g` filtered run is under a minute.
- **Mutation-check every guard you add** — revert the fix, watch the spec go red. One run, and it is
  the difference between a guard and decoration. Q-259 is the precedent: a spec built for a real bug
  passed with the fix deleted and had to be closed as not-achievable.
- **`pnpm check:rules` ran 36 of 36 on 2026-08-17.** Quote the count, never "pass" — it moves.
- **`components/ui/label.tsx` resolves to** `flex items-center gap-2 text-sm leading-none font-medium
  select-none …`. Replacing a `<Label>` with a plain element means carrying those classes across or
  the spacing shifts.
