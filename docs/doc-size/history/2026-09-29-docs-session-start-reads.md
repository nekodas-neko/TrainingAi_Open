# 2026-09-29 · `docs/session-start-reads-2026-09-29`

**`docs/agents/state/orchestrator.md` 119 → 126 (+7).**

Adds a **Session-start reads** section recording when the three production reads were last taken
and what each returned.

It belongs in the baton because the reads are a per-session obligation and the baton is what the
next session reads to find out what is already done. Without a date here, the next Orchestrator
either repeats all three or skips them on the assumption someone else did — and `error_events`
prunes at 30 days, so a skipped read loses faults permanently rather than deferring them.

Four lines of it are the results themselves, kept because the interesting part of each read is the
comparison with last time, and a bare "done" gives the next session nothing to compare against.
