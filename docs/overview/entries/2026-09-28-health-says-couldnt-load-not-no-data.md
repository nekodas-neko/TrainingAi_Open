# 2026-09-28 — LB-176: Health stops describing the account when it means the request

**Lane B.** Branch `fix/health-says-couldnt-load-not-no-data`. v1.478.4.

## What shipped

Cold at 412 px with every `GET /api/*` failing, the Health screen made a dozen statements about the
owner's account that were really statements about failed requests. All of them now say which happened.

| Site | Was | Now, when the read failed |
|---|---|---|
| `Dist`, `Burned`, `BMI`, `Balance` (`health-sections.tsx`) | "No data" | "Couldn't load" |
| `Resting HR`, `HRV`, `SpO₂` (`rhr-hrv-spo2-card.tsx`) | "No data" | "Couldn't load" |
| weight sparkline | "Not enough data" | "Couldn't load" |
| Weight Trend | "Log body weight to see trend" | "Couldn't load your weight trend" |
| `hr-day-card.tsx` + `heart-rate/page.tsx` | "No HR captured yet today — the ring records periodically while worn." | "Couldn't load today's heart rate." |
| `activity-history-card.tsx` | "No activities this week" | "Couldn't load this week's activities" |
| `nutrition-activity-trends-card.tsx` | "No nutrition/activity trends yet." | "Couldn't load your nutrition and activity trends." |
| `training-load-card.tsx` | "Not enough data yet" | "Couldn't load your training load" |
| **energy budget** | **"Set up your energy budget — Add your height, age and sex in Profile"** | "Couldn't load your energy budget" |
| `goals-progress-card.tsx` | *card vanished* | "Couldn't load your goals" |

Seven reads gained an `onError` (`body-metadata`, `training-load`, `sleep-performance-correlation`,
`progress-summary`, `user-goals`, `oura-hr-day` ×2, `activity-logs`, `health-trends-summary`), and
`useEnergyBalanceToday` now forwards an optional `opts` so its caller can hear a failure at all.

## The copy was already settled — I did not invent it

The entry asked to "settle the copy once". It turned out the repo had already settled it:
`movement-balance-card.tsx` and `weekly-stats-hub.tsx` have said **"Couldn't load your …"** through
`EmptyState` since before this entry existed. So cards use `EmptyState` with that sentence, and the
2-column metric cells use the same sentence trimmed to the one `text-xs` line they already had —
`EmptyState` is `py-8` centred and far too tall for a tile. One local `CellEmpty` helper decides it.

## The worst case, and why it was worse than the entry said

`energyBalance` is `null` while loading, on a failed read, **and** for an account with nothing stored,
and the branch sent all three to `EnergyBudgetPrompt` — *"Add your height, age and sex in Profile"*. So
a request that did not land told the owner to redo something he did months ago, **and a cold load
flashed the same instruction before the payload arrived**, which the entry did not mention.

Worth recording for whoever touches it next: **a genuinely incomplete profile never reaches that
prompt.** The service always returns `missingProfileFields`, and a non-empty one routes to
`CalorieBalanceBar`, which names the fields actually missing instead of guessing three. That makes the
prompt's remaining branch hard to reach — but "unreachable" is not proven, so it stays rather than being
deleted on an assumption.

## Two corrections to my own entry

- **`trends-section.tsx` was never broken.** It already prints "Couldn't load this trend." for a null
  payload, and its "Not enough data yet" fires only when the payload itself says insufficient. The
  entry listed it; reading it removed it.
- **`sleepVsPerformance` is a vanish, not a lie.** `health-sections.tsx` rendered it only when
  `sleepCorr` was non-null, so a failed read removed the card entirely rather than mislabelling it —
  RV-150's class, not this one. Fixed anyway, since it is the same rule's other half.

## The size check refused it, and the extractions were owed anyway

`check-component-size` failed: `health-sections.tsx` went from 773 to 833 against an 800-line limit —
it was already within 27 lines of the ceiling. Three things came out, each to where it belonged rather
than trimmed to squeeze under:

- **`components/health/cell-empty.tsx`** — the shared copy decision. A rule about what every metric
  cell says has no business inline in one screen's switch.
- **`components/health/body-cards/weight-trend-card.tsx`** — a ~55-line self-contained card.
  `rhr-hrv-spo2-card.tsx` came out of the same file for the same reason, so the folder and the
  precedent already existed.
- **Two long notes moved onto the components they describe** — the energy-budget reachability analysis
  to `energy-budget-prompt.tsx` (where someone changing that copy will actually read it) and the
  vanish note to `sleep-vs-performance-card.tsx`.

**Final: 755 lines — 18 FEWER than before this fix**, while adding it. I re-ran the e2e after the
extractions specifically because the card's JSX was moved by script rather than by hand.

## Verified

- New unit guard `app/health/__tests__/lb176-failed-reads-say-so.test.ts`, 13 cases,
  **control-run five ways with each mutation asserted as applied**: dropping the `body-metadata`
  `onError`, dropping the `hr-day` one, putting the prompt back in the null branch, restoring the Goals
  vanish, and stopping the hook forwarding `opts` each fail exactly one case. Restored 13/13.
- **`e2e/rv150-failed-read-says-so.spec.ts` extended with three Health cases and RUN, not just
  written: 7 passed in 1.7m** (`-g Health`, which also picks up the two existing healthy-cold tests).
  That matters because the entry's "Done when" is a rendered observation — *"a cold start with the
  reads failing shows no cell claiming 'No data'"* — so asserting it in a file I had not executed
  would have been marking it fixed from intent. Includes the **healthy-cold control** the entry asked
  for by name: without it, a component that always rendered "Couldn't load" would pass the other two.
  The failure case asserts `toHaveCount(0)` on the literal "No data", so it cannot be satisfied by
  fixing one tile and leaving its neighbour.
  **First attempt failed for an environment reason worth writing down:** `zero-data.setup.ts` errors
  with *"DATABASE_URL must be set"* because this sandbox's shell snapshot unsets it, so the setup
  project fails and the specs never run — reading that as a code failure would have been wrong. Pass
  the TCP URL explicitly (`DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev'`).
- `npx tsc --noEmit` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full
  `pnpm test` green · `pnpm build` clean.

**⚠ The guard was wrong four times before it held, and every time `indexOf` had found the wrong
occurrence** — a `readCacheSync` seed sharing a cache key with the fetch under test; a key written with
double quotes where the pattern allowed only single and backticks; a `case "energyBudget"` in
`isSectionVisible` that just `return true`s, ahead of the render arm; and a paren-matching bound applied
to a `{}` block, which walked backwards past the anchor and returned an empty string. Each failed
against *correct* code, which is the tell. **The first match is not the match.**

**Not exercised:** not device-verified. The e2e reproduces the cold-failure case at 412 px in
**Chromium**, not in Samsung's WebView, so the copy has been observed rendering under the real
condition but not on the S25. Nothing offline-first, native, safe-area,
gesture or notification is touched; this changes only what a card prints when its own read failed.
