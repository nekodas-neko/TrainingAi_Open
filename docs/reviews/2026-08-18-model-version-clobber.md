# The readiness model stamp survived 5 hours 40 minutes, then a sibling writer erased it

**Date:** 2026-08-18 · **Agent:** Tuning · **Type:** defect evidence, docs-only
**Filed as:** Q-518 · **Lane:** A implements (this proposes only)
**Why this exists:** it **invalidates a claim I published today**. PR #85 reported that the shared
`model_versions` JSONB merge *"held in production"*. It held for the readiness write and does not
survive the next body-composition backfill.

---

## 1. Observed, with both readings

Same row, `oura_daily_derived` for **2026-08-18**, read twice in one session:

| read at | `model_versions` | `readiness_score` |
|---|---|---|
| **04:38:27** | `{"bodyComp": "atlas_2_1_0", "readiness": "v3:ri5:2026-08-18"}` | 76 |
| **10:18:40** | `{"bodyComp": "atlas_2_1_0"}` | 77 |

**The `readiness` key is gone.** Rows for 08-16, 08-17 and 08-18 all carry the same
`updated_at = 2026-08-18 10:18:40`, so one job rewrote all three.

Stamped rows across the whole table went **1 → 0**. Before this, the count had gone 0 → 1 earlier in
the same session when the readiness route first ran, which is how the disappearance was noticed at
all.

---

## 2. Mechanism — `COALESCE` does not merge JSON

`upsertOuraDailyDerived` (`lib/data/postgres/slices/oura.ts`) builds every column the same way:

```
set[k] = sql.raw(`COALESCE(excluded.${col}, oura_daily_derived.${col})`)
```

Its comment explains the intent — *"on conflict each keeps its existing value if the new one is null
… so a partial recompute never nulls a good value"*. That is correct **for scalars**. For a `jsonb`
column, `COALESCE` picks the first non-null **document whole**: a non-null incoming value replaces the
stored one entirely. It cannot merge, and nothing in the upsert says it should.

So the merge is left to each caller, and **only one of the two callers does it**:

| writer | what it passes | merges? |
|---|---|---|
| `lib/health/readiness-payload.ts:544` | `{ ...existingVersions, readiness: READINESS_MODEL_VERSION }` — reads the row first | **yes** |
| `lib/data/postgres/slices/oura.ts:1664` | `{ bodyComp: BODY_COMP_MODEL_VERSION }` — flat literal | **no** |

The body-composition backfill loops every `body_metrics` row with a weight and body-fat value and
upserts each day with that flat object. Every day it touches loses any other pillar's stamp.

**The readiness code did nothing wrong** — its merge is correct and its comment explains exactly why
it exists. It is simply the only participant honouring a convention the shared writer does not
enforce.

---

## 3. What it costs

1. **Q-501's whole purpose is defeated.** That entry exists because there is no way to tell whether a
   past score moved due to changed inputs or a changed model. The stamp was the fix; it does not
   survive the next backfill.
2. **Sleep's trend step is now unmarkable by stamp.** The 2026-08-17 → 08-18 model boundary measured
   in PR #85 was verified by *recomputation*, precisely because sleep has no stamp. Readiness was
   supposed to be the pillar that did — and now, in stored data, it does not either.
3. **Every future pillar that stamps has the same exposure.** The next agent to add a stamp will read
   the readiness code, copy its correct merge, and still be clobbered.
4. **My PR #85 verification was true when measured and is now false.** The claim "the merge held in
   production" should read "the readiness write merges correctly, and a sibling writer erases the
   result within hours".

---

## 4. Proposal

**Move the merge into `upsertOuraDailyDerived` and out of the callers.** For `model_versions`
specifically, the conflict arm should concatenate rather than replace:

```
COALESCE(oura_daily_derived.model_versions, '{}'::jsonb) || COALESCE(excluded.model_versions, '{}'::jsonb)
```

which keeps every existing key and lets an incoming key win where they collide — the behaviour both
callers already assume.

**This is the pattern the codebase has already chosen once, in this same file.**
`upsertOuraHeartrate`'s comment says it plainly: *"this makes the guarantee the function's own, so
every caller gets it rather than each one remembering."* Q-280 exists because two siblings of that
function did not get the same treatment. **This is the identical shape one column over**, and it
should be fixed the same way rather than by adding a read-modify-write to the bodyComp backfill.

**Do not fix it by patching the bodyComp caller alone.** That restores today's stamp and leaves the
next writer to rediscover the rule — which is how this happened.

**Re-verify by observation, not by reasoning:** stamp a row via the readiness route, run the
body-composition backfill, and re-read. The failure has a 5-hour observable window and reasoning about
it is what produced the wrong claim in the first place.

---

## 5. What was not exercised

- **No code changed.** The `||` expression above is written but was **not run** — not against the
  local database, not in a test.
- **The job that ran at 10:18:40 was not identified directly.** The bodyComp backfill is the writer
  whose payload matches the surviving document exactly, and it is the only `model_versions` writer
  that passes a flat object — but no scheduler or trigger was traced, and **what invoked it is
  unknown**. Its cadence is therefore unknown too, so "the stamp has a short half-life" is an
  inference from one observation, not a measured rate.
- **`readiness_score` also moved 76 → 77** across the two reads. That is consistent with the readiness
  route recomputing at some point in between, and it is **not explained here** — in particular it is
  not established whether the 10:18:40 writer recomputed readiness or whether that was a separate
  earlier write. It does not affect the clobber finding, which rests on the missing key.
- **Only the owner's rows are visible** (`claude_ro` is row-scoped), so whether other accounts show the
  same pattern is structurally unknowable from here.
- Both readings are from this session, 2026-08-18, roughly 04:38 and 10:18 UTC.
