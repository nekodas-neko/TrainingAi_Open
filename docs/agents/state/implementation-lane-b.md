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

**BF-141 shipped** (`fix/bf141-weight-dial-unit-toggle`, v1.448.0) — the weight dial takes pounds,
stored as kg, remembered per exercise. **BF-139** before it (#1110, v1.447.0). `check:rules` **73/73**.

**Both entries were wrong about something load-bearing, the same way.** BF-139 estimated three chips
at ~201 px in a ~232 px column; measured **227** in **224**. BF-141 named
`touch-target-size.spec.ts` as its gate — that spec scans the five tab roots and the dial is inside
an active workout, so its empty allowlist would have stayed green over a 20 px suffix.

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

1. **An entry's numbers and its named test gate are both prose until something checks them.**
   BF-139's estimates hid the bug; BF-141 named a spec that cannot reach its own control. One
   Playwright run settles either. **Check the gate before trusting it to catch you.**
2. **A mutation that does NOT fail is a finding.** BF-141's `stopPropagation` guards a real lossy
   round-trip (61.0 kg returns 61.25) the spec cannot show, because the seeded workout starts at
   60 kg and round-trips exactly. Recorded in the code and on the entry; the test was renamed to
   what it proves rather than left claiming more.
3. **This file already held the fix for a run's longest detour** — the `scrollIntoViewIfNeeded`
   gotcha below, rediscovered from scratch. **Read the Gotchas first.**
4. **A card reporting "no data" is not evidence that no data reached it.** LB-99's cause was one
   label conflating "too few readings" with "no verdict yet", not the `getLocalStore` fall-through.
5. **A shadowing claim is about ONE function's branch order.** PS-35b's two "unreachable" palette
   keys cited lines in *different* functions; both were live.
6. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once.** A
   "failure" that will not reproduce serially is contention, not a defect.
7. **A stored "state as of" line ages into a wrong answer.** The Dependabot item read *"2 high,
   below threshold"* (2026-07-27); `pnpm audit` read **36 findings, 23 high, 2 critical**.

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
