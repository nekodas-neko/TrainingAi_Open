# 2026-08-30 — LB-25: body temperature reaches a screen, with the deviation gated

**Branch:** `feat/day-log-body-temp` · **Lane:** A · **Domain:** sleep · readiness

## What it was

Q-112b asked for HR min/max, body temp and the AI digest. Two of the three shipped; body temp had
**no client-reachable source**. `oura_daily_summary.temp_mean_c` / `temp_dev_c` are the live
BLE-derived values, and the only thing reading them was `app/api/ai/health-insight`, which feeds
`tempDevC` to a prompt and hands it to no component.

## The premise check changed the design

The entry says to add `bodyTemp: { meanC, devC }`. Measured against production first: 51 of 56 rows
carry `temp_mean_c`, 39 carry `temp_dev_c` — and **every deviation is positive**, 0.14 to 1.33 °C.

That is not a new finding. **TN-6a already shipped over it**: the readiness engine *suspends* its
temperature ladder while `isTemperatureBaselineCentred` is false, because the baseline sits ~0.36 °C
low and the ladder was costing −16.3 readiness points on 91.2% of nights. LB-25 was filed three days
after TN-6a's owner sign-off and does not mention it.

So the entry as written would have put "+0.5 °C vs baseline" on a screen — a number the scoring
engine refuses to score. **`devC` is therefore gated on the same condition**, reusing
`isTemperatureBaselineCentred` rather than inventing a second notion of trust. It self-clears: when
TN-6 centres the baseline, the field starts carrying `devC` with no further change.

`meanC` is **not** gated. An absolute skin temperature is a measurement, not a derivation from the
bad baseline, so nothing about the centring problem makes it wrong.

## The bug the type system could not see

The first draft compared the day's row to the route's `date`:

```ts
tempWindow.find(r => r.date === date)   // silently never matches
```

`normalizeDateParam` returns the **slash** form (`YYYY/MM/DD`), while `oura_daily_summary` is
dash-keyed and `shiftDateStr` splits on `-`. `date-utils.ts`'s own comment names the consequence:
*"feeding them normalizeDateParam's slash output is how zone-minutes and training-stress went
feature-dead (J-8/J-9)"*. Both forms are `string`, so `tsc` is blind to it and the field would have
been null forever.

Caught before it shipped, and pinned: the test drives the route with the slash form, because that is
what the client sends.

## Files

- `app/api/day-log/route.ts` — `DayBodyTemp` on `DayLogResult`, one windowed query serving both the
  day's row and the centredness test.
- `components/health/day-detail/day-read-through.tsx` — the stat pair, in `HrRange`'s shape.
- `lib/data/postgres/__tests__/day-log-body-temp.test.ts` — 4 tests.

## Verification

`pnpm check:rules` **Ran 62 of 62**, `tsc --noEmit` clean, full suite green, `check-hex-literals`
unchanged at 427 (the render uses tokens).

**Mutation-verified, both halves:** removing the centredness gate fails 2 of 4; reverting the
slash→dash conversion fails **all 4**, which is what proves the J-8/J-9 hazard was live rather than
theoretical.

**Exercised on `pnpm dev`, not only through vitest** — the DB test calls `GET` directly, which is not
the same thing as the route serving a real signed-in request. Both branches, against a seeded window:

| window | `bodyTemp` |
|---|---|
| centred (mean 0.04) | `{"meanC": 36, "devC": 0.04}` |
| uncentred, the production shape (every night +0.5) | `{"meanC": 36, "devC": null}` |

`/health/day` answers 200. The stat is not in the SSR shell because that section hydrates
client-side, which is why the assertion above is on the payload.

**The dev run caught a mistake worth recording — my own, in the fixture.** The first seed dated its
rows from Postgres `current_date`, which is UTC. At 21:53 UTC the Brisbane day is already tomorrow,
so the newest seeded row was 08-30 while the route asked for 08-31 and `bodyTemp` came back `null` —
looking exactly like the lookup bug I had just fixed. The vitest fixture had it right (`todayInTz`);
the ad-hoc SQL did not. It is the same timezone trap the repo has a rule for, arriving through a
hand-written query rather than through code.

**Not exercised: the S25.** The render is a handful of lines in an existing section and was not seen
on the phone. Nothing about it is device-specific — no safe-area, no gesture, no local store — so it
is a look, not a gate.

## What is deliberately not done

The deviation stays hidden until TN-6 lands. That is the point rather than a limitation: the
alternative is showing a figure the app's own scoring refuses to use. Nothing is drawn in its place —
an empty slot or a "—" would read as missing data, when the truth is the app has the number and does
not trust it.
