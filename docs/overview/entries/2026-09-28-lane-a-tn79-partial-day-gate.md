# 2026-09-28 — TN-79: the training-load gate only ever judged an unfinished day

LA-161's diagnostic columns got their first value on 09-28: grid 471, valid 343, written at 08:46
Brisbane. That is a partial day, since about 526 minutes had passed, and the MET floor is 720. The
route re-persists on every call and is only asked about today, so each day's stored
`insufficient_met` is the verdict of the last evaluation made during that day. Nothing evaluates a
finished day. The earlier replay that "cleared both floors" read days after they had ended, which
is where TN-79's contradiction came from.

The two `scorer_no_output` days (09-25, 09-26) can only be reached with both floors clear, so the
09-24 NaN-validator root cause is live again. The sandbox test that set it aside ran without the
model constants and could not have shown anything.

Filed LA-170 for the buildable half (evaluate a day after it ends). It needs an evaluated-at
column, so it waits behind BF-214's migration numbering. Still to confirm: one evening read
showing a grid ≥ 720 on the same day.
