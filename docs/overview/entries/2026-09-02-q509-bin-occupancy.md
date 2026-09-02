# 2026-09-02 — Q-509: bin occupancy closed, and the reconstruction finally reproduces the number

**Branch:** `claude/la-q509-bin-occupancy` · **Agent:** Implementation Lane A · Docs only.

Q-509's pre-registered smoothing experiment ran the day before and recovered 52% of the 0.933 h gap
before plateauing, leaving three candidates its review could not separate. This session measured two
of them.

**Bin occupancy is closed.** The premise held in the code — `nightlyHeartRate` returns every
non-empty bin while gating resting HR at `MIN_BEATS_PER_BIN`, and `run.ts` drops `beatCount` on the
way to `computeRecoveryIndex`, so the argmin genuinely could land on a one-beat bin. It never does:
across **575 night bins not one** falls below the threshold, the winning bin carried **81–282
beats** on all eight nights, and excluding sparse bins moved the settle time by **0.000 h** on every
one of them. Sparse bins exist — 86 of 1,827 bins in the archive hold five raw rows or fewer — but
only in daylight, because the ring streams hundreds of beats per five-minute bin while asleep.

**Window geometry is bounded and small.** Widening each window two hours at the start moves one
night of eight, and that one is a 1 h window the detector barely found. Stored data agrees: the 3 of
57 BLE nights whose longest window is under 6 h average 1.55 h against **2.712 h** for the other 54
— worth about 0.06 h. `recoveryIndexHours: last.recoveryIndexHours` searches only the night's final
segment for the minimum, which is worth fixing on its own terms, but fragmented nights average
2.719 h against 2.639 h for single-window nights, so it is not the gap either.

**What that leaves is the useful part.** Of 0.933 h: smoothing 0.487, occupancy 0.000, window
geometry ≈0.06. The remaining ≈0.39 h sits in ordinary, well-detected nights — the 54 full-length
ones still average 2.712 h against the Cloud era's 3.59. Two mechanical explanations spent raises
rather than lowers the odds on a real change over the six weeks, which is why the entry's two
prohibitions (do not widen `MEDIAN_WINDOW`, do not move `RECOVERY_INDEX_OPTIMAL_HOURS`) come out of
this stronger than they went in.

**The instrument is now trustworthy, and that is the part worth keeping.** The previous review
reconstructed at 4.27 h against a stored 2.653 h and had to report shifts only. Three rules fix it,
and the review writes them down because losing them is how the caveat survived two sessions: decode
the raw `0x80`/`0x60` frames instead of reading `oura_heartrate`; bin and space in `ds`, never in
`measured_at` — an ingest stamp that drifts, and that fitted **98 bins into a 91-bin window**; and
take the window from `sleep_sessions`, which `run.ts` writes *after* `clampToDenseSensing` mutates
`w` in place, so it is already the clamped span rather than the looser one everyone assumed. It
reproduces three nights to within 0.03–0.21 h. The fourth disagrees, and that is the harness working
— the stored row for 2026-08-27 is PS-17's phantom afternoon window, which the reconstruction picks
out at 3.85 h against the real night's 0.54 h.

**Found on the way:** `oura_daily_derived.recovery_index_hours` is NULL on all 107 rows and no
producer writes it — the value lives in `oura_daily_summary`. It nonetheless carries a full local
mirror (SQLite column, `RECONCILE_COLUMNS` row, both upserts, the pull and sync mappers), which is
exactly what makes a dead column read as an available signal. Same decision as `worn_hours_ble` —
populate or drop, and dropping is destructive — so it joins that item on Q-510's `Keep:` instead of
opening an entry of its own.

**Not exercised:** nothing runs on the device or changes behaviour; this session shipped no code.
The measurement covers the seven days `oura_raw_samples` still retains directly — older frames are
in `oura_raw_packed` and were not unpacked — so the occupancy result is a rate over 8 windows, not
over all 57 BLE nights.

[`docs/reviews/2026-09-02-recovery-index-bin-occupancy.md`](../../reviews/2026-09-02-recovery-index-bin-occupancy.md)
