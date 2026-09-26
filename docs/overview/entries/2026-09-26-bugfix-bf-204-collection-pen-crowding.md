# 2026-09-26 — the collection pen is crowded by construction, not by chance (BF-204)

The owner used the cat collection for the first time on the S25 and reported it plainly: *"Its a bit
cramped in there. Might be too many at once."* Intake traced it and filed **BF-204** (Lane B, rank 1).

## The report was right about the symptom and understated the cause

"Too many at once" reads as a cap that wants lowering. Lowering `MAX_SHOWN` alone would not fix it,
because three mechanisms each force crowding and they compound:

1. **`penCats` sorts biggest-tier-first and then takes the top twelve**, so the pen always draws its
   twelve *largest* cats. It never shows a 34 px slime while a 50 px Tank exists. Twelve T2s is
   **600 px of sprite in a 348 px pen — 1.72×**.
2. **One tier means one vertical band.** Tier 2's band is `[32, 44]` — a 12 px spread — so the set
   mechanism ① selects lands on a single line. The depth-by-tier design cannot separate cats that
   are all the same depth.
3. **Slots are narrower than sprites**: `348 / 12 = 29 px` against 34–50 px, so neighbours overlap
   by ~13 px before any wander, and the wander is ±4 slots.

## The pen is 176 px tall and v1 can reach 44 px of it

`SIZE` and `BAND` carry six entries and `FLYING_FROM_TIER = 4`, but every v1 ladder has three tiers.
Bands 3–5 and the flying mechanic are unreachable, so **17 % of the pen's height is in use and ~75 %
is empty sky** — the exact shape of the screenshot. The room to spread cats out was allocated and
cannot be reached until PS-49's six tiers land.

That is also why the entry says **not** to stretch the bands now: v2 spends that sky.

## The name tags are the loudest symptom

Twelve six-character tags ≈ 456 px against 348 px. On the owner's screenshot "Beaso" is occluded and
"Har", "P" and "Xecom" are clipped mid-word.

## Measured, not assumed

Production, 2026-09-26: 106 workout days, 149 step days, 106 sleep days. Replayed against the v1
costs that is ≈ 22 cats with ≈ 13 at top tier — so mechanism ① draws twelve 50 px sprites. His card
reads 12 shown + "+12 more" = 24, consistent to within the decay events the estimate does not model.

## One correction worth recording

An earlier reply in this session described the collection as shipping emoji glyphs with the artwork
still outstanding. That was read off a clone 38 commits behind `main`; the art, the names, the pen
and the scenes had all shipped. Re-sync before describing a feature's state.

## Not exercised

Docs-only. Nothing was run against the device, and the pass/fail BF-204 names — no clipped name, no
fully hidden cat — is owed on the S25, not in the sandbox.
