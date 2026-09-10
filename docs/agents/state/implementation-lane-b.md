# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-10 · **By:** the twenty-fourth Lane B run · **Next ID:** `LB-100`

> **A mistyped ID in this file silently advances the whole lane's numbering.** Allocate with
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` and **check the max it reports is
> real** — but check the **journal**, not only the backlog: a shipped entry is *removed* from the
> queue, so `grep -c '^### .*LB-99'` returns 0 for a number that is legitimately taken. This note
> does not spell the known-bad id out; writing it here would keep it winning the sort.

## Now

**Open: #1092** (`fix/ps35b-boot-and-weather`, PS-35b) — Lint/Custom Rules/Migration Check green on
head `bcb22b3929`, Tests and Build running. **Its base went stale twice**; both times the tell was
`get_check_runs` returning `total_count: 0`.

**Merged this run:** #1057 (BF-134), #1058 (BF-135), #1066 (Dependabot standing item), #1073
(BF-136), #1074 (LB-99), #1076 (queue cleanup). `main` is at **v1.446.3**; `check:rules` read
**Ran 71 → 73 of N** as other lanes added steps.

**Filed this run:** LB-99 (shipped same day). Corrections recorded on BF-134, BF-136 and PS-35b.

**A 4-hourly silent Routine now polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, bound to this
session, fires `53 */4 * * *`). It syncs `main`, clears any open PR of mine, runs `next-item.js`, and
**says nothing when READY is 0**. It is outside the 1-hour prompt-cache TTL by design — 6 cold checks
a day beats 24 warm ones for a poll that usually finds nothing.

## Next

1. **RV-36** — scroll restoration reaches 3 of 5 tabs (batch `nutrition-tab-day-and-scroll`, one PR).
2. **RV-37** — `/health/day` scrolls with no bottom padding. Structural; **not observed**, so confirm
   it reproduces at 412 px before treating it as a bug.

Both were READY behind PS-35b. **READY moves without warning** — OR-106/#1089 returned five parked
entries at once by splitting a `Gate:` that prose had scoped to one paragraph.

## Blocked

- **52 VERIFY entries owe a device look**, and BF-136 + LB-99 are the sharpest: the owner's account is
  the only one with a real dosing period. Also owed: PS-35b's weather **success** path — the sandbox
  has no outbound route to `api.open-meteo.com`, so only the failure branch was rendered.
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's
  switch colour; and whether the PWA should land on Home rather than Workout (PS-35's question).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes its shape, and BF-94 is `Gate: device`.
  Building BF-84's two-button row ships something BF-94 deletes. Its own entry says so.
- **PS-4 is UNCLASSIFIED by design.** Do not classify it again.

## Claimed paths

None held. #1092 touches `app/manifest.ts`, `components/sync-provider.tsx`,
`components/weather-chip.tsx`, `lib/weather/**` and `lib/stores/workout-store.ts`; released on merge.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, except a shrink-only baseline the check itself demands.
- **A Lane B half needing a Lane A argument is TWO entries.**
- **`components/workout-screen.tsx` is shrink-only at ~1833 lines.** Derive further down.
- **E2E is ADVISORY, not required.** Wait when the PR changes app code or adds a spec; merging on the
  five required checks is right when E2E already passed on that exact app code.
- **Batons are shrink-only too.** This file is ratcheted; a rewrite that grows it fails CI.

## The four lessons this run actually cost something

1. **A card reporting "no data" is not evidence that no data reached it.** LB-99: I filed the
   `getLocalStore` fall-through as the cause and it was wrong — `getLocalStore` returns null on web,
   the fetch ran, the points arrived. The defect was one label conflating *"too few readings"* with
   *"enough readings, no verdict yet"*. **Read what the component does with the data before
   suspecting how it got there.** The wrong diagnosis is kept on the entry.
2. **A shadowing claim is about ONE function's branch order.** PS-35b told me to delete two
   "unreachable" palette keys, citing line 26 preceding line 45 — different functions. Both keys are
   live and deleting them would have stripped the palette from two real routes. **Evaluate the
   function before trusting the claim.**
3. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at the same time.**
   Twice this run a `beforeAll` DB hook timed out in a file the diff never touched, and both passed
   alone. A "failure" that will not reproduce serially is contention, not a defect.
4. **A stored "state as of" line ages into a wrong answer.** The Dependabot standing item read *"2
   high, below threshold — skip"* from 2026-07-27; `pnpm audit` read **36 findings, 23 high, 2
   critical**. Its stated reason — that `sharp` needed a major `next` bump — was wrong twice over:
   the live path was a devDependency no script invokes, and the fix was one override line.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`, and CI's `Build` job does.** The gate is
  `node scripts/check-test-typecheck.js`. `e2e/` **is** covered by plain `tsc`. Both vitest projects
  run `environment: 'node'`, so **vitest cannot parse JSX** — a helper that wants a unit test lives in
  a `.ts`, never beside a component in a `.tsx`.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a STALE BASE**, not slow
  CI. Fetch, merge `origin/main`, push; checks start within a minute. Hit twice on #1092 alone,
  because `main` takes a PR every few minutes and a UI PR's local gate is slower than that window.
- **The doc-size baseline is the rebase tax.** Every re-merge conflicts on
  `docs/doc-size/docs/implementation-backlog.md.size`. **Recompute from the merged file** — never
  splice. `docs/doc-size-baseline-history.md` is APPEND-ONLY: a conflict there is two *additions*,
  keep both. On the backlog itself a conflict is usually two *deletions* — keep neither.
- **`git merge origin/main` failing with `refusing to merge unrelated histories` is the shallow-clone
  graft.** `git fetch origin --deepen=50` fixes it; it recurs every few fetches.
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`; never splice a hunk.** And
  never `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **Playwright needs `DATABASE_URL` prefixed in** (the TCP form, not the session hook's socket form).
- **`locator.click()` does nothing on Nutrition** — the date-swipe `useDrag` swallows it; use
  `tapCentre`, or `el.evaluate(e => e.click())` for the supplements section, where synthetic input
  does not reach the handlers at all.
- **`scrollIntoViewIfNeeded()` scrolls EVERY ancestor scroller**, including the tab carousel — it
  changes tabs. Use `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **A seeded probe must restore the database.** Track exactly what you inserted (a temp table of
  dates) and delete only that; `body_metrics` has a `(user_id, date)` unique and an upsert would
  overwrite a real weigh-in.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass".
