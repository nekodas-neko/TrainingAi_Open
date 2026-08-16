## 2026-07-23 — Guided walk: consolidated GPS/speed/pace/cadence plan (docs-only)

**Branch:** `claude/guided-walk-uplifts-1gou5m` — owner asked to combine the GPS/speed/pace
items from the broader guided-walk uplift notes into one standalone implementation plan and
slot it into the backlog, after AD-2 (ring-cadence walk/run detection, a separate same-day
feature) shipped real code the guided walk's cadence task can reuse.

### What shipped

- New plan: [`docs/superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md`](../../superpowers/plans/2026-07-23-guided-walk-gps-speed-pace.md) —
  consolidates the former Phase A (GPS/map/elevation) and Phase B (per-phase speed/HR stats)
  from `2026-07-23-guided-walk-uplift.md` into 5 concrete, implementation-ready tasks, plus the
  pace-primary/HR-secondary UI decision baked directly into Task 4 rather than left as a
  "revisit later" note. Task 3 (live cadence) now points at the actually-shipped
  `lib/health/gait-classifier.ts`/`gate-feed.ts` subscription from AD-2 instead of the
  GPS-pace-guess-or-new-accelerometer-detector choice the original reconciliation pass left
  open — noted as depending on that branch merging first.
- The old Phase A/B sections in `2026-07-23-guided-walk-uplift.md` are replaced with a short
  pointer (kept as a historical marker, not deleted outright, so cross-references from Phases
  D/E/F/G aren't orphaned) rather than duplicating content that would drift from the new doc.
- `docs/implementation-backlog.md`'s guided-walk queue entry updated to point at the new plan
  and note AD-2 as the (separately-shipped, not-yet-merged) dependency.

### Verification

Docs-only — no code changed. No gate needed beyond this being internally consistent (checked
the full uplift doc read-through after editing so no phase reference dangled).

### Next

Work the GPS/speed/pace plan's Tasks 1-2 (no AD-2 dependency) whenever picked up; Task 3 waits
on `feat/ring-cadence-activity-detection` merging to `main` first.
