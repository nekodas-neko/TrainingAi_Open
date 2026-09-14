# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor is a lost thread.

**Updated:** 2026-09-14 · **By:** the twenty-seventh Lane B run · **Next ID:** `LB-108`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a shipped entry leaves the queue. The pointer above is a floor, not an allocation.

## Now

**Ten PRs, v1.456.0→.4.** LA-104 · BF-159 · BF-157 · BF-156 · LA-102 + TN-28 batched · LB-105 · BF-110 · three queue-integrity PRs. The journal entries carry what each did. `check:rules` **74/74** throughout.

**BF-110's second viewport log shipped 2026-09-14** (instrumentation only, no bump): the next move is the owner's — one blank resume in normal use, then read `bf110 resume recheck%`, where **`stuck` → native and `resized` → render timing**; no fix before that row. **Otherwise the lane is blocked on the owner**, established by reading every entry rather than inferring from titles. Do not pick something to look busy.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`, `53 */4 * * *`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **RE-SCAN AFTER ANY LANE A MERGE.** READY went 6 → 9 the moment BF-155 landed and cleared `Needs:` pointers, and BF-110 was among the three that surfaced — buildable, no device, shipped the same hour. **A "blocked" finding has a shelf life of one merge.**
2. **Otherwise nothing in READY can be finished here. Verified 2026-09-14 08:55, entry by entry:** LB-107 (the S25 system back gesture; Playwright cannot send it) · LB-106 (ten clean CI runs or a named cause) · BF-141, BF-135, LB-47 (shipped; only the device look is owed) · BF-100 (a DEVICE-ONLY failure the harness actively contradicts — `/more` restores 840 in Playwright and fails on the phone, so a green spec is evidence for the wrong proposition).
3. **BF-61's fast-tap check is the keystone.** It releases **BF-94** — swipe-Start-to-reveal-Rest, owner-approved 2026-09-13 and otherwise ready to build — and the same S25 sitting clears BF-100, BF-141, BF-135, LB-47 and most of the 35 KEEP entries.
4. **READY running low is not "no work" — read KEEP and PARKED, printing each Keep whole** (the console truncates them); TN-3b sat in PARKED three days while READY was 0. **BF-51 ① is the trap** — built, deliberately unshipped; reproduce on the S25 first, never loosen `meal-photo-picker.spec.ts`.

## Blocked

- **Owner decision: BF-161** (`Gate: owner`) is the live one. Also BF-126, PS-35a, Q-551, the macro/budget anchor, LB-61's switch colour, PS-35's PWA landing.
- **LB-106: `preferences-survive-reinstall` fails on CI, passes locally** — flaky 03:47, hard fail 07:12, neither PR touching it. E2E is advisory; #1166 merged on the required five with it recorded, not waved through.
- **~50 VERIFY entries owe a look.** BF-136/LB-99 sharpest (only the owner's account has a real dosing period). **BF-157's chip-vs-bar agreement is native — unverifiable in the sandbox.**
- **⚠ OR-108's picture will not show on the S25 until `LA-36` lands** — all three local-store reads omit `image_data_uri`, so the device reads null from a column now filled. Web is fine.
- **⚠ BF-94 is parked on `Needs: BF-61`**, not BF-84 (that supersession is done). **⚠ BF-84 reads startable and is not. PS-4 is UNCLASSIFIED by design; LB-94 the owner deferred.** Do not classify either.
- **⚠ Q-254 is device-free Lane B work parked behind `Needs: Q-297`, itself `Gate: owner`**; its premise is stale too (says one spec exists, there are **84**). Do not unpark.
- **⚠ `actions_list` is STALE for RUN EXISTENCE** — `get_check_runs` on the PR is the read; 0 means WAIT, never escalate. **⚠ `main` lands a PR every ~5 min, so a 26-min E2E never finishes on a current base**; merge on the required five once E2E passed on that exact app code.

## Claimed paths

None held. **Two abandoned Lane B PRs are open whose work is already on `main`** — #265 (Q-323/Q-415/Q-417) and #608 (LB-19); closing a PR needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`, `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit. `scripts/**` is the Orchestrator's, bar a shrink-only baseline the check demands.
- **A Lane B half needing a Lane A argument is TWO entries.** `workout-screen.tsx` is shrink-only at 1833 lines — derive further down, never thread a prop through it.
- **E2E is ADVISORY** — wait on it for app-code or new-spec PRs, else the required five are the gate. **Batons are shrink-only**; a rewrite that grows one fails CI, so cut narrative before adding.

## The lessons that cost real time

1. **A FIELD'S JOB DONE IN PROSE IS THE MOST EXPENSIVE BUG IN THIS QUEUE — four instances in one day, one of them inverted.** `Reference:` filed LA-102 and TN-28 as read-only (**the tell is a printed reason that is a bare LINK, not a sentence** — seven entries have it, three were opened, all three were work). `Verify:` filed BF-100 as awaiting a look it had already FAILED twice. A **shipped entry's body** (RV-36) held BF-100's failure plus an unfiled owner request → LB-107. BF-94 printed READY while its own text said *"do not ship until BF-61's check"*. **A fifth, found by the Orchestrator: BF-110's `Gate: device` was scoped by prose to ONE paragraph and parked the whole entry, so the owner sat on it twice in device passes with nothing he could do.** The first three hid work the queue should have shown; the fourth showed work it should have parked. **Clear a completed entry when you REACH it — the longer it sits, the more gets written into it.**
2. **An entry's numbers, gate and CAUSE are prose until something checks them** — nine in a row were wrong (BF-139/141/142/145/146/147, OR-108's writers, LA-104's settled question, BF-157's scope, BF-156's axis). The tell was always a test: BF-146's spec passed with the fix reverted, OR-108's first honest run **413'd**. **Re-verifying cuts BOTH ways** — RV-35 deleted as stale would have dropped the test it owed. **Write the failing check first.**
3. **A negative assertion behind a positive one is UNPROVEN — falsify it separately.** BF-159's "gone from Health" never ran once "on Cardio" failed first. Build the wrong state deliberately and watch that half go red — or, where it was already true before the change (BF-157's "no ladder"), record it as a regression guard rather than as proof.
4. **A PROBE MUST CREATE THE STATE IT NEEDS — and an id read from the sandbox is NOT state you created.** BF-157 cost two runs: draft 1 assumed the seed was unweighted (it met a 73.75 kg ramp), draft 2 hardcoded a local `exercise_library` uuid and died on CI's FK, green here and red there. Insert by NAME (unique in both databases), upsert so an aborted run leaves nothing, restore the referencing table BEFORE deleting the row. **A CI-only e2e failure looks like a missing element; the cause was in the POSTGRES SERVICE-CONTAINER LOG at the bottom of the job — read it.**
5. **A mutation that does NOT fail is a finding**, and **a card reporting "no data" is not evidence none reached it** — LB-99's cause was one label, not the `getLocalStore` fall-through.
6. **Never run `pnpm build` and `npx vitest run` against the one local Postgres at once** — a "failure" that will not reproduce serially is contention. **A stored "state as of" line ages into a wrong answer**: Dependabot read *"2 high"*; `pnpm audit` read **36, 23 high, 2 critical**.

## Gotchas worth carrying

- **`npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`; CI's `Build` does** (`check-test-typecheck.js`), and it also catches `react-hooks/rules-of-hooks` — a hook below an early return passes `tsc`. `e2e/` **is** covered. Both vitest projects are `environment: 'node'` — no JSX, no `localStorage`.
- **`get_check_runs` reading `total_count: 0` minutes after opening a PR is a STALE BASE**, not slow CI: fetch, merge `origin/main`, push. It also reads 0 briefly after a good push.
- **The doc-size baseline is the rebase tax, and the check FAILS ON SLACK** — the number must equal the merged file's `wc -l` + 1 exactly. Recompute, never splice. `doc-size-baseline-history.md` is APPEND-ONLY — a conflict is two *additions*, keep both with main's first. On the backlog it is usually two *deletions* — keep neither.
- **`refusing to merge unrelated histories` is the shallow-clone graft** — `git fetch origin --deepen=100` (or 150) fixes it; it recurs every few fetches.
- **Rebuild `package.json` / `changelog.ts` from `git show origin/main:…`, never splice.** And never `open(p,'w').write(open(p).read()…)` in one expression — it truncates before it reads.
- **`locator.click()` does nothing on Nutrition** — use `tapCentre` or `el.evaluate(e => e.click())`, and assert `aria-expanded` flipped so a silent no-op fails at the click rather than downstream. Playwright needs `DATABASE_URL` prefixed in (TCP, not the hook's socket form).
- **`getByText` resolves to the INNERMOST match** — an emphasised `<span>` inside a paragraph, four words and none of the substance. Scope to the `<p>` with `locator('p').filter({ hasText })`.
- **`scrollIntoViewIfNeeded()` lands a tap on the Workout tab, two ways:** it scrolls EVERY ancestor including the horizontal tab carousel, *and* it stops once the box is technically on screen, leaving a low control under the nav. Always `scrollIntoView({ block: 'center', inline: 'nearest' })`.
- **`seed.sql` records NOTHING for today** — zero food, activity, body, workout and sleep rows — so any spec asserting a day's content is red here and green on CI. `body_metrics` has a `(user_id, date)` unique. check:rules is `Ran N of N` — never quote "pass".
- **Judge a colour change by sampling pixels**, not token values: `OffscreenCanvas` + `getImageData` in `page.evaluate` gives sRGB and WCAG ratios. For a LAYOUT complaint, measure `getBoundingClientRect()` on every child of the row.
- **The admin screens need `is_admin` AND a re-minted JWT** — the claim is in the token. Re-run `--project=setup`. Restore both.
- **Prove a destructive path from the DATABASE, not `page.route` interception** — a matcher that fails silently reads exactly like "no request fired".
