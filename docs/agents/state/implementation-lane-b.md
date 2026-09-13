# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-13 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-104`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE
> '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a
> shipped entry leaves the queue. The pointer above is a floor, not an allocation.

## Now

**Lane A shipped all three entries this lane filed today** — LB-101, LB-102, LB-103 — and **LA-105
collected the first debt**: OR-108's `THUMB_WIRE_BUDGET` ladder is gone, the photo stores at natural
quality. TN-3b's chart (v1.455.0), LB-98 ① (v1.454.2), RV-35, BF-153, OR-108 all shipped.
`check:rules` **74/74**.

**SEVEN running entries were wrong about something load-bearing** — BF-139's px, BF-141's gate,
BF-142's **406**, BF-146's cause, BF-145's fix twice, BF-147's (the badge is **25 px**; the four action
buttons are **204 of 340**), and OR-108's: two writers named, **three** real, plus a route defect
nothing hinted at. BF-153 was the first that checked out whole, and verifying it still cost ten
minutes well spent. **Measure before you fix what the entry blames.**

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, session-bound,
`53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **READY reads 0 and that is not the same as no work.** KEEP holds it and the console TRUNCATES
   each Keep — print them whole. **And read PARKED too: TN-3b sat there three days while READY was 0,
   because its unparking is PROSE and the tool reads fields.** Its remaining halves are the HR overlay
   and the across-days aggregate, both behind `LB-102`. **BF-51 ① is the trap** — built, deliberately
   unshipped; reproduce on the S25 first, never loosen `meal-photo-picker.spec.ts`.
2. **`LA-104` is next and it is a REAL finding, not tidy-up** — today's stress chart reads the live
   series and a past day reads the rollup's, and TN-3a says outright these are two different numbers
   (`rhrLowBpm` + `nightHrvMs` vs `restingHr` + a 28-day HRV mean). TN-3b's approved pass test is a
   comparison ACROSS days, so one axis showing two metrics defeats it. Q-305's half is unblocked too.

## Blocked

- **~50 VERIFY entries owe a look.** BF-136 and LB-99 are sharpest (only the owner's account has a real dosing period); BF-139 owes the **daytime** case (no route to open-meteo).
- **⚠ OR-108's picture will not show on the S25 until `LA-36` lands** — all three local-store reads omit `image_data_uri`, so the device reads null from a column now filled. Web is fine.
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's
  switch colour; whether the PWA lands on Home rather than Workout (PS-35).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes it and is `Gate: device`.
- **PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred 2026-09-09.** Do not classify either.
- **⚠ `actions_list` is STALE for RUN EXISTENCE, filtered OR not** — `total_count` showed no run for
  ~6 min after one existed and I told the owner CI was broken. **`get_check_runs` on the PR is the read; 0 means WAIT, never escalate.**
- **⚠ When `main` lands a PR every ~5 min, a 26-min E2E never finishes on a current base** (BF-142: six pushes). Merge on the required five once E2E passed on that exact app code. Rebuild `package.json`/`changelog.ts` from `origin/main` and re-bump; **recompute a `.size` conflict from the merged file** — neither side describes it.
- **⚠ Q-254 is device-free Lane B work parked behind `Needs: Q-297`, itself `Gate: owner`**; its premise is stale too (says one spec exists, there are **84**). With the owner since 2026-09-11. Do not unpark.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265
(Q-323/Q-415/Q-417) and #608 (LB-19): all four entries are out of the queue, the code is in the tree under other filenames, and closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands.
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at
  1833 lines — derive further down, never thread a prop through it.
- **E2E is ADVISORY** — wait on it for app-code or new-spec PRs, else the required five are the gate.
- **Batons are shrink-only.** Ratcheted; a rewrite that grows it fails CI.

## The lessons that cost real time

1. **An entry's numbers, gate and CAUSE are prose until something checks them** — seven in a row were
   wrong. The tell was always a test: BF-146's spec passed with the fix reverted, OR-108's first honest
   run **413'd**. **RV-35 shows re-verifying cuts BOTH ways** — its fix was already in the tree, but
   deleting it as stale would have dropped the test it owed. **Write the failing check before the fix
   — and read the Gotchas below first; this file already held the fix for one run's longest detour.**
2. **A mutation that does NOT fail is a finding.** BF-141's `stopPropagation` guards a lossy round-trip (61.0 kg → 61.25) the spec cannot show — the seeded workout round-trips exactly. The test was renamed to what it proves.
3. **A card reporting "no data" is not evidence none reached it** — LB-99's cause was one label, not the `getLocalStore` fall-through; and a shadowing claim is about ONE function's branch order (PS-35b's two "unreachable" palette keys cited *different* functions, both live).
4. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once** — a "failure" that will not reproduce serially is contention, not a defect.
5. **A stored "state as of" line ages into a wrong answer** — Dependabot read *"2 high"*; `pnpm audit` read **36, 23 high, 2 critical**.

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
  For a LAYOUT complaint, measure `getBoundingClientRect()` on every child of the row — that is what
  showed the 48 dp tap floor, not the badge, eating BF-147's name column.
- **The admin screens need `is_admin` AND a re-minted JWT** — the claim is in the token, so flipping
  the column leaves a stored `e2e/.auth` state non-admin. Re-run `--project=setup`. Restore both.
- **Prove a destructive path from the DATABASE, not `page.route` interception** — a matcher that fails silently reads exactly like "no request fired"; on BF-147 `count(*)` showed the delete had gone through.
