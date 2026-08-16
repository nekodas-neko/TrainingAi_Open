# 2026-08-15 — the column was empty because nothing asked for it (Q-270)

**Branch:** `claude/trainingai-backlog-v0abea` · **No version bump:** no user-visible change.

`oura_daily_derived.training_load_ots` was **0 of 89 days** in production. The obvious readings —
a broken producer, a missing input, a gate closing — were all wrong.

## Every gate passes

Measured against production rather than reasoned about, including the one that looked likeliest:

| gate | condition | measured | verdict |
|---|---|---|---|
| `no_readiness` | source is `ble-derived` | 31 days, latest today | **passes** |
| `readiness_learning` | `nHistory < 14` | `n_history` = **40** | **passes** |
| `no_profile` | age / sex / RHR present | RHR on **30 of 30** days | **passes** |
| `insufficient_met` | grid < 720 min or valid < 360 | **1,425 min span, 1,146 values** | **passes** |

MET was the one I expected to fail, because only 222 tag-`0x50` rows appear in the most recent
50,000 samples. Decoding a real day settled it: **104 events on 08-13, 14 values each** (~1/min),
17 gaps over 20 minutes, largest 59 — patchy, and still far above both floors.

**A correction to something I noted in passing while measuring this.** I recorded that `decoded` is
NULL on every `0x50` row, phrased as though the stored decode had failed for that tag. Re-measured
across the most recent 50,000 samples: it is NULL for **every tag**, all twelve of them. That is not
a gap, it is the archival design — `body_hex` is the source of truth precisely so a decoder improved
later can re-derive from stored hex, and the adapter re-decodes on read for exactly that reason. The
column is an unused cache, not a broken one. Recorded because the original phrasing would have sent
someone looking for a `0x50` decoder bug that does not exist.

So the value was computable every single day, and written on none.

## The cause

`/api/training-stress` computes the day's OTS and persists it **as a side effect of being called**.
Its only caller was `training-stress-line.tsx`, for `?date=${today}` only — and that card sits on
Health → **Body**, while the Health tab defaults to **Training**. Nothing else ever asked, and
nothing backfills.

A route that writes only when someone looks at it will not populate a column.

## The fix, and the one it avoided

One line in the sync-provider warm list. It runs once per launch, and **deliberately not on the BLE
ingest path** — that is where `aggregateOuraRawSamples` runs, and Q-213 traced a multi-week
production outage to that loop being saturated. There is also no cron layer (`module-map.md` §0), so
the launch-time warm is the available seam rather than a preference.

The cost is bounded and small: the route decodes ~104 MET events for one day, not the 35-day window
over ~987k rows that starved the loop.

Three details that are load-bearing rather than incidental:

- **No `?date=`.** The route resolves today from the **session** timezone, which is more correct than
  the client's `todayInTz()` with no argument.
- **`today: true`.** The card reads through `readTodayCacheSync`/`cachedFetchToday` and expects a
  `{date, data}` envelope. A bare warm write would miss on every read — wasted, while looking busy.
- **`TRAINING_STRESS_TTL`, not a literal.** Same value today; the constant is what stops them
  drifting, and `check-cache-ttl-divergence.js` now enforces it.

## Verified

Four guard cases, **mutation-verified three ways**: removing the entry entirely — the exact pre-fix
state — fails all four; dropping `today: true` fails the envelope case; substituting a literal TTL
fails the constant case.

Observed on the dev server: `GET /api/training-stress` with **no date param** returns **200**, and
`gated / no_readiness` on the seeded data. That is the right shape for a warm — it never fails the
launch, and persists only on `status === 'ok'`.

`pnpm build` passes · `tsc --noEmit` clean · lint 0 errors · `pnpm check:rules` **34 of 34** · full
suite **3,903 tests** under the TCP `DATABASE_URL`.

## What is not proven

**That it persists.** The local seed has no `ble-derived` readiness, so the route is gated here and
cannot reach the write. What is proven is that the warm calls it, that the call succeeds, and that
every gate passes *in production*. The first launch after this deploys is where the column starts
filling — and that is the thing to check, by re-reading `training_load_ots` in a day or two.

**No backfill.** This populates forward only. The 89 empty days stay empty; re-deriving them is a
separate job, and Q-204 needs the forward series more than the history.
