# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-12 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-100`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with
> `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`; check the max is real in the
> **journal** too, since a shipped entry leaves the queue. It also matches this line's own pointer,
> which is not an allocation.

## Now

**BF-145 palette half SHIPPED** (v1.449.0): `--brand-hue` carries the hue angle alone, set in all four
places `--brand` is, and the dark ramp is built from it. **BF-146** closed not built (#1122).
**BF-142** (#1114), **BF-141** (#1111), **BF-139** (#1110) shipped. `check:rules` **73/73**.

**FIVE running entries were wrong about something load-bearing** — BF-139's px estimates, BF-141's
gate spec, BF-142's **406** constant, BF-146's cause, and **BF-145's fix twice over**: chroma
0.01–0.03 paints `--card` as sRGB `1,3,1` (invisible — the ramp had to be LIFTED), and its sheet half
is refuted in `sheet.tsx:70-87`. **Grep the file you are about to change for a comment that already
answers the entry.**

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, session-bound,
`53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **READY was 0 at 2026-09-12 04:35** — 48 parked, almost all `Gate: device`/`Gate: owner`, none
   unparkable without him. BF-145 stays queued on a device check plus an owner question (widen
   `surface="page"` past its five of 46 files?), which is not work.

BF-142 left a live finding with Lane A: the resting base is ~1.41 × the owner's Mifflin BMR,
corroborating BF-137 from a direction that entry does not use (height, not weight trend). **READY
moves without warning** — re-run `next-item.js` rather than trusting this line.

## Blocked

- **~50 VERIFY entries owe a look.** BF-136 and LB-99 are sharpest (only the owner's account has a
  real dosing period); BF-139 owes the **daytime** case, unrenderable here (no route to open-meteo).
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's
  switch colour; whether the PWA lands on Home rather than Workout (PS-35).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes it and is `Gate: device`.
- **⚠ `actions_list` on ci.yml WITH a `branch` filter is STALE** — it showed one run across four
  pushes and I wrongly told the owner CI was dead. Query it UNFILTERED.
- **⚠ When `main` lands a PR every ~5 min, a 26-minute E2E never finishes on a current base** (BF-142
  took six pushes). Merge on the required five once E2E passed on that exact app code; expect `main`
  to take your version — rebuild `changelog.ts` from `origin/main`, never splice.
- **⚠ Q-254 is device-free Lane B work parked on a gate that cannot open** — `Needs: Q-297`, itself
  `Gate: owner`; premise stale too (says one spec exists, there are **84**). With the owner since
  2026-09-11. **Do not unpark it unilaterally.**
- **PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred 2026-09-09.** Do not classify either.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265
(Q-323/Q-415/Q-417) and #608 (LB-19): all four entries are out of the queue and the code is in the
tree, under other filenames. Closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands.
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at
  1833 lines — derive further down, never thread a prop through it.
- **E2E is ADVISORY** — wait on it for app-code or new-spec PRs, else the required five are the gate.
- **Batons are shrink-only too.** This file is ratcheted; a rewrite that grows it fails CI.

## The lessons that cost real time

1. **An entry's numbers, gate and CAUSE are prose until something checks them** — five in a row were
   wrong (see Now). The tell each time was a test: BF-146's spec passed with the fix reverted, and
   BF-145's screenshot showed nothing had changed. **Write the failing check before the fix.**
2. **A mutation that does NOT fail is a finding.** BF-141's `stopPropagation` guards a lossy
   round-trip (61.0 kg → 61.25) the spec cannot show — the seeded workout starts at 60 kg and
   round-trips exactly. The test was renamed to what it proves.
3. **This file already held the fix for a run's longest detour** (`scrollIntoViewIfNeeded`), rediscovered from scratch. **Read the Gotchas first.**
4. **A card reporting "no data" is not evidence that no data reached it** — LB-99's cause was one
   label, not the `getLocalStore` fall-through. A shadowing claim is about ONE function's branch order: PS-35b's two "unreachable" palette keys cited *different* functions, both live.
5. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once** — a "failure" that will not reproduce serially is contention, not a defect.
6. **A stored "state as of" line ages into a wrong answer** — Dependabot read *"2 high"* (2026-07-27); `pnpm audit` read **36, 23 high, 2 critical**.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does** (`check-test-typecheck.js`),
  and it also catches `react-hooks/rules-of-hooks` — a hook below an early return passes `tsc`. `e2e/`
  **is** covered. Both vitest projects are `environment: 'node'` — no JSX, no `localStorage`.
- **`get_check_runs` reading `total_count: 0` minutes after opening a PR is a STALE BASE**, not slow
  CI: fetch, merge `origin/main`, push. It also reads 0 briefly after a good push — check
  `actions_list` **unfiltered** first (see Blocked).
- **The doc-size baseline is the rebase tax.** Recompute from the merged file (`wc -l` + 1), never
  splice. `doc-size-baseline-history.md` is APPEND-ONLY — a conflict is two *additions*, keep both.
  On the backlog it is usually two *deletions* — keep neither.
- **`refusing to merge unrelated histories` is the shallow-clone graft** — `git fetch origin
  --deepen=50` (or 100) fixes it; it recurs every few fetches.
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`, never splice.** And never
  `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **Playwright needs `DATABASE_URL` prefixed in** (TCP, not the hook's socket form), and
  **`locator.click()` does nothing on Nutrition** — use `tapCentre`, or `el.evaluate(e => e.click())`.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab, two ways:** it scrolls EVERY ancestor
  including the horizontal tab carousel, *and* it stops once the box is technically on screen,
  leaving a low control under the nav. Always `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **A seeded probe must CREATE the state it needs, not read it, then restore.** `seed.sql` ships
  `phase_mode = 'manual'` with no `session_periodization` rows — a spec that reads them is green on an
  aged local DB and red on the first CI seed (#1122); `deload-visible.spec.ts` is the pattern.
  `body_metrics` has a `(user_id, date)` unique. check:rules is `Ran N of N` — never quote "pass".
- **Judge a colour change by sampling pixels**, not token values: `OffscreenCanvas` + `getImageData`
  in `page.evaluate` gives sRGB and WCAG ratios, and channel spread (max−min) says if a hue is visible.
