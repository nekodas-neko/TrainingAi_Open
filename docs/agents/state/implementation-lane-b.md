# 🚧 Implementation Agent (B) — baton

> **Successor sessions are titled `🚧 Implementation Agent (B) 🟢`** — exactly. A renamed successor is a lost thread.

**Updated:** 2026-09-22 · **By:** the thirty-sixth Lane B run · **Next ID:** `LB-127`

> **A mistyped ID here silently advances the lane's numbering.** Allocate with `grep -rhoE '\bLB-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`, and check the max in the **journal** too — a shipped entry leaves the queue. The pointer above is a floor, not an authority.

## Now

**v1.457.11→v1.464.7. Thirty-nine PRs.** Recent: **#1392** RV-86+RV-87 · **#1395** RV-89 · **#1396** RV-91 · **#1398** the `layout-384` batch of five · RV-97. **READY is 8** after sweep 52; the lane is not short of work. **⛔ `git fetch origin main` CAN LEAVE `origin/main` STALE** — always `--force --prune`. **LB-120 is still the dominant cost**, and it is now *always* the same five: `package.json` + `changelog.ts` (REBUILD from `git show origin/main:…`, never splice — the conflict falls INSIDE an entry's `changes:` array and both sides share the header above the marker), `projectOverview.md` (keep BOTH paragraphs, newest on top, and DELETE the loser's HEADER — three stacked `**Version:**` lines reached `main` this way), `doc-size-baseline-history.md` (append-only, keep BOTH), the `.size` files (`--fix`, never splice). **`check:rules` is `Ran 75 of 75`.** `enable_pr_auto_merge` refuses with *"already clean"*; **attempting the merge is the only reliable green check.**

**⛔ TWELVE entry claims did not survive contact, and that is now the base rate, not an anomaly.** RV-84 said 16 dead `.catch`es; there are 81 (68 harmless, 4 redundant, **9** real). RV-88's second defect is not one in that file. RV-79's `cachedFetchCore` calls `setCached` UNCONDITIONALLY after any 2xx. BF-185's schema is `.strict()`. **TN-58's comparative field exists NOWHERE.** LA-124's prediction was backwards. **RV-86 named the streak FIGURE, which already read `—`** — the confident zero was the WEEK count and the dot strip, and the banner it blamed comes from `/api/next-session`. **RV-87's "grid spins forever" was fixed the day before.** **RV-91 QUOTED A DOC COMMENT INSTEAD OF RUNNING THE FUNCTION** — `en-AU` is day-first with no comma, so `formatDateDisplay` returns `15 Sept` / `Tuesday 15 September`, and the string the entry quotes exists nowhere. **RV-94's "check this first" passed and did not help** — the secondary line DOES differ (350 g vs 258 g) but at the tail, which truncation removes. **RV-97's one-line fix does not compile** — a six-key union into a four-key helper, with boolean guards that cannot narrow. **Read the thing the fix would touch. An entry's numbers, cause and recommended fix are prose until something checks them.**

**Owed to the owner, all device:** `back-gesture-sitting` (BF-100, BF-166, LB-107, LA-109) is ONE sitting · `motion-polish` (RV-71, RV-72, RV-75, RV-74) is ANOTHER · **the whole `layout-384` batch just shipped UNVERIFIED and every fix in it is a pixel claim at 412px** · TN-3b · TN-35 · TN-53 · OR-118 · BF-186 · BF-177 · TN-50 · BF-175 · BF-165 · TN-25.

**A 4-hourly silent Routine polls this lane** (`trig_01WcuYTidPtngLFZFD7yKnoL`): syncs `main`, clears any open PR, runs `next-item.js`, **says nothing when READY is 0**.

## Next

1. **RE-SCAN BEFORE CONCLUDING ANYTHING — this has fired EIGHT times.** A "blocked" or "empty" finding has a shelf life of one merge. Sweep 52 took READY 0→15 in one go.
2. **RV-98 is next** (opacity-modified text below AA, and the contrast check cannot see it). Then RV-100, RV-101, RV-102.
3. **BF-165: ROOT CAUSE FOUND (#1281), FIX STILL OPEN.** `closeSurface` pops the entry the sheet pushed and `selectType` runs it immediately before `router.push`. **⛔ The obvious fix was BUILT and DOES NOT WORK** — the close is **415 ms late**, in an effect cleanup needing a React commit that `startViewTransition` holds. A real fix keys on **surface identity** (a module flag is the BF-34 known-bad).
4. **ASKING BEAT BUILDING on TN-13** — one line of code, four drawn options, answer **leave it**. Open owner questions: RV-38's `—`-versus-badge, OR-116's three-surfaces-one-number. **A decision an entry DELEGATES is yours: make it and write the reasoning into the code.**
5. **READY running low is not "no work" — READ THE KEEPS AND PARKED.** LA-108 and BF-5 printed as "not new work" while their residue WAS the work. TN-3b sat in PARKED three days while READY was 0.

## Blocked

- **Owner decisions:** BF-126, Q-551, the macro/budget anchor, LB-61's switch colour, PS-35's PWA landing.
- **BF-110 waits on the owner:** one blank resume in normal use, then read `bf110 resume recheck%` — **`stuck` → native, `resized` → render timing**.
- **LB-106 is open with its fix UNCLAIMED.** Its stated cause was wrong: the log says `net::ERR_ABORTED` at the **relaunch**, so the poll it blamed is never reached.
- **BF-100 is SETTLED in the harness, open only on the device (#1324).** **Do not re-run the synthetic probe in any form.**
- **LB-126 is CORRECTLY PARKED on LB-125 — do not self-unpark.** Three of its five call sites are a bare `{ weekday: 'short' }` and cannot convert until the helper has a style for it, which is Lane A's. **⚠ Q-254, BF-94, BF-84, PS-4, LB-94 are parked or unstartable by design. ~50 VERIFY entries owe a look** (BF-136/LB-99 sharpest). **⚠ OR-108 needs `LA-36`.**

## Claimed paths

None held. #265 and #608 are abandoned Lane B PRs whose work is on `main`; closing one needs the owner.

## Do not re-litigate

- **`packages/shared/**`, `app/api/**`, `lib/data/**`, `lib/sqlite/**`, `lib/local-store/**`, `lib/cache-groups.ts`, `lib/coach/**` are Lane A** — the **path**, not the nature of the edit. `scripts/**` is the Orchestrator's. **Clearing ANOTHER role's completed entry is their sweep — file it, do not do it.** `lib/walk/**` and `lib/hooks/**` are ours.
- **⛔ A SPLIT-LANE ENTRY PRINTS AS READY TO THE LANE THAT CANNOT START IT.** I filed LB-125 spanning both lanes and it headed Lane B's READY within the hour. **A Lane B half needing a Lane A argument is TWO entries with a `Needs:`** — and the field form is `- **Needs:** LB-125`, not a backticked `Needs:` line, which the checker does not parse.
- **`workout-screen.tsx` is shrink-only at 1835. `saved-meals-sheet.tsx` is 791 against a HARD 800. `session-select-content.tsx` is at its 1448 baseline** — adding eleven lines forced the streak walk out to `compute-streak.ts`, which is what the ratchet is FOR: **extract, do not shave comments.**
- **E2E is ADVISORY — but wait on it ONCE for a PR carrying a NEW spec**, then merge on the five REQUIRED checks. **A green from before a base drift is STALE**: #1395 went fully green, #1394 landed during E2E, and the merge needed the whole cycle again.
- **⛔ `freshWithinTtl: true` NEEDS EVERY WRITER IN A GROUP** (RV-64). **Ask what writes the PAYLOAD.** **Batons are shrink-only**; cut narrative before adding.

## The lessons that cost real time

1. **RUN THE CONTROL, AND READ WHICH ASSERTION CATCHES WHAT.** **⛔ A CONTROL THAT STOPS AT THE FIRST FAILED ASSERTION NEVER EXERCISES THE ONES BELOW IT** — RV-89's first control died on the `~` check and left the decimal-parity check unproven, so it was re-run reverting ONE file. RV-72's `width` mutation killed the LOCATOR the same way. **TN-50 is the sharpest: mutating the `useState` initialiser left the e2e GREEN**, because the reset effect overwrote it. **State how many cases discriminate** — RV-97's has 4 and 1 moves; RV-89's had 7 and 5 did. **A guard on an element that only renders in a NON-DEFAULT state passes vacuously** (RV-72): ask what the SEED renders — `/health` has no contributor chart, it is on `/health/readiness`.
2. **⛔ A REPO-WIDE SOURCE SCAN MUST EXCLUDE `__tests__`, AND `git ls-files a b -- '*.tsx'` DOES NOT FILTER — git UNIONS the three pathspecs, so `.ts` comes back too. Filter the extension in JS.** Both bit twice: RV-98's sweep repeated RV-91's exactly, with this lesson already written here.** RV-91's `Cal`/`kcal` sweep failed on **its own assertion messages**, which quote `"Cal"` four times. It passed locally because `git ls-files` does not list an UNTRACKED file, and went red on the first CI run that saw it committed. The comment above it claimed `git ls-files` made the scan safe; it made it unsafe against exactly one file.
3. **⛔ READ THE FAILURE'S PAGE SNAPSHOT BEFORE THE SCARIEST LINE IN THE LOG** (`error-context.md`). RV-89's spec could not find its row because `/workout` opens on the session CHOOSER — one press reaches the pre-workout list, the SECOND starts a workout.
4. **⛔ CHECK `main` IS GREEN BEFORE BLAMING YOUR OWN PR.** #1386's red was `cardio-hub-routes` asserting `Math.round(spanDays) === 90` against a midnight-anchored window — **`main` was red ~12h of every 24 on every branch** (#1387). Run the control on clean `origin/main`.
5. **⛔ CHECK YOUR OWN ENTRIES AND YOUR OWN FIXES HARDEST.** The `layout-384` test caught a branch my own fix missed — `injury-notice` renders a button OR a status div and only the button lost its `shrink-0`. **SHIPPING THE CODE AND CLEARING THE QUEUE ARE TWO ACTS**: run `next-item.js` AFTER the merge.
6. **WRITE DOWN WHAT WOULD DISPROVE YOUR CLAIM, THEN GO AND RUN IT.** **⛔ AND THE MIRROR: A NULL RESULT IS ONLY EVIDENCE IF YOUR PROBE COULD HAVE SEEN THE EFFECT.** Widening BF-100's unreachable window turned 182 ms into 15 s and it reproduced first try.

## Gotchas worth carrying

- **RUN `node scripts/check-test-typecheck.js` BEFORE EVERY PUSH — plain `npx tsc --noEmit` TYPECHECKS NOTHING UNDER `__tests__`.** Then `pnpm vitest run` WHOLE and `pnpm check:rules`. **Knowing the gotcha is not running the command.** **A leftover `next-server` holds port 3100 without serving it, and ⛔ `pkill -f "next dev"` KILLS YOUR OWN SHELL** (exit 144, no log).
- **⛔ DO NOT COPY A SEED-THEN-FETCH `useEffect(…, [])`** — 36 sites are FROZEN. Use `useCachedValue(key, url, ttl, { today })`.
- **The doc-size baseline is `wc -l` + 1 and the check FAILS ON SLACK** — `--fix`, never splice; **the placeholder is `1`, not `0`**. On the backlog a conflict is usually two *deletions* — keep neither, then **grep the ids** rather than reading the diff.
- **`total_count: 0` is NEVER slow CI** — stale base or `mergeable_state: dirty`. Use `list_workflow_jobs` STEP times, not the run's `updated_at`. **`refusing to merge unrelated histories` is the shallow graft** — `git fetch origin --deepen=200`. **After ANY merge run `git status --short | grep '^UU'`.**
- **`locator.click()` does nothing on Nutrition and times out on `/health`** — `.evaluate(el => el.click())` with a `waitForFunction` guard. **`getByText` resolves to the INNERMOST match.** **`tapCentre` DOES NOT SCROLL.** **The Morning Check-in is a MODAL and Radix `aria-hidden`s `<main>`** — `suppressMorningCheckin(page)` BEFORE `page.goto`.
- **`seed.sql` records NOTHING for today**, and every seeded 1RM is a whole number. **Judge a colour by sampling pixels**, a layout by `getBoundingClientRect()`, a CSS change by **computed style, never class strings**.
- **The admin screens need `is_admin` AND a re-minted JWT.** **`$CLAUDE_DB_QUERY_SECRET` IS SET in this container** — `claude_ro` settled three of RV-9x's "not established" questions in one curl each, and its `exercise_library.muscles` is ONE jsonb column, not `main_muscles`.
