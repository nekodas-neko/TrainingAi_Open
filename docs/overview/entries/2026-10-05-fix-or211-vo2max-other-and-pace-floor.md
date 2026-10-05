# 2026-10-05 — OR-211: a profiled `sex:'other'` user stays on Burr, and best pace has a distance floor

**Branch:** `fix/or211-vo2max-other-and-pace-floor` · **Lane A** · no schema. `PS-36` (c), the Z3 mapping, is untouched:
it is Tuning's, with the owner's sign-off.

## (a) VO2max

`sixMwtVo2max` coded sex as female 1, male 0, **anything else null**, and null sent the user to the
Ross last-resort equation, which is documented as being for *missing* terms. So a user who had stated
`other` read **18.7 for inputs that give 42.7** on Burr. It now codes `other` as the midpoint, **0.5**
(`BURR_SEX_CODE_OTHER`): a profiled user stays on the real equation, with an error bounded at half the
sex term, about ±3.4 mL/kg/min, and nobody is silently classified. **A structural call, recorded:** the
alternative is `vo2max.ts`'s Jackson convention (everything but male codes as female), simpler but always
wrong in one direction by the full 6.79. `other` with a genuinely missing term still falls to Ross. The
owner is male and unaffected.

## (b) best pace

`computeRunningBests` took `min(avgPaceSecPerKm)` over every run, so a 30 m GPS false start became the
all-time best. A run now needs **at least 1 km** (`BEST_PACE_MIN_DISTANCE_KM`, the smallest of the windows
the 1k/5k bests already use), and a run with no recorded distance cannot show it cleared that, so it does
not count. **Measured on his production runs first: 8 runs, best 6:25/km both with and without the floor,
none short**, so the card does not change for him.

## Verified

`fitness-tests.test.ts` (other sits between male and female and is nowhere near Ross; other with a
missing term still reads Ross) and `or211-best-pace-floor.test.ts` (fragment ignored, exactly 1 km counts,
no-distance excluded, null when nothing qualifies, other bests untouched). Health suites: 1,101 passed. tsc
clean.

## Not exercised

The running-bests card on a device. It is a server route over a pure function, so nothing native is involved.
