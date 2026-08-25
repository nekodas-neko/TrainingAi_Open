# 2026-08-26 — "moved this hour" measures whether the ring was recording, not whether you moved

*Tuning · docs-only · branch `tuning/battery-anchor-ceiling`*

Owner: *"how are move hours being tracked? I don't see a dash/notification for it at all… I'd like to
see something for it to make sure there is movement every hour. Also need to make sure it doesn't
count sleep time."*

**The mechanism.** An hour in `[wakeHour, sleepHour)` counts as *moved* when **at least one HR
reading that hour** clears `HR_REST_THRESHOLD` (0.05 of reserve). For the owner that boundary is
**57.8 bpm**, and only **1.57% of waking time** sits below it — so requiring one sample in sixty
minutes to clear it is the weakest test available. Measured over 45 days and **657 waking hours
holding data: 99.8% qualify.** With 14.6 of the 15 window-hours carrying data on a typical day, the
numerator is effectively "hours the ring recorded anything".

**This answers the open half of Q-522.** That entry recorded moveHours pinned at 100 on 48 of 59 days
and attributed the numerator's saturation to "an unrelated reason" after Q-188 fixed the denominator.
The reason is the boundary and the single-sample test.

**TN-2 does not fix it, and the two must not be merged.** Both read `HR_REST_THRESHOLD`, but Body
Battery needs *resting vs not* and this needs *sedentary vs moving*. At TN-2's most generous proposed
offset move-hours still qualifies **97.6%** of hours. Raising the shared constant far enough to fix
this would break the charge window in the other direction. Filed as **TN-11** with its own test —
sustained elevation or hourly steps, not a single touch of a resting boundary.

**Sleep is not counted**, by two independent guards: the `[7, 22)` window, and overnight HR (~50–55)
running below the 57.8 bar. But the window is **hardcoded** — `computeMovedHours` accepts
`wakeHour`/`sleepHour` and `readiness-payload.ts:324` never passes them — so the owner's 6 am wake
loses an hour of real waking time from both numerator and denominator. The night's real window is
already in `sleep_sessions`.

**On the missing surface:** there is exactly one, `app/health/activity/activity-content.tsx:64`, two
taps deep on Health → Activity, inside a block that only renders when zone-minutes or move-hours are
non-null. No nudge, no notification, no hourly breakdown. Filed as **TN-12** (Lane B) — deliberately
`Needs: TN-11`, because a nudge on a metric that qualifies 99.8% of hours would never fire and an
hourly strip would show a full row every day regardless of what the owner did. The entry also records
that a *notification* is not a small addition: there is **no cron layer** (`docs/module-map.md` §0),
so scheduling it is its own problem and its own entry.

**Not exercised:** no code ran — SQL against production plus source reading.
