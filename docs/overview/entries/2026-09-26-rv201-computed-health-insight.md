# 2026-09-26 — RV-201 ①: the health insight is written from the numbers, and one of them was `[object Object]`

**Branch:** `feat/rv201-computed-health-insight` · **Lane A** · closes `RV-201`'s health-insight
half and `PS-31(a)`, files `LA-152`

## What shipped

`app/api/ai/health-insight` no longer calls a model. It was the app's most-called prose route —
**28 calls in 30 days**, measured against `ai_call_log` — and every fact it sent the model was
already computed in the handler. The model supplied phrasing, and phrased badly often enough to
matter: 16% of 117 audited insights carried a superlative or an imperial unit, one of them calling
a score of 80 "perfect" (Q-292).

The owner's decision of 2026-09-25, recorded on `RV-200`, covers this: *"we use AI more than we
need to … use logic instead to save on tokens and offline compatibility."* No further gate.

`insight-text.ts` renders the four things the prompt was asking for — headline and band, weakest
contributor, today placed against the recent values, and an explicit sentence for anything not
measured. It works offline, costs nothing, and cannot invent a number or a judgement.

## The defect this found, which was not what the entry was about

Running the route against the dev server — rather than reading it — returned this:

```
The weakest contributor is checkin at [object Object]/100. Also recorded — Contributors:
checkin [object Object]/100, hrvBalance [object Object]/100, …
```

Confirmed against production the same hour. **Two shapes live in one column name.**
`oura_daily.readiness_contributors` holds `{ hrv_balance: 90 }`; `oura_daily_derived`, which the
app writes and which this route PREFERS when present, holds
`{ hrvBalance: { score, input, gap, provisional } }`. `formatContributors` assumed the first — so
every readiness insight this route has ever produced was built on `[object Object]`, and handed
to the model as fact.

A second fault rode along: the derived row's keys are camelCase and the label map is snake_case,
so even the names rendered raw, and three keys (`checkin`, `temperature`, `prevDayActivity`)
differ by more than casing and had no label at all.

**Nothing could have caught it by reading.** The one caller wrote
`as Record<string, number | null>` on the row. That cast made the wrong shape typecheck, so the
compiler, the tests and any review were all looking at an assertion rather than the data — and
the route's own tests mocked contributors as plain numbers, so they agreed with the cast. The
dev-server run is the gate CLAUDE.md requires before a merge, doing precisely its job.

Fixed here: `lib/oura/contributors.ts` reads `.score` from either shape and takes `unknown`
rather than a lie, `labelFor` matches both casings, the three renamed keys have labels, the cast
is gone. Recorded as `LA-152` so the next reader of those columns does not rediscover it.

## Verification

- **Live, on `pnpm dev`, all four sections** — the readiness insight now reads
  *"The weakest contributor is Activity balance at 0/100. Also recorded — Contributors: Activity
  balance 0/100, Previous day activity 0/100, Morning check-in 50/100, …"*. Every key a human
  label, every value a number.
- Mutation pass, 5 mutants + 1 equivalent control. **M2 survived the first attempt**: appending
  the absent labels to the readout went uncaught, because the assertions looked for `Steps: ` and
  a bare label slipped through — the Q-353 defect class exactly. Added an assertion that an
  absent label appears only in the absence sentence, confirmed it kills the mutant.
- 18 contributor tests, including one that asserts every `READINESS_WEIGHTS` key resolves to a
  label; 23 route/builder tests.

## Four couplings moved with it

Three were recorded in advance by `RV-200`, which is why they cost minutes rather than a session:
`lib/ai/degrade.ts` cited this route as *the* reference implementation, `prose-guards.test.ts`
floored the prose-route count at 6 (measured 5 now), and its `PROSE_ROUTES` list named the file.
The fourth: `prompt.ts` no longer builds a prompt, so it is `metrics.ts`.

`stale-cache.test.ts` became `reflects-current-readings.test.ts`. Q-293 — an insight written
before the ring synced being served all afternoon — is now structurally impossible rather than
guarded, so the file asserts the property (output tracks current data, no row read or written)
instead of the mechanism that delivered it.

## Not done, deliberately

The **weekly-digest half of RV-201**. Split by surface: the two share no code and the done-when is
per-surface, while `main` merged five times during this half alone. The entry now carries that
reasoning and keeps the weekly-digest work queued.

**Not device-verified** — no APK run. The change is server-side and reaches the device through a
normal Railway deploy, but the card itself was seen only at the dev server.
