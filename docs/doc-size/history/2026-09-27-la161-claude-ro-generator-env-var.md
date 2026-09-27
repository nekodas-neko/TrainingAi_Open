# CLAUDE.md +7 — the `claude_ro` generator's env var (LA-161, 2026-09-27)

`CLAUDE.md` documents the command that regenerates the `claude_ro` twin. That command was **wrong
in a way that fails silently**: the generator reads `LOCAL_DATABASE_URL`, and the documented line
named no database at all. Setting `DATABASE_URL` instead does not error — it generates against
whatever the session's dev database happens to be.

On this branch that produced a twin missing four columns that are still on `main`, because an
unmerged branch's `DROP COLUMN` had been applied to the dev database earlier in the session. It
would have shipped as a migration removing those columns from the views for real.

The growth is the corrected command plus a four-line warning. It stays in the index rather than
moving to a reference doc because **the command it corrects is in the index** — a reader who
follows the snippet there and never opens the reference doc is exactly the person who gets the
wrong output. The narrative is in the journal entry
(`docs/overview/entries/2026-09-27-la161-grid-dimensions.md`); only the operative warning is here.

The net number moved **down**, not up: a parallel compaction shrank `CLAUDE.md` between this
branch being cut and merging, so the recomputed baseline is 946 rather than the ~1068 this note
was first written against. The 7 lines below are still this branch's, and the baseline was
recomputed rather than spliced when the two raises conflicted.
