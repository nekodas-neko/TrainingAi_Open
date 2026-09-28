# 2026-09-28 — PS-49: collection rules v2 computed beside v1

The v2 engine is built and returns alongside v1 rather than replacing it. `GET /api/collection`
keeps `collections` exactly as before and adds `v2`:

- **Tank:** v1's rest-allowance fold on the 5 · 4 · 5 · 3 · 3 ladder, 100 sessions to the big tier.
- **Ranger:** a bank of 5,000 steps per T1, draining 1,000 a day.
- **Health cat:** one point per category logged a day (sleep, food, weight), 3 per T1, draining 1.
- **Rogue:** `null`, pending the owner (PS-48 ②).

**Why beside, not instead.** The plan said to bump the version and re-score. But the surface reads
v1's keys through typed maps, and the re-score is the owner's call (PS-48 ④). Computing v2 alongside
lets the engine merge now and changes nothing he sees. The surface switch is Lane B's, gated on
PS-48.

**The bank reuses the named-cat fold.** Each day's change in `floor(bank / unitsPerT1)` becomes
spawn or decay events on the existing `settle`/`decayOnce`. With 3 → 1 merges that is exactly the
plan's base-3 conversion, and every cat keeps its name and lineage. The collection's third PR had
warned that a replacement fold would lose both.

**The owner's result, measured on his history:** workouts unchanged (T3 4, no T4 yet over 102
trained days); steps T3 5 → T3 2 · T4 1 · T5 1 (a 633k-step bank, 126 T1, matching the plan's ~120
estimate); Health cat T1 1 · T2 1 · T4 2 (58 T1). The table is on PS-48 for when he answers.

Tests: 10 for v2 (the owner's worked examples: 4,000 profit on 5,000 steps, the base-3 stock, the
110-session streak, the drain running on to today). Four mutants killed. 114 existing collection
tests unchanged. Three new one-column reads exclude soft-deleted rows. Rares and lucky procs are
not built; their rates are the plan's, not the owner's.
