# 2026-09-24 — a 108-day self-report that is really a 91-day constant, shown on Home and fed to a model

**Branch:** `tuning/sleep-quality-is-a-default` · **Agent:** Tuning · **Docs-only.**

TN-65 established that set RPE is the only dense lived-feedback signal the app collects. This pass went
looking for a second one and found `mood_logs`: **108 rows across 108 distinct days**, 2026-05-27 to
today, with `energy_level`, `sleep_quality` and `body_state` all **100% populated**. That looked ideal.

## One of its three fields is not data

`energy_level` has real spread — drained 6, low 18, ok 50, good 34. `sleep_quality` has **two of its
five values**: `ok` 93, `good` 15, never `terrible`, `poor` or `great`.

The distribution alone is only suspicious. The date split settles it: **every `good` falls between
2026-05-27 and 2026-06-25, and every row since is `ok`.** The field went constant 91 days ago.

`packages/shared/src/validation/mood-log.ts:13` says why, and says it deliberately: *"the check-in no
longer collects it, so a queued mutation omits it and the write path defaults to `'ok'` — without that
default the `NOT NULL` column rejects the insert and the mutation strands in the outbox forever, which
is how the check-in came back on every app open (#47)."* **The default is load-bearing and must stay.**

## The defect is downstream, and both readers are live

- **`components/home/home-card-widget.tsx:220`** renders `Sleep: {SLEEP_LABEL[moodLog.sleepQuality]}`.
  Home has shown **"Sleep: OK"** every day for 91 days, from a constant, in the card that otherwise
  reports what the owner said. He is being told what he reported about his sleep, and he did not report
  it.
- **`app/api/nutrition-goals/recommend/route.ts:110`** puts `sleep quality=${m.sleepQuality}` into an
  LLM prompt beside a genuinely measured `Xh sleep` and a real `energy=`. The model gets 93 days of a
  constant as observation. The neighbouring Q-76 comment exists because an untrue sleep figure means the
  model *"learns nothing true"* — the same hazard, one field across.

Filed **TN-66, Lane A** (it straddles an `app/api` prompt and a Home component, so the path rule sends
it to the engine half first), with the fix being to distinguish defaulted from reported — TN-57's
`*_touched` convention already exists for exactly this — and **not** to remove the write default.

## Why this is a tuning entry and not just a bug

It closes off the signal I was looking for. `energy_level` is usable as an external validator;
`sleep_quality` is not. An analysis that checked capture rate and spread but not the date split would
have found a 91-day run of `ok` sitting beside a sleep score and read it as the score agreeing with the
owner's perception. That is the same failure mode as the two correlations already retracted this
week — a number that looks like evidence and is an artefact.

## Not exercised

Nothing runs; queue and documentation only. Measurements are read-only `claude_ro` queries, **row-scoped
to the owner**, plus source reading. **Not established:** whether the 15 collected rows are themselves
trustworthy (they predate the field's removal and were not audited), and whether any surface beyond
those two reads the field — the grep covered `lib`, `app`, `components` and `packages/shared/src` but
not a read that reaches it through a helper. `pnpm check:rules` result below.
