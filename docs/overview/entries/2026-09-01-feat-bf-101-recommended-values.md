## 2026-09-01 — a Recommended value per goal field, computed rather than generated (BF-101, v1.426.0)

**Branch:** `feat/bf-101-recommended-values` · **Lane:** B

The owner asked for a recommended value under each Profile goal field and assumed it would need a
model: *"id assume we use AI here to choose but maybe we could have some logic to decide so not
using the ai if not needed?"* It does not. `calculateBaseline`
(`packages/shared/src/nutrition/goal-recommendation.ts`) already returns a deterministic figure for
every field on that screen except sleep, and `/api/nutrition-goals/recommend` computes exactly that
baseline before handing it to `generateObject` to *adjust*. The work was plumbing.

### What shipped

- `components/profile/goal-baseline.ts` — assembles the same `BaselineInput` the recommend route
  assembles and calls the same `calculateBaseline`. Returns `null` — not a partial result — when
  weight, height, date of birth, sex, activity level or fitness goal is missing.
- `components/profile/recommended-value.tsx` — the control, in two states. It **offers** the value
  when the field differs and **states that the field matches** when it does not, on exact equality.
- Wired into steps, water and calories on `goal-targets-section.tsx`, and calories, protein, carbs
  and fat in `macro-targets-pane.tsx`. `goals-section.tsx` computes the baseline once and passes it
  down.

### Decisions worth not re-litigating

- **The measured RMR is fetched and carried through.** `calculateBaseline` routes it via
  `personalRmr` (BF-33), so omitting it would have quoted a *predicted* resting rate on a screen
  whose Health card shows the measured one — the same "two numbers for one thing" defect LA-45 and
  BF-99 both closed. Cost: one `GET /api/measured-rmr` on the profile tab, at `TTL_LONG` to match
  the clinical console's existing use of that key (a divergent TTL would fail
  `check-cache-ttl-divergence.js`, and did on the first draft).
- **The matching state is half the feature, not decoration.** The entry was filed on live drift: the
  steps goal held 7,000 — the *sedentary* figure — while the activity level said Moderate, whose
  target is 10,000, and water tracked its own formula correctly. A control that only ever offered a
  value would render those two fields identically.
- **Equality is exact**, deliberately. A tolerance would let "matches" cover a number the formula did
  not produce, which is the claim this control exists to make honestly. Water at 2,600 against a
  computed 2,616 therefore shows the offer, which is correct.
- **Sleep and fiber get no button.** `BaselineResult` carries no figure for either. Both are pinned
  by the guard, because the risk is not a typo but a later session adding "8 hours" for consistency.
- **Tapping goes through the field's existing change handler**, so it behaves exactly like typing the
  number. The goals form has no Save button — it debounce-patches on change — so "fills without
  saving" could not be honoured literally there. The macro pane does have one, and there the fill is
  local until Save Targets.

### Verification

- `components/profile/__tests__/goal-baseline.test.ts` — 14 tests. **Five mutations kill it:**
  dropping `measuredRmr` from the call, removing the completeness guard, a `fetch` in the
  deterministic path, a Recommended control in the Sleep block, a `baselineKey` on fiber.
- `e2e/recommended-goal-values.spec.ts` — drives the real screen: clears the activity level and
  asserts **no** control renders, selects Moderate, puts the steps field on 7,000, taps the offer,
  and asserts the field reads `10000` and the control flips to the matching state — with a request
  listener asserting **zero** calls to `/api/ai*` or `nutrition-goals/recommend` throughout.
  **Five mutations kill it**, including the model call. It passes twice consecutively; the first
  draft passed once and then failed forever, because its own successful run left the goal at 10,000
  — it now drives the field to a known-different value first.
- Full unit suite, `pnpm check:rules` **Ran 67 of 67**, `tsc --noEmit` and lint all clean.

### Not exercised

- **The S25.** Six new controls land inside an already-dense collapsible, and the offer button
  carries two lines at 412 dp. Whether it crowds the fields, and whether the macro pane still reads
  as a form, is unchecked — BF-101 stays in the queue with a `Keep:` line for it.
- Native SQLite / Capacitor paths (none touched), safe-area (no anchored control added), drifted
  production data — the baseline was computed against the local seed, not the owner's real profile.

### Found on the way

- **`main` was red** and not from this branch: the BF-103 guard merged in #773 matches its own
  matcher and its own test name. Confirmed by running the suite against a clean `origin/main`
  worktree. Another session had already opened **#775** to fix it, so this branch merged that in
  rather than duplicating the work.
- **LB-48 filed** — `POST /api/measured-rmr` invalidates nothing and `measured-rmr` is in no cache
  group. Narrow, and stated as measured rather than as the rule implies: both readers revalidate, so
  the cost is one app session of a stale Recommended calorie figure after saving an RMR test, not
  hard staleness. Lane A's, since the fix is a key in `lib/cache-groups.ts`.
