# 2026-09-28 — LA-65 becomes a Reference, and BF-197 is unparked

The owner answered LA-65: five exercises at two sets fill the hour, so the transition constant
stays as it is. He also wants to mix 2-set and 3-set exercises. The check LA-65 asked for,
whether anything forces a uniform set count, came back no. The budget stage (`expandToBudget`,
`fitToBudget` in `time-budget.ts`) sizes sets per exercise, one set at a time by role priority, so
a mixed session comes out of it naturally. `la65-mixed-set-counts.test.ts` pins that. LA-65 now
carries `Reference:` as its own text asked.

**This unparked BF-197.** Its `Needs:` line read "— nothing. Supersedes … `LA-65`", and the
parser takes an ID on that line as a dependency. Once LA-65 became a permanent Reference, that
would have parked BF-197 for good. The "supersedes" note now has its own bullet, and BF-197 lists
as READY.
