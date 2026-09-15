# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor is a lost thread.

**Updated:** 2026-09-15 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-110`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a shipped entry leaves the queue. The pointer above is a floor, not an allocation.

## Now

**Twenty PRs, v1.456.0→.15.** LB-107 · LB-108 · LB-106 · PS-35a · the journal fold (40 entries) · BF-161 · BF-100's one-tap experiment surfaced · BF-162 (the card said "load 85kg" onto a Hanging Leg Raise) · **LA-109** (a tab flip left the previous tab's route tree on the history entry). **`check:rules` is `Ran 75 of 75` now, not 74** — the count moves, which is why the rule says quote it rather than "pass".

**BF-110 still waits on the owner:** one blank resume in normal use, then read `bf110 resume recheck%` — **`stuck` → native, `resized` → render timing**. No fix before that row.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **RE-SCAN BEFORE CONCLUDING ANYTHING — this has now fired FIVE times.** READY went 6→9 on Lane A's BF-155; BF-161 became startable minutes after I reported the lane empty; the queue went **319 → 330** overnight; and the Orchestrator's OR-116 sweep changed the lane while this baton was mid-rewrite. **A "blocked" or "empty" finding has a shelf life of one merge.**
2. **BF-163 is next, and its stated Lane is wrong in a way that would cost a session.** It says `Lane: B` but names `packages/shared/src/workout/intensity-zone.ts`, which is **Lane A** by the path rule. **Resolved already:** the entry's own "honest minimum" — drop the `typically ${zone.reps}` clause from the chip tooltip — is composed in the CARD, and that tooltip is the only consumer of `zone.reps` in the repo, so the card half is pure Lane B. **Leave the `reps` field**; the better answer (judge load AND reps together) needs it and is Lane A's.
3. **BF-165 is top of READY and is NOT startable by me.** It is a runtime diagnosis whose three candidates are separated only by a WebView console; its own verification step is a device procedure. The narrowing is already done (the owner's *"it just scrolls to the top of cardio hub"* confirms candidate 1). It should carry `Gate: device` and does not.
4. **BF-61's fast-tap check is the keystone.** It releases **BF-94** (owner-approved, otherwise ready) and the same S25 sitting clears BF-100 and most of the KEEP entries.
5. **READY running low is not "no work" — read KEEP and PARKED, printing each Keep whole** (the console truncates them); TN-3b sat in PARKED three days while READY was 0. **BF-51 ① is the trap** — built, deliberately unshipped; reproduce on the S25 first, never loosen `meal-photo-picker.spec.ts`.

## Blocked

- **Owner decisions:** BF-126, Q-551, the macro/budget anchor, LB-61's switch colour, PS-35's PWA landing.
- **LB-106 is open with its fix UNCLAIMED.** Its stated cause was wrong: the log says `page.goto: net::ERR_ABORTED` at the **relaunch**, so the poll it blamed is never reached. **If it aborts again on `fresh.goto`, the relaunch shape was not it either** — drop the SW block and suspect the runner.
- **BF-100 is UNBLOCKED as of LA-109 shipping**, and its one-tap test has still never been run: `use-scroll-restoration.ts` cancels its pending restore on **`touchstart`** with no re-arm; the S25 back gesture is a touch, `page.goBack()` is not. **The test: come back with a UI back control, not the gesture** — every device pass used the gesture because the entry's own verification step says to. **Do not build the `touchmove` fix on the hypothesis.**
- **BF-49 needs a device repro and nothing else.** Its LA-109 link is refuted (below); do not re-derive it.
- **~50 VERIFY entries owe a look** (BF-136/LB-99 sharpest; BF-157's chip-vs-bar is native). **⚠ OR-108's picture will not show on the S25 until `LA-36` lands** — the local-store reads omit `image_data_uri`; web is fine.
- **⚠ BF-94 is parked on `Needs: BF-61`. ⚠ BF-84 reads startable and is not. PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred.** Do not classify either.
- **⚠ Q-254 is device-free Lane B work parked behind `Needs: Q-297`**, itself `Gate: owner`; its premise is stale (says one spec exists, there are **84**). Do not unpark.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265 and #608; closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`, `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit. `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands. **Clearing a completed entry is the Orchestrator's sweep too — file it, do not do it.**
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at 1833 lines. **`saved-meals-sheet.tsx` is 791 against a HARD 800** — a new feature there goes in an extracted child.
- **E2E is ADVISORY** — but wait on it for app-code or new-spec PRs. **Batons are shrink-only**; cut narrative before adding.

## The lessons that cost real time

