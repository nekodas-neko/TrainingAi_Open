## 2026-07-28 — Q-9: one max-HR resolver, and corroboration on every observed value

**Branch:** `fix/max-hr-single-resolver` · v1.226.3 · backlog item Q-9 cleared

### What was wrong

Three resolvers answered "what is my max HR", and they disagreed:

| resolver | rule | drove |
|---|---|---|
| `hrMaxFromAge` | 220 − age | `resolveHrProfile`, `/api/zone-minutes`, cardio hub, `body-battery`, `readiness-score`, score-audit |
| `resolveMaxHr` | observed, only if ≥ age-predicted | `/api/hr-profile`, `/api/cardio-week` |
| `estimateHrMax` | observed, always, **ungated** | guided interval-walk targets, fitness-test protocols |

They agreed only by accident: the observed max (168) sat below the age prediction (187), so
`resolveMaxHr` fell back and the divergence was masked. The first reading above 187 would have
split them silently — `hr-profile.ts`'s own comment claimed `/api/hr-profile` and
`/api/zone-minutes` agreed, and they never did.

`estimateHrMax` was the dangerous one, because nothing guarded its input:

- `app/api/body-battery/route.ts:268` — `Math.max(...hrRows.map(r => r.bpm))`, no plausibility
  band, no corroboration — **persisted daily** to `body_battery_daily.hr_max_observed`.
- `app/activity/guided-walk/page.tsx:31` — `Math.max` again over those daily values, so it took
  the worst spike in all of history and was **sticky forever**.
- `lib/health/fitness-tests.ts:89` — `maxHrFrom`, same bare `Math.max`, and its own comment said
  it fed `estimateHrMax({observed})`.

One motion artefact therefore became a permanent ceiling that pushed every Karvonen target
upward, with no path back down. Meanwhile `computeObservedHr` — which already does spike
rejection properly — was used by only two routes.

### What shipped

`resolveHrProfile` is now the single resolver, and every observed value passes through
`computeObservedHr` (30–220 bpm plausibility band; the max is the k-th highest reading rather
than the highest, so it takes 5 corroborating readings to move; unreliable below 60 samples).
`estimateHrMax` is deleted.

It deliberately returns **two** named numbers rather than collapsing to one, because the uses
genuinely differ and collapsing would have regressed a real fix:

- `maxHr` — the effort ceiling. Refuses to fall below the age prediction, so a quiet month can't
  make ordinary efforts read as maximal.
- `targetAnchorMax` — what reachable targets aim at, and it *does* use a lower observed max.
  Anchoring walk blocks on 220−age reads as a 20-year-old athlete's ceiling and put the fast
  block out of reach without jogging (the reason `estimateHrMax` existed in the first place).

Three resolvers → one; two accidental semantics → two named and documented ones.

Also folded in: two further copies of the resting-HR mean (28-, 30- and 90-day windows that
disagreed) collapse into the resolver, which now reports `restingHrSource: 'measured' | 'default'`
— the silent fallback to 60 was shifting every zone boundary on a column that is 58% NULL.
`app/baselines/page.tsx` was passing `hrMaxObserved: null` outright, so fitness-test targets were
pinned to 220−age regardless of what had been recorded.

### Verification

Full suite **2,388 passing**, `tsc` and lint clean, both custom-rule checks OK. The 20 failures in
`claude-ro-readonly-role.test.ts` are pre-existing — confirmed identical on a stashed clean `main`
(that role is created out-of-band and doesn't exist in the sandbox).

**Live `pnpm dev` run against local Postgres**, authenticated as the seeded test user. All routes
that use the resolver returned 200 (`/api/hr-profile`, `/api/zone-minutes`, `/api/cardio-week`,
`/api/cardio-trends`, `/api/body-battery`) and both changed pages rendered (`/activity/guided-walk`,
`/baselines`). No errors in the dev log.

The behaviour was then proven against real seeded `oura_heartrate` rows rather than asserted:

| seeded | result |
|---|---|
| 200 × 150 bpm, 4 × 210 (in-band artefacts), 50 × 250 (impossible) | `sampleCount: 204` — the 250s never counted as samples at all; `spikesRejected: 4`; `max: 150` |
| plateau 150 + **4** readings at 195 | max stays **150** — one short of corroboration |
| plateau 150 + a **5th** reading at 195 | max becomes **195**, and since 195 > the age estimate the working ceiling takes over (`source: observed`) |

Note on the corroboration semantic, worth writing down because it surprised me mid-check: the gate
is "the HR reached this value at least k times", not "k readings at this exact value". So distinct
high artefacts can corroborate each other — 4 × 210 plus 1 × 195 does set the max to 195. That's
the correct k-th-order-statistic behaviour (requiring k readings at an identical bpm would be far
too strict for continuously-varying HR), but it means corroboration bounds the *number* of bad
readings tolerated, not their arrangement.

### Not exercised

On-device. Guided-walk and fitness-test screens are the two consumers whose targets change, and
neither was run on the S25 — no live HR source in the sandbox. The change is JS/server-only (ships
via Railway, no APK rebuild), and both screens' target math is unit-tested, but the on-device
read of the new anchors is unverified. Known-Issues row added.

`body_battery_daily.hr_max_observed` rows written **before** this change are still raw maxima. The
column is a tuning snapshot and is no longer read as a max-HR override, so nothing depends on the
bad values — but they are not retroactively corrected, and any future consumer must not treat
historical rows as corroborated.
