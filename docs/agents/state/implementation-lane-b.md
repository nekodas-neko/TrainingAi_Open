# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-12 · **By:** the twenty-sixth Lane B run · **Next ID:** `LB-100`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max is real in the
> **journal** as well as the backlog — a shipped entry is removed from the queue, so a grep of the
> backlog alone returns 0 for a taken number. The max also matches this line's own pointer, which is
> not an allocation.

## Now

**BF-139 shipped** (`fix/bf139-header-chip-width`, v1.447.0) — Home's three header chips fit the
224 px column again. Merged before it: #1092, #1095, #1097, #1099. `check:rules` reads **73 of 73**.

**BF-139's own numbers were estimates and were low** — it put three chips at ~201 px in a ~232 px
column, which is no bug. Measured: **227 px** in **224**, and **279** with the daytime `· UV n`. Its
prescribed `px-2.5` → `px-2` is worth 12 px and left daytime 43 px over. The fit came from merging
the two battery pills into one (150 px → 91) and moving `%` into the accessible name.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, session-bound,
`53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **BF-142** — the gap explainer gives a reason its own module says is false. Only READY item.

Beyond it the lane is blocked on the **device**, not the queue: ~47 VERIFY entries owe an on-device
look and 48 are parked behind a gate. **Do not invent work** when READY is 0.

**READY moves without warning** — re-run `next-item.js` rather than trusting this line.

## Blocked

- **~47 VERIFY entries owe a device look.** BF-136 and LB-99 are sharpest (only the owner's account
  has a real dosing period); BF-139 owes the **daytime** case. No weather snapshot is seeded and
  there is no route to `api.open-meteo.com`, so that row is unrenderable here.
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's
  switch colour; whether the PWA should land on Home rather than Workout (PS-35's question).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes its shape, and BF-94 is `Gate: device`.
  Building BF-84's two-button row ships something BF-94 deletes. Its own entry says so.
- **⚠ Q-254 is device-free Lane B work parked on a gate that cannot open.** It strikes the 86
  device-verification rows (**31 `needs: browser`**) but carries `Needs: Q-297`, which is
  `Gate: owner` and never leaves the queue. Its premise is stale too — it says one spec exists;
  there are **84**. With the owner since 2026-09-11. **Do not unpark it unilaterally.**
- **PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred 2026-09-09.** Do not classify either.
  Q-519 *was* a real omission and is now `Lane: A` — its heading claimed a UI half that had shipped.

## Claimed paths

None held.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands.
- **A Lane B half needing a Lane A argument is TWO entries.** `components/workout-screen.tsx` is
  shrink-only at ~1833 lines — derive further down.
- **E2E is ADVISORY.** Wait on it when the PR changes app code or adds a spec; otherwise the five
  required checks are the gate.
- **Batons are shrink-only too.** This file is ratcheted; a rewrite that grows it fails CI.

## The lessons that cost real time

1. **An entry's pixel estimates are prose until something measures them.** BF-139 reasoned from
   character counts and was wrong in the direction that hides the bug, and its prescribed fix
   covered a third of the gap. **Injecting the real markup into the live row and reading
   `getBoundingClientRect()` costs one Playwright run** and is the only way this row has ever been
   argued about with numbers. Do it before choosing a lever.
2. **This file already held the fix for the failure that cost a run its longest detour** — the
   `scrollIntoViewIfNeeded` gotcha below, rediscovered from scratch. **Read the Gotchas first.**
3. **A card reporting "no data" is not evidence that no data reached it.** LB-99's cause was not
   the `getLocalStore` fall-through — the fetch ran — but one label conflating "too few readings"
   with "no verdict yet". **Read what a component does with data before suspecting how it got
   there.**
4. **A shadowing claim is about ONE function's branch order.** PS-35b's two "unreachable" palette
   keys cited lines in *different* functions; both were live.
5. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once.** A
   "failure" that will not reproduce serially is contention, not a defect.
6. **A stored "state as of" line ages into a wrong answer.** The Dependabot item read *"2 high,
   below threshold"* from 2026-07-27; `pnpm audit` read **36 findings, 23 high, 2 critical**. Same
   shape as BF-139's stale estimates and Q-254's stale premise: a written number is not a measured one.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does**, via
  `scripts/check-test-typecheck.js`. `e2e/` **is** covered by plain `tsc`. Both vitest projects run
  `environment: 'node'`, so **vitest cannot parse JSX** — a unit-tested helper lives in a `.ts`.
- **`get_check_runs` returning `total_count: 0` minutes after opening a PR is a STALE BASE**, not
  slow CI: fetch, merge `origin/main`, push. It also reads 0 for ~a minute after a good push, so
  check `actions_list` for the run before acting.
- **The doc-size baseline is the rebase tax.** Recompute from the merged file (`wc -l` + 1); never
  splice. `doc-size-baseline-history.md` is APPEND-ONLY — a conflict there is two *additions*, keep
  both. On the backlog a conflict is usually two *deletions* — keep neither.
- **`git merge origin/main` failing with `refusing to merge unrelated histories` is the shallow-clone
  graft.** `git fetch origin --deepen=50` fixes it; it recurs every few fetches.
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`; never splice a hunk.**
  Never `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **Playwright needs `DATABASE_URL` prefixed in** (TCP, not the hook's socket form), and
  **`locator.click()` does nothing on Nutrition** — use `tapCentre`, or `el.evaluate(e => e.click())`
  in the supplements section, where synthetic input never reaches the handlers.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab, two ways:** it scrolls EVERY ancestor
  including the horizontal tab carousel, *and* it stops once the box is technically on screen,
  leaving a low control under the nav. Always `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **A seeded probe must restore the database.** Delete exactly what you inserted; `body_metrics`
  has a `(user_id, date)` unique and an upsert would overwrite a real weigh-in.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass".
