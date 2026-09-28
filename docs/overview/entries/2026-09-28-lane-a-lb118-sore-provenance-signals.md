# 2026-09-28 — LB-118: the explain page can tell a suggested sore tick from a chosen one

The next-session `signals` block, which the "Why this?" page renders, carried the check-in's
`soreMuscles` without the provenance the scorer was fed twenty lines above it. It now carries
`suggestedSoreMuscles` from the same mood log, `null` when the check-in predates provenance. That is
what LB-117 (Lane B) needed. Fetching `/api/mood` separately on the page was the wrong answer: it
could be a different check-in from the one behind a cached recommendation. The type field is
optional, so a stored payload from before this still parses. The DB test covers both the value
and the null, and removing the field fails both cases.
