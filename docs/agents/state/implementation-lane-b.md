# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor is a lost thread.

**Updated:** 2026-09-14 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-110`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a shipped entry leaves the queue. The pointer above is a floor, not an allocation.

## Now

**Sixteen PRs, v1.456.0→.8.** Since the last rewrite: **LB-107** (back on a tab went nowhere) · **LB-108** (filed: E2E green without running) · **LB-106** (the flake's cause replaced) · **PS-35a** (five alias routes deleted) · the **journal fold** (40 entries) · **BF-161** (saved meals in the builder). `check:rules` **74/74** throughout.

**BF-110 still waits on the owner:** one blank resume in normal use, then read `bf110 resume recheck%` — **`stuck` → native, `resized` → render timing**. No fix before that row.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **RE-SCAN AFTER ANY MERGE BY ANOTHER AGENT — this fired THREE times in one day.** READY went 6→9 on Lane A's BF-155; BF-110 surfaced and shipped the same hour; **BF-161 became startable minutes after I had reported the lane empty**, because another agent's merge lifted its `Gate: owner`. **A "blocked" finding has a shelf life of one merge.** Never conclude "no work" without re-running `next-item.js` first.
2. **READY 5, none finishable here (verified entry by entry):** BF-141, BF-135, LB-47 are **shipped work whose headings still claim a device check their bodies record as DONE** — filed as **LB-109** for the Orchestrator, which owns clearing completed entries. BF-126 needs commissioned artwork. BF-100 is a **device-only failure the harness actively contradicts** (`/more` restores 840 in Playwright, fails on the phone), so a green spec is evidence for the wrong proposition.
3. **BF-61's fast-tap check is the keystone.** It releases **BF-94** (owner-approved, otherwise ready) and the same S25 sitting clears BF-100, BF-141, BF-135, LB-47 and most of the KEEP entries.
4. **READY running low is not "no work" — read KEEP and PARKED, printing each Keep whole** (the console truncates them); TN-3b sat in PARKED three days while READY was 0. **BF-51 ① is the trap** — built, deliberately unshipped; reproduce on the S25 first, never loosen `meal-photo-picker.spec.ts`.

## Blocked

- **Owner decisions:** BF-126, Q-551, the macro/budget anchor, LB-61's switch colour, PS-35's PWA landing. *(BF-161 and PS-35a were both answered 2026-09-14 and shipped.)*
- **LB-106 is open with its fix UNCLAIMED.** Its stated cause was wrong: the log says `page.goto: net::ERR_ABORTED` at the **relaunch**, so the poll it blamed is never reached. The relaunch is now a fresh page — defensible on fidelity alone, **not claimed to fix the abort**. It passed one CI run; the abort was always intermittent, so that is a data point, not proof. **If it aborts again on `fresh.goto`, the relaunch shape was not it either** — drop the SW block as justified by nothing and suspect the runner.
- **~50 VERIFY entries owe a look.** BF-136/LB-99 sharpest. **BF-157's chip-vs-bar agreement is native — unverifiable in the sandbox.**
- **⚠ OR-108's picture will not show on the S25 until `LA-36` lands** — all three local-store reads omit `image_data_uri`. Web is fine.
- **⚠ BF-94 is parked on `Needs: BF-61`. ⚠ BF-84 reads startable and is not. PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred.** Do not classify either.
- **⚠ Q-254 is device-free Lane B work parked behind `Needs: Q-297`**, itself `Gate: owner`; its premise is stale (says one spec exists, there are **84**). Do not unpark.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265 and #608; closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`, `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit. `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands. **Clearing a completed entry is the Orchestrator's sweep too — file it, do not do it.**
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at 1833 lines. **`saved-meals-sheet.tsx` is 791 against a HARD 800** — a new feature there goes in an extracted child.
- **E2E is ADVISORY** — but wait on it for app-code or new-spec PRs. **Batons are shrink-only**; cut narrative before adding.

## The lessons that cost real time

