# 2026-09-15 — the owner cannot score 100, and the reason is not the design

**Tuning.** Docs-only. The owner asked for the base data a usable pillar system needs, for composite
metrics built from computed values, and for a scoring answer with one hard requirement attached:
*"as long as with my current metrics I have a way to get 100 on pillars I am happy."*

## The requirement is not met, and readiness is the reason

| pillar | best ever | mean | days | days ≥ 90 |
|---|---:|---:|---:|---:|
| Sleep | 97 | 73 | 63 | 19 |
| Activity | 91 | 73 | 50 | 1 |
| **Readiness** | **87** | 64 | 62 | **0** |

**`temperature` has never reached 100 in 62 days** — max 96, mean 76. It is scored *closer-better*,
with 100 sitting exactly at the personal baseline, so a miscentred baseline puts 100 out of reach
**by construction rather than by difficulty**. That is TN-6 and BF-13, both already queued: no new
work, just priority. `recoveryIndex` averaging 43 against a max of 100 is the second drag and is
explained by nothing queued.

`checkin` looked like a third and is not: the map runs `pumped → 100` and the owner has never logged
`pumped`. Honest self-report, filed as explicitly not a defect so nobody "fixes" it.

**Sleep needs no change.** The calibration maps a blend of 93 to a displayed 100 against a
theoretical max of 99.2, so the ceiling is steep rather than closed. `LATENCY` peaking at 90 and
`TIMING` at 95 are fine for the same reason — the calibration compensates, which is worth recording
because both look like bugs in isolation.

## The rule this produces

**Every contributor must be able to reach 100 on a genuinely excellent input, or the pillar's ceiling
is silently below 100** — and it breaks two ways: a curve whose maximum is below 100 (harmless if the
calibration compensates, so check that first), or a closer-better contributor whose baseline is
miscentred, which no calibration can rescue.

## Health Connect: the ring-only list is smaller than the docs say

The connector guide classifies skin temperature as having no second source. **Health Connect defines
`SkinTemperatureRecord`**, and `HeartRateVariabilityRmssdRecord` for HRV. It can carry every input
our pillars need except beat-to-beat intervals. We read 11 types and ten more exist that the pillars
would use, skin temperature being the largest gap.

Two defects found in `health-connect-sync.ts` while reading it, both landing on the Health-Connect
user specifically: the overnight HRV and SpO₂ windows filter on `d.getHours()` against the **device**
timezone, and a comment documents `hrvMs` as SDNN where the code reads rMSSD.

## Composites

Four, none already implemented. **Load vs readiness** (ACWR × readiness) is the one worth building
first — it is the question the deload engine is actually asking, and it works with no wearable at
all. **Sleep debt** needs duration alone. Autonomic balance and true sleep time need an HR source and
efficiency respectively.

## Not exercised

Docs-only; no code changed, nothing run on device. Score ceilings are computed from the live curves
and calibration in `sleep-score.ts`, and the achieved figures are the owner's own account through
`claude_ro`, row-scoped to one user — the "never reached 90" finding is about this account over 62
days and is not a claim about the pillar for anyone else. The Health Connect type list was read from
the vendor's current public documentation, not from the pinned plugin source, so **which of those
records the pinned `@devmaxime/capacitor-health-connect` build can actually request is unverified**
and must be checked against that source before TN-44 is built.
