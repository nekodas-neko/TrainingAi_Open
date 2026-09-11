# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-11 · **By:** the twenty-fifth Lane B run · **Next ID:** `LB-100`

> **A mistyped ID in this file silently advances the whole lane's numbering.** Allocate with
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` and **check the max it reports is
> real** — but check the **journal**, not only the backlog: a shipped entry is *removed* from the
> queue, so `grep -c '^### .*LB-99'` returns 0 for a number that is legitimately taken. The current
> max also matches this line's own pointer, which is not an allocation — confirm before taking it.

## Now

**Nothing open.** Merged this run: **#1092** (PS-35b), **#1095** (RV-36 + RV-37), **#1097** (Q-519
classification). Earlier in the same session: #1057, #1058, #1066, #1073, #1074, #1076. `main` is at
**v1.446.4**; `check:rules` reads **Ran 73 of 73**.

**#1095 also cleared two E2E reds sitting on `main`.** `reta-weight-response:142` was mine — it
asserted the chip label LB-99 replaced, a sibling surface that PR missed. `plan-rescale:230` was not,
established by reproducing it against `origin/main`'s `nutrition-content.tsx`, hook absent.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, session-bound,
`53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is
0**. Outside the 1-hour cache TTL by design — 6 cold checks a day beats 24 warm ones.

## Next

**READY is 0, and that is the finding, not a gap to fill.** The lane is blocked on the **device**, not
the queue: 46 VERIFY entries are shipped and owe an on-device look, 48 are parked behind
`Gate: device` / `Gate: owner` / `Needs:`. Reported to the owner 2026-09-11. **Do not invent work.**

**READY moves without warning** — OR-106/#1089 returned five parked entries at once. Re-run
`next-item.js` rather than trusting this line.

## Blocked

- **46 VERIFY entries owe a device look.** BF-136 and LB-99 are the sharpest: the owner's account is
  the only one with a real dosing period. Also owed: PS-35b's weather **success** path — the sandbox
  has no outbound route to `api.open-meteo.com`, so only the failure branch was rendered.
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's
  switch colour; whether the PWA should land on Home rather than Workout (PS-35's question).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes its shape, and BF-94 is `Gate: device`.
  Building BF-84's two-button row ships something BF-94 deletes. Its own entry says so.
- **PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred 2026-09-09.** Do not classify either.
  Q-519 *was* a real omission and is now `Lane: A` — its heading claimed a UI half that had shipped.

## Claimed paths

None held.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, except a shrink-only baseline the check itself demands.
- **A Lane B half needing a Lane A argument is TWO entries.**
- **`components/workout-screen.tsx` is shrink-only at ~1833 lines.** Derive further down.
- **E2E is ADVISORY, not required.** Wait when the PR changes app code or adds a spec; merging on the
  five required checks is right when E2E already passed on that exact app code.
- **Batons are shrink-only too.** This file is ratcheted; a rewrite that grows it fails CI.

## The lessons that cost real time

1. **This file already held the fix for the failure that cost this run its longest detour.** The
   `scrollIntoViewIfNeeded` gotcha below is exactly why `plan-rescale`'s tap landed on the Workout
   tab, and I diagnosed it from scratch — reproducing locally, bisecting against `main` — before
   reading it here. **Read the Gotchas before diagnosing an e2e failure**, not after.
2. **A card reporting "no data" is not evidence that no data reached it.** LB-99: I filed the
   `getLocalStore` fall-through as the cause and it was wrong — it returns null on web, the fetch ran,
   the points arrived. The defect was one label conflating *"too few readings"* with *"enough
   readings, no verdict yet"*. **Read what the component does with the data before suspecting how it
   got there.** The wrong diagnosis is kept on the entry.
3. **A shadowing claim is about ONE function's branch order.** PS-35b's two "unreachable" palette
   keys cited line 26 preceding line 45 — different functions, both live. Evaluate before trusting.
4. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once.** A
   `beforeAll` DB hook timed out twice in files the diff never touched; both passed alone. A
   "failure" that will not reproduce serially is contention, not a defect.
5. **A stored "state as of" line ages into a wrong answer.** The Dependabot item read *"2 high,
   below threshold"* from 2026-07-27; `pnpm audit` read **36 findings, 23 high, 2 critical**.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`, and CI's `Build` job does.** The gate is
  `node scripts/check-test-typecheck.js`. `e2e/` **is** covered by plain `tsc`. Both vitest projects
  run `environment: 'node'`, so **vitest cannot parse JSX** — a helper that wants a unit test lives in
  a `.ts`, never beside a component in a `.tsx`.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a STALE BASE**, not slow
  CI. Fetch, merge `origin/main`, push; checks start within a minute. Hit twice on #1092 alone. It
  also reads 0 for a minute after a legitimate push — check `actions_list` for the run before acting.
- **The doc-size baseline is the rebase tax.** Every re-merge conflicts on
  `docs/doc-size/docs/implementation-backlog.md.size`. **Recompute from the merged file** (`wc -l` +
  1) — never splice. `docs/doc-size-baseline-history.md` is APPEND-ONLY: a conflict there is two
  *additions*, keep both. On the backlog itself a conflict is usually two *deletions* — keep neither.
- **`git merge origin/main` failing with `refusing to merge unrelated histories` is the shallow-clone
  graft.** `git fetch origin --deepen=50` fixes it; it recurs every few fetches.
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`; never splice a hunk.** And
  never `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **Playwright needs `DATABASE_URL` prefixed in** (the TCP form, not the session hook's socket form).
- **`locator.click()` does nothing on Nutrition** — the date-swipe `useDrag` swallows it; use
  `tapCentre`, or `el.evaluate(e => e.click())` for the supplements section, where synthetic input
  does not reach the handlers at all.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab, two ways.** It scrolls EVERY ancestor
  including the horizontal tab carousel, *and* it stops as soon as the box is technically on screen,
  which leaves a low control under the fixed bottom nav. Use
  `scrollIntoView({ block: 'center', inline: 'nearest' })` — both halves, always.
- **A seeded probe must restore the database.** Track exactly what you inserted (a temp table of
  dates) and delete only that; `body_metrics` has a `(user_id, date)` unique and an upsert would
  overwrite a real weigh-in.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass".
