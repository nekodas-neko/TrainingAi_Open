# 2026-09-23 — Device sweep 1: the performance baseline, the approved writes, and a slowdown that builds with use

**Branch:** `device/sweep-1` · **Agent:** Device Verification · **Docs + `scripts/device/**`.**

S25 Ultra, web v1.465.10, APK 1.460.4, gesture navigation, owner's account. Run on his go-ahead with
his decisions recorded in `docs/device-sweep-1-plan.md`: weigh-in and mood overwrite accepted, only
the writes the checks need, the owner-present OS block skipped. The phone showed 🔴 throughout and 🟢
at the end.

## Performance — the first baseline this app has had

| probe | result |
|---|---|
| **P11 cold start** (RV-137) | first contentful paint **1020 ms**; tabs show content 61–103 ms after it, settle ≤ 1.4 s (Workout) |
| **P12 distribution** (RV-138) | **90 warm visits, no outlier** — every first visit ≤ 1.3× its route's median, slowest 164 ms. Q-51's 1086 ms did not recur, so by its own rule Q-51 should be re-placed, not built |
| **P13 waterfall** (RV-139) | Home fetches `/api/workout-data` twice per visit; Home and Health each have one 2-deep chain; the rest are flat |
| **P14 long tasks** (RV-140) | **every tab tap = one 68–118 ms task** in React's delegated click handler; scrolling produces none; `animationiteration` no longer shows at all |
| **P15 paths** (RV-141) | back stack correct in 2 presses; **RV-110 and RV-112's fixes hold** (same document across a cross-tab jump; separate scroll offsets) |
| **P16 + P10 long session** (RV-142, RV-133) | tab paint **61–103 ms → 126–434 ms after ~2 h of use, 134–449 ms after 30 idle minutes**; listeners 608 → ~2,200, flat while idle. Evidence for BF-22 |

## Writes (all undone, server checked after)

- **Food log + delete:** **DV-5's fix verified** — the new tombstone is `synced` straight after the push.
  **BF-177 still reproduces** on v1.465.10.
- **Weigh-in (RV-108):** logged today's own 69.4 kg. A weigh-in clears **3 of 202** cache keys. The
  local row kept every other column — `upsertBodyMetric` merges, so CLAUDE.md's warning about
  `metric-log-sheet` is stale.
- **Supplement tick (BF-185):** a re-ticked dose gets **`taken_at: null`**, not a rewritten time.
- **RV-45 verified and removed:** supplement and injury deletes, online and offline, no error toast.
  Filed alongside: **DV-10** (supplement deletes never tombstone locally) and **DV-11** (Manage
  Supplements' switches have no accessible name).
- **Mood (LB-116):** could not check — the sheet is unreachable once today's check-in is logged.
- **DV-4 verified and removed:** the Sleep card's hours now print in the foreground colour.

## Corrections I owe

- **DV-8's two headline claims were my misreading in sitting 1**: the session is in the local table,
  and the "server id" was the program session that `/api/workout-sessions/day` returns as
  `sessionId`. Corrected on the entry. A first pass today repeated the same misreading across 12
  sessions and was caught before it was filed — the repeating ids gave it away.

## Harness

`perf.js cycles` now saves per route and records a mid-visit reload instead of crashing (the first 70
visits were lost to that). Git Bash rewrites `/`-leading arguments — use `MSYS_NO_PATHCONV=1`. Both in
the runbook.

## Not exercised

The 53 automatable screen checks (block 4), admin (6) and resume (7), frames/paint (3) — next sitting.
Light theme, landscape, real airplane mode, and anything needing hardware.
