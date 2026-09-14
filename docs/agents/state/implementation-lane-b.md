# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor
> is a lost thread.

**Updated:** 2026-09-14 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-106`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE
> '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a
> shipped entry leaves the queue. The pointer above is a floor, not an allocation.

## Now

**BF-157 (v1.456.2):** every ready screen has a bounded clock — the ramp needs a working weight and
four cases have none. **BF-159 (v1.456.1):** Cardio Baselines moved onto the Cardio tab.
**LA-104 (v1.456.0):** the stress chart reads the STORED series for every day, mounted on
`/health/day`. TN-3b, LB-98 ①, RV-35, BF-153, OR-108, LA-105 shipped. `check:rules` **74/74**.

**`Reference:` was undocumented and burying real work.** It means *this entry is READ, not built* —
"never next"; three sessions used it for "supporting reading". **The tell is a printed reason that is
a bare link:** seven have it, three were opened, **all three were work** (LA-104 shipped; LA-102 and
TN-28 now READY). Documented; the four `TN-` ones are **LB-104**.

**NINE running entries were wrong about something load-bearing** — BF-139/141/142/145/146/147, OR-108's writers, LA-104's settled question, BF-157's scope (filed as bodyweight; the gate loses the clock in FOUR cases). **BF-159 was the second that checked out whole.** Measure before you fix what the entry blames; read the route before re-deciding its design.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, `53 */4 * * *`): syncs
`main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **READY is 5.** BF-156, then **LA-102** and **TN-28** — the two unburied from `Reference:`, both
   nutrition surface, worth batching. Then LB-105 and the `nutrition-tab-day-and-scroll` batch (RV-36).
2. **READY 0 is not "no work" — read KEEP and PARKED.** The console TRUNCATES each Keep; print them
   whole. TN-3b sat in PARKED three days while READY was 0 because its unparking was PROSE. **This is
   the same class as `Reference:` above, and it has now cost four entries in two days.** TN-3b's
   remaining halves: the HR overlay and the across-days aggregate. **BF-51 ① is the trap** — built,
   deliberately unshipped; reproduce on the S25 first, never loosen `meal-photo-picker.spec.ts`.

## Blocked

- **LB-105: `day-review-read-through.spec.ts` test 1 is RED locally, GREEN on CI** — so it is the
  sandbox seed, and a spec that disagrees by environment trains a session to skip it. It is READY.
- **~50 VERIFY entries owe a look.** BF-136/LB-99 sharpest (only the owner's account has a real dosing period); BF-139 owes the **daytime** case. **BF-157's chip-vs-bar agreement is native — unverifiable in the sandbox.**
- **⚠ OR-108's picture will not show on the S25 until `LA-36` lands** — all three local-store reads omit `image_data_uri`, so the device reads null from a column now filled. Web is fine.
- **Owner:** the macro/budget anchor (BF-134's residue, TN-29 protects the stored 1,660); LB-61's switch colour; whether the PWA lands on Home rather than Workout (PS-35).
- **⚠ BF-84 reads startable and is not** — BF-94 supersedes it and is `Gate: device`.
- **PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred 2026-09-09.** Do not classify either.
- **⚠ `actions_list` is STALE for RUN EXISTENCE, filtered OR not** — `total_count` showed no run for
  ~6 min after one existed and I told the owner CI was broken. **`get_check_runs` on the PR is the read; 0 means WAIT, never escalate.**
- **⚠ When `main` lands a PR every ~5 min, a 26-min E2E never finishes on a current base** (BF-142: six pushes). Merge on the required five once E2E passed on that exact app code. Rebuild `package.json`/`changelog.ts` from `origin/main` and re-bump; **recompute a `.size` conflict from the merged file** — neither side describes it.
- **⚠ Q-254 is device-free Lane B work parked behind `Needs: Q-297`, itself `Gate: owner`**; its premise is stale too (says one spec exists, there are **84**). With the owner since 2026-09-11. Do not unpark.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265 (Q-323/Q-415/Q-417) and #608 (LB-19): all four entries are out of the queue, the code is in the tree under other filenames, and closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`,
  `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit.
  `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands.
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at 1833 lines — derive further down, never thread a prop through it.
- **E2E is ADVISORY** — wait on it for app-code or new-spec PRs, else the required five are the gate.
- **Batons are shrink-only.** Ratcheted; a rewrite that grows it fails CI.

## The lessons that cost real time

1. **An entry's numbers, gate and CAUSE are prose until something checks them** — eight in a row were
   wrong. The tell was always a test: BF-146's spec passed with the fix reverted, OR-108's first honest
   run **413'd**. **RV-35 shows re-verifying cuts BOTH ways** — deleting it as stale would have dropped
   the test it owed. **Write the failing check first, and read the Gotchas below before starting.**
2. **A negative assertion behind a positive one is UNPROVEN — falsify it separately.** BF-159's "gone from Health" never ran once "on Cardio" failed first; reverting proved half. Build the wrong state deliberately and watch that half go red — or, where it was already true before the change (BF-157's "no ladder"), record it as a regression guard rather than as proof.
3. **A PROBE MUST CREATE THE STATE IT NEEDS.** BF-157's first spec assumed the seed's exercises were unweighted because none carries an `exercise_id`; the ready screen came up at **73.75 kg** with a full ramp. Repoint the row in `beforeAll`, restore in `afterAll` (`deload-visible.spec.ts`), never read what the seed happens to hold.
4. **A mutation that does NOT fail is a finding.** BF-141's `stopPropagation` guards a lossy round-trip (61.0 kg → 61.25) the spec cannot show — the seeded workout round-trips exactly. The test was renamed to what it proves.
5. **A card reporting "no data" is not evidence none reached it** — LB-99's cause was one label, not the `getLocalStore` fall-through; and a shadowing claim is about ONE function's branch order (PS-35b's two "unreachable" palette keys cited *different* functions, both live).
6. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once** — a "failure" that will not reproduce serially is contention, not a defect.
7. **A stored "state as of" line ages into a wrong answer** — Dependabot read *"2 high"*; `pnpm audit` read **36, 23 high, 2 critical**.

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
