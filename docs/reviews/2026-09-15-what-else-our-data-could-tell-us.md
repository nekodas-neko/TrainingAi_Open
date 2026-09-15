# What else our data could tell us — an audit of unused signal

**Asked by the owner, 2026-09-15:** *"This might be a good opportunity to investigate other metrics
we can calculate from our data too."* This is the audit. It looks for signal the app **already
stores and does not use**, rather than proposing metrics that would need new hardware or new data.

Two hypotheses were tested and killed, which is recorded here so they are not re-tested.

---

## The headline: the stress model is a guess, and the ground truth is sitting in the database

**Daytime stress is imputed, not measured.** The ring streams HRV events for roughly 7% of waking
hours, so `daytime-hrv-model.ts` fits `ln(rmssd) = a + b·hr + c·temp` on night data and applies it
to daytime heart rate and temperature. That imputation drives `stress_high_minutes`, which drives
the deload override that fired on 10 of the owner's last 22 days (TN-36).

**It has never been validated against measured daytime HRV — and measured daytime HRV exists.**

The Polar H10 writes raw beat-to-beat intervals to `rr_intervals`. Measured 2026-09-15:

| | |
|---|---|
| beats stored | **136,440** |
| distinct days | **48** (2026-07-17 → 2026-09-15) |
| **hours worn** | **07:00–13:00, peaking at 08:00** |
| beats between 22:00 and 05:00 | **zero** |

And the overlap is not incidental — twelve of the last fourteen strap days carry thousands of beats
**on days the stress model also ran**:

| day | strap beats | stress_high_minutes |
|---|---:|---:|
| 2026-09-14 | 5,559 | 150 |
| 2026-09-08 | 5,993 | 90 |
| 2026-09-01 | 5,843 | 270 |
| 2026-09-06 | 4,369 | 150 |
| 2026-08-30 | 4,970 | 30 |

**The strap covers exactly the hours the model is guessing about.** `rmssdFromRr` already exists,
is artifact-filtered, and already runs on this data for workout windows. Comparing imputed dHRV
against measured rMSSD on the overlapping 30-minute buckets is a measurement, not a project — and
it answers whether the number driving deload recommendations is real.

**⚠ This is the strongest finding in the audit and it should outrank the rest of this document.**

---

## The same data feeds three models it never reaches

`lib/oura-ble/rollup/run.ts` calls `lfhfFromIbi` (LF/HF autonomic balance), `breathingFromIbi`
(respiratory rate) and `computeHrv5MinSeries` — **all three exclusively on the ring's IBI stream**.
`getRrForWindow`, which reads the strap's beats, is called from exactly two places: the comparison
harness and `compute-workout-hr.ts`.

So the strap's 136,440 beats produce **one number** — a workout's rest-window rMSSD — while three
richer models sit written, tested and pointed elsewhere. Because the strap is worn in waking hours
and the ring is weakest there, the models would produce *daytime* LF/HF, *daytime* breathing rate
and a *daytime* HRV series: signal the app does not have from any source today.

**The math is written. The data is stored. They are not connected.**

---

## ⚠ Correction: PS-44 cannot be validated on current data

PS-44 proposes computing **nightly** HRV from raw beat intervals, and says the raw ingredient is
*"already streaming into the app from a second device."* The ingredient is streaming; it is not
streaming at night. **242 beats across 6 nights, total.**

The entry's architectural claim stands — any future device exposing beat intervals could feed
nightly HRV identically, and that is the portability argument. What does not stand is the implied
validation path: you cannot check `rmssdFromRr(strap)` against the ring's nightly figure without
nights to check on. **Either the owner wears the strap to bed for a validation window, or PS-44
ships on the workout-window agreement alone and says so.**

This also corrects something said to the owner in session on 2026-09-15 — that nightly HRV could
come from the strap today with a pipeline change only. The pipeline change is real; the nightly
data is not there.

---

## The raw-frame seam: four tags stored, none consumed

`oura_raw_samples` keeps `body_hex` permanently, so a decoder added later back-fills everything.
Four stored tags never reach the rollup:

| tag | event | rows | decoder? |
|---|---|---:|---|
| `0x73` | `ehr_trace_event` | **2,988** (1,494 paired) | **none** |
| `0x6c` | `feature_session` | 2,708 | exists, unconsumed |
| `0x74` | `ehr_acm_intensity_event` | 648 | exists (u16 intensity), unconsumed |
| `0x6b` | `motion_period` | 390 | exists (2-bit levels), unconsumed |

`0x73` is the only one with real volume. Its two payload sizes (5 and 14 bytes) appear exactly
1,494 times each and their leading bytes run as one consecutive counter (`de, dd, dc, db…`), so
they interleave as a single stream — 1,494 episodes.

**Its byte layout was NOT inferred and must not be.** CLAUDE.md is explicit that layouts come from
the `open_oura` Rust source, which now lives only in the archived private repo. Decoding `0x73`
starts there, or not at all.

`0x6c` is diagnostics (which ring features are running) rather than a health metric. `0x6b` and
`0x74` are real signal but low volume.

---

## Two hypotheses tested and killed

**1. `ehr_*` is automatic workout detection.** It is not. Event counts per day against completed
sessions:

| day | ehr events | workouts |
|---|---:|---:|
| 2026-09-15 | 802 | **0** |
| 2026-09-11 | 764 | **0** |
| 2026-09-10 | 54 | 1 |
| 2026-09-13 | 117 | 1 |

The highest counts land on days with no workout at all. Whatever "elevated heart rate" means here,
it is not a training session.

**2. There are metrics computed but never surfaced.** There are not. Four modules looked dead on a
narrow grep — `tachogram`, `hr-recovery-by-exercise`, `progress-markers`, `hr-episode-detection` —
and **all four are consumed** once the search is widened. The health layer is roughly 85 modules and
they are wired. *Recorded because the narrow grep produced a false result first, and the same search
will produce it again.*

---

## What is genuinely not derivable, and why

Stated so it is not scoped as work later. **MET** has no independent implementation and no raw
supplier — it would be new modelling. **Skin temperature** is a hardware dependency with no second
source, which costs readiness's temperature term (0.10) and the illness radar's largest term (0.40).
Neither is a pipeline problem.
