# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-12 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-100`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max is real in the
> **journal** as well as the backlog — a shipped entry is removed from the queue, so a grep of the
> backlog alone returns 0 for a taken number. The max also matches this line's own pointer, which is
> not an allocation.

## Now

**BF-142 shipped** (`fix/bf142-gap-explainer-sentence`, v1.448.1) — the Nutrition gap sentence is
true now. **BF-141** (#1111) and **BF-139** (#1110) before it. `check:rules` **73/73**.

**Three entries in a row were wrong about something load-bearing.** BF-139 estimated three chips at
~201 px in a ~232 px column (measured **227** in **224**); BF-141 named a gate spec that cannot
reach its control; BF-142's module pinned a constant at **406** that had since flipped sign to
**−295**, which inverted gives a resting base risen **~700 kcal**. **Check an entry's numbers and
its named gate before building on either.**

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, session-bound,
`53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

**READY is 0 again** — blocked on the **device** and the **owner**, not the queue: ~49 VERIFY
entries owe a look, 48 are parked. **Do not invent work.** BF-142 left a live finding with Lane A:
the resting base is ~1.41 × the owner's Mifflin BMR, corroborating BF-137 from a direction that
entry does not use (height, not weight trend).

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
  device-verification rows (**31 `needs: browser`**) but carries `Needs: Q-297` — `Gate: owner`, so
  it never leaves the queue. Its premise is stale too: it says one spec exists, there are **84**.
  With the owner since 2026-09-11. **Do not unpark it unilaterally.**
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

1. **An entry's numbers and its named test gate are both prose until something checks them.**
   BF-139's estimates hid the bug; BF-141 named a spec that cannot reach its own control. One
   Playwright run settles either. **Check the gate before trusting it to catch you.**
2. **A mutation that does NOT fail is a finding.** BF-141's `stopPropagation` guards a real lossy
   round-trip (61.0 kg → 61.25) the spec cannot show: the seeded workout starts at 60 kg and
   round-trips exactly. Recorded in the code; the test was renamed to what it proves.
3. **This file already held the fix for a run's longest detour** — the `scrollIntoViewIfNeeded`
   gotcha below, rediscovered from scratch. **Read the Gotchas first.**
4. **A card reporting "no data" is not evidence that no data reached it** — LB-99's cause was one
   label, not the `getLocalStore` fall-through.
5. **A shadowing claim is about ONE function's branch order** — PS-35b's two "unreachable" palette
   keys cited lines in *different* functions; both were live.
6. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once.** A
   "failure" that will not reproduce serially is contention, not a defect.
7. **A stored "state as of" line ages into a wrong answer** — the Dependabot item read *"2 high,
   below threshold"* (2026-07-27); `pnpm audit` read **36, 23 high, 2 critical**.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does**, via
  `scripts/check-test-typecheck.js`. It also misses `react-hooks/rules-of-hooks` — a hook below an
  early return passes `tsc` and fails Build. `e2e/` **is** covered by plain `tsc`. Both vitest
  projects run `environment: 'node'`, so **vitest cannot parse JSX** (a unit-tested helper lives in a
  `.ts`) and there is **no `localStorage`** — stub it.
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
  **`locator.click()` does nothing on Nutrition** — use `tapCentre`, or `el.evaluate(e => e.click())`.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab, two ways:** it scrolls EVERY ancestor
  including the horizontal tab carousel, *and* it stops once the box is technically on screen,
  leaving a low control under the nav. Always `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **A seeded probe must restore the database** — `body_metrics` has a `(user_id, date)` unique and
  an upsert would overwrite a real weigh-in. A spec that starts a workout must delete it too.
- **The check:rules count is `Ran N of N` and moves** — never hardcode it, never quote "pass".
