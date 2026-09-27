# 2026-09-26 — Device sweep 4b: gesture-nav checks pass, food-delete tombstones stick at `pending`

**Branch:** `device/sweep-4b` · **Agent:** Device Verification · **Docs only.**

S25, APK 1.465.52, web v1.465.67, gesture navigation. Production was watched throughout with no slow
answer.
- **Closed:** DV-2, BF-165, RV-37, RV-127 (clearance half) and RV-125 (write-half re-run, attributed).
- **New:** DV-8 is common, not a one-off — 36 food delete tombstones are stuck `pending` with both
  outboxes empty. RV-155 station A found no `health-alerts` notification channel.
- **Updated:** RV-205's private gallery (version 3, 75 captures, P25 passes). RV-206 read-only probes:
  P39 formatting mix, P33 reach, P34 input modes, P32, and P40 passes. BF-22 is narrowed further (no
  growth through writes and sheets). PS-35b's launch half passes.
- **Not run:** RV-206's P29–P31 (these need the owner's OK), RV-155 station C and most of B/D/E, and
  P35–P38.
