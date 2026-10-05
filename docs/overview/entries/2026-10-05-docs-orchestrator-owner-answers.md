# 2026-10-05 · Orchestrator: tuning proposals, no-ring audit, owner answers

_Domain: `platform` (also `cardio`, `readiness`, `workouts`, `nutrition`) · docs-only_

## Tuning proposals posted (each with days moved from production)
- **#2198** vigorous floor: 60% of HR reserve (ACSM) for both roll-ups. 7 of 112 cached days move; 0 of 17 weeks change WHO status. The zones are % of **reserve**, not % of max HR. An earlier draft read them as % of max HR.
- **#2194** ACWR acute window 8 → 7 days. 36 of 131 days change band, 23 cross the 1.2 early-deload line, 6 cross 1.5.
- **#2235** Body Battery waking-rest offset: replayed through the shipped `walkBodyBattery`. +9 bpm passes the mean/@0/@100 tests; **no offset reaches sd ≥ 28**, because spread is set by the charge/drain gain, not the threshold. Filed **#2335** (nightless days start at midnight and count sleep HR as waking rest; 16 of 56 days).
- **#2133** set allocator design, behind #2132. 21 of 23 recent sessions had every exercise at ≤ 2 sets.

## No-ring audit (#2090, closed)
Local dev, a seeded user with no ring data, about 55 routes. No 500s and no NaN. Filed **#2336** (readiness sends score 5 with no recovery data, which drives "Rest fully"), **#2337** (Body Battery 50 / zone quotas 0 / 0 h sleep shown as real values) and **#2338** (ring-agnostic copy + manual sleep entry). Rendered UI and on-device were not exercised.

## Owner answers (2026-10-05, interactive prompt)
#2198 60% · #2194 7 days, plus a window cascade → **#2340** · #2235 9 bpm, then per-person refit → **#2341** · #2072 striped · #2093 any activity, zone minutes only · #2196 yes (dedupe + unique key) · #2073 fix + p75 margin (closed; #2132 unblocked and added to Batch #3) · #2075 keep tile, new glyph · #2085 1 session = 1 T1, provisional · #2250 accept three, keep both optional · #2338 yes, manual sleep entry · #2071 restated as one RMR-based number (Orchestrator maps the terms before build).

## Shipped
- **#2064** lean rules + three agent roles: merged.
- **#2339** docs-only CI skip: merged. This entry's PR is its first live test.
- BugFix cloud session started.
