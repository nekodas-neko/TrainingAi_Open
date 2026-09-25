# 2026-09-26 — BF-200: the deload applied to four exercises and not the fifth

Owner, mid-deload: *"I went through with the deload routine. But it seems like skull crusher weight is
the same as my active workout. Why's that?"*

He is right, and it is one exercise out of five. Measured against the stored Upper prescription (all
five at `pct: 52`, `deloaded: true`):

| exercise | last real 1RM | 52% | loadable | app showed | |
|---|---|---|---|---|---|
| Incline Bench Press | 56.25 | 29.25 | 30 | **30** | ✅ |
| Chest-Supported DB Row | 15.5 | 8.06 | 8.75 | **8.75** | ✅ |
| Dumbbell Lateral Raise | 11.25 | 5.85 | 6.25 | **6.25** | ✅ |
| **Barbell Skull Crusher** | **36.5** | **18.98** | **20** | **30** | ❌ |

30 kg is his ordinary working weight — 2026-09-20 was 30×8 ×3. The deload machinery itself is fine.

**Two mechanisms both produce exactly 30 and the arithmetic cannot separate them:** the pct applied to
the all-time PR of **57.75** (52% = 30.03, exact), or the pct not applied at all and the normal
`target_80` of 29.25 snapping to a loadable 30.

**The check that settles it already exists.** `resolveWorkingBasisWithSource` returns
`source: 'last_real' | 'seed' | 'pr'` for exactly this question — `pr` proves the first, `last_real`
the second.

Under the first, the interesting part is *why* a usable 36.5 did not reach the resolver: deload rows
store `estimated_1rm = 0`, so a query filtering on that column returns nothing for an exercise whose
recent history is deload-heavy, and the fall back to a months-old PR is silent.

Flagged but not established: the 57.75 PR looks inflated against a 36.5 current, and CLAUDE.md already
records an inflated-PR class. A wrong basis and an inflated basis compound — either alone would have
been obvious; together they produce a number that looks plausible.

Not checked: `Pull` is also a whole-session deload and was not examined exercise-by-exercise.