1. **RUN THE SPEC AGAINST THE UNFIXED FILE. Every time. It is two minutes and it is the only thing that distinguishes a fix from a green test.** LA-109 settled two entries in one run: its own test went red without the fix (so the fix is load-bearing) and its BF-49 cross-check **passed** without it (so that test was vacuous and the entries are not linked). Both halves were invisible from a green run. BF-146's spec also passed with its fix reverted. **A vacuous test nobody has labelled is worse than no test, because it answers.**
2. **A FIELD'S JOB DONE IN PROSE IS THE MOST EXPENSIVE BUG IN THIS QUEUE — five instances.** `Reference:` filed LA-102/TN-28 as read-only (**the tell is a printed reason that is a bare LINK**). `Verify:` filed BF-100 as awaiting a look it had already FAILED twice. A **shipped entry's body** (RV-36) held BF-100's failure plus an unfiled owner request → LB-107. BF-94 printed READY while its text forbade shipping.
3. **An entry's numbers, gate and CAUSE are prose until something checks them — THIRTEEN have now been wrong**, including LA-109's own *"BF-49 is very likely the same defect"*, stated with a clean mechanism and refuted by one run. **An entry that couples two items is asserting something testable; test it before you obey it.**
4. **WRITE DOWN WHAT WOULD DISPROVE YOUR FIX.** A 2026-08-30 note — *"if the abort returns, the SW was not it"* — settled LB-106 a fortnight later with **no new run**.
5. **`total_count: 0` HAS TWO CAUSES AND I CONFLATED THEM.** A stale base is one; **`mergeable_state: dirty`** is the other — GitHub could not build a merge ref, so it created **no run at all**, and `actions_list` was telling the truth. **The reliable green check is attempting the merge**, which validates against real branch protection and refuses a genuinely pending check; #1197's endpoint read two jobs `in_progress` that had already passed.
6. **A SWEEP FOR CALLERS MUST COVER ASSERTIONS, NOT JUST NAVIGATIONS.** PS-35a grepped `goto`/`href`/`push` and missed `toHaveURL(/\/workout-select/)`.
7. **A PROBE MUST CREATE THE STATE IT NEEDS.** BF-157 cost two runs. Insert by NAME, upsert, restore the referencing table before deleting. **A CI-only e2e failure looks like a missing element; the cause was in the POSTGRES SERVICE-CONTAINER LOG.** And never run `pnpm build` and vitest against the one local Postgres at once — a "failure" that will not reproduce serially is contention.

## Gotchas worth carrying

- **A leftover `next-server` from a killed run holds port 3100 without serving it, and `ss -ltn` reported nothing either way.** Every request hangs, so two tests time out at 180 s each and the run looks like a slow compile. **Check `curl -s -o /dev/null -w '%{http_code}' localhost:3100` and `ps -o etime -p <pid>` — an elapsed time older than your run is the tell.** Kill the tree before starting. **Piping the run to `tail` buffers it to EOF** — redirect to a file to watch progress.
- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does**, and it also catches `react-hooks/rules-of-hooks`. `e2e/` **is** covered. **After deleting a route, `tsc` fails on `.next/types/validator.ts` until a clean rebuild — that is the GENERATED file, not your source.**
- **The doc-size baseline is the rebase tax, and the check FAILS ON SLACK** — it must equal `wc -l` + 1 exactly. Recompute, never splice. `doc-size-baseline-history.md` is APPEND-ONLY, keep both with main's first; on the backlog a conflict is usually two *deletions* — keep neither, unless both sides EDITED different entries, then keep both.
- **`refusing to merge unrelated histories` is the shallow-clone graft** — `git fetch origin --deepen=150`. **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`, never splice.** **After ANY merge run `git status --short | grep '^UU'`** — the merge output's tail hid a conflict once.
- **`usePathname()` reads from Next's route tree**, so it is useless for any bug whose symptom IS a stale tree. `window.location` is the only honest reader there. **And `page.goto()` to a sub-route rebuilds history from scratch** — a spec about back must reach the screen by tapping the real affordance.
- **`locator.click()` does nothing on Nutrition, and times out on `/health`** — something animates beneath and the stability check never settles (63 retries). Use `.evaluate(el => el.click())` with a `waitForFunction` guard, or copy an opener that already works.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab** — use `scrollIntoView({ block: 'center', inline: 'nearest' })`. **`getByText` resolves to the INNERMOST match** and matches a tab label as readily as a heading — scope to the element.
- **The Morning Check-in is a MODAL, and Radix marks `<main>` `aria-hidden` behind it** — every role query returns nothing and the failure reads "element not found", not "a modal is in the way". Call `suppressMorningCheckin(page)` **before** `page.goto`.
- **`seed.sql` records NOTHING for today** — a spec asserting a day's content is red here, green on CI. **Judge a colour change by sampling pixels** (`OffscreenCanvas` + `getImageData`), a layout complaint by `getBoundingClientRect()` on every child.
- **The admin screens need `is_admin` AND a re-minted JWT.** Re-run `--project=setup`; restore both. **Prove a destructive path from the DATABASE, not `page.route` interception.**