1. **A FIELD'S JOB DONE IN PROSE IS THE MOST EXPENSIVE BUG IN THIS QUEUE — five instances.** `Reference:` filed LA-102/TN-28 as read-only (**the tell is a printed reason that is a bare LINK**). `Verify:` filed BF-100 as awaiting a look it had already FAILED twice. A **shipped entry's body** (RV-36) held BF-100's failure plus an unfiled owner request → LB-107. BF-94 printed READY while its text forbade shipping. BF-110's `Gate: device`, scoped by prose to one paragraph, parked an entry needing no device. **Clear a completed entry when you REACH it.**
2. **An entry's numbers, gate and CAUSE are prose until something checks them — TWELVE have now been wrong**, including three in one day whose stated cause did not survive being read against the thing it described (BF-110, LB-107 wrong in *both* halves, LB-106). The tell is always a test: BF-146's spec passed with the fix reverted; LB-106's log named a different LINE than its entry did. **Write the failing check first.** Re-verifying cuts both ways — RV-35 deleted as stale would have dropped the test it owed.
3. **WRITE DOWN WHAT WOULD DISPROVE YOUR FIX.** A 2026-08-30 note — *"if the abort returns, the SW was not it"* — settled LB-106 a fortnight later with **no new run**. Every unproven fix now ships with its falsification condition in the file.
4. **`total_count: 0` HAS TWO CAUSES AND I CONFLATED THEM, at a cost.** A stale base is one. The other, which cost an hour on #1179: **`mergeable_state: dirty`** — `main` moved, the branch conflicted, and GitHub could not build a merge ref, so it created **no run at all**. `actions_list` was telling the truth. **Read `mergeable_state` on the PR before blaming API lag**; `list_workflow_jobs` gives truthful per-step timings where the run's own `updated_at` is frozen.
5. **A SWEEP FOR CALLERS MUST COVER ASSERTIONS, NOT JUST NAVIGATIONS.** PS-35a grepped `goto`/`href`/`push` and missed `toHaveURL(/\/workout-select/)` — a URL assertion depends on a destination just as hard and reads nothing like a navigation. CI caught it; my own read had not.
6. **A PROBE MUST CREATE THE STATE IT NEEDS — an id read from the sandbox is not state you created.** BF-157 cost two runs (a 73.75 kg ramp it assumed absent; a hardcoded uuid that died on CI's FK). Insert by NAME, upsert, restore the referencing table before deleting. **A CI-only e2e failure looks like a missing element; the cause was in the POSTGRES SERVICE-CONTAINER LOG.**
7. **Never run `pnpm build` and vitest against the one local Postgres at once** — a "failure" that will not reproduce serially is contention. **A stored "state as of" line ages into a wrong answer.**

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does**, and it also catches `react-hooks/rules-of-hooks`. `e2e/` **is** covered. Both vitest projects are `environment: 'node'`. **After deleting a route, `tsc` fails on `.next/types/validator.ts` until a clean rebuild — that is the GENERATED file, not your source.**
- **The doc-size baseline is the rebase tax, and the check FAILS ON SLACK** — it must equal `wc -l` + 1 exactly. Recompute, never splice. `doc-size-baseline-history.md` is APPEND-ONLY, keep both with main's first; on the backlog a conflict is usually two *deletions* — keep neither, unless both sides EDITED different entries, then keep both.
- **A worktree control on `origin/main` CANNOT work** — symlinked `node_modules` breaks turbopack package resolution.
- **`refusing to merge unrelated histories` is the shallow-clone graft** — `git fetch origin --deepen=100` (or 150).
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`, never splice.** Never `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **`locator.click()` does nothing on Nutrition** — copy an opener that already works (`builder-barcode-scan.spec.ts`: `touchscreen.tap` on a measured box, tapping only while the sheet is closed) rather than writing a new one. This cost a run TWICE.
- **`getByText` resolves to the INNERMOST match** and matches a tab label as readily as a heading — scope to the element (`locator('p').filter({ hasText })`) or hit a strict-mode violation that reads like a failure when it is the render working.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab** — scrolls every ancestor and stops early. Use `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **`seed.sql` records NOTHING for today** — so a spec asserting a day's content is red here, green on CI. The `hasData` gate on `/health/*` insight cards is the usual symptom. check:rules is `Ran N of N` — never quote "pass".
- **Judge a colour change by sampling pixels** (`OffscreenCanvas` + `getImageData`), and a layout complaint by `getBoundingClientRect()` on every child.
- **The admin screens need `is_admin` AND a re-minted JWT.** Re-run `--project=setup`. Restore both.
- **Prove a destructive path from the DATABASE, not `page.route` interception** — a matcher that fails silently reads exactly like "no request fired".
