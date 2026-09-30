# 2026-09-30 — OR-167 was answered "keep both", so it leaves the queue without code

**Branch:** `docs/or167-keep-both-icon-libraries` · docs-only, no version bump

`OR-167` proposed dropping `@phosphor-icons/react` and moving its five glyphs onto lucide. **The
owner answered on 2026-09-30: keep both — against the recommendation.** He declined to change icons
on screens he reads *mid-run* for a dependency saving, and the size numbers were put to him when he
decided, so the measurement is not a reason to re-ask.

That leaves nothing to build. Per CLAUDE.md — *"if it's superseded or already done, remove the
backlog entry via a docs-only PR with a one-line note on why, instead of forcing a mismatched
implementation just to clear the queue"* — it is removed rather than implemented.

## Re-verified before writing the note that outlives the entry

The entry's figures are from 2026-09-25 and still hold on `main`:

- `lucide-react` — **276** importing files (the entry said 270).
- `@phosphor-icons/react` — **six**: five under `components/activity/**` plus
  `packages/shared/src/constants/activity-icons.ts`.

## The consequence, written where it will be hit

The decision leaves a real gap the entry named itself: **two icon sets ship and nothing says which
to reach for.** A closed backlog entry is not where a future contributor looks, so that went into
[`docs/module-map.md`](../../module-map.md) — which exists to answer "what already exists and where"
before new work starts — as a row saying lucide is the default, phosphor is frozen to those six
files, and swapping one of the five is a **look change on a daily screen** needing a 384 px
before/after and his yes, not a cleanup.

If the two-set inconsistency ever becomes a real problem, that is a new entry about consistency, not
a re-run of this one.

## Verified

`check-backlog-pointers` **521 entries, OK** · `check-doc-index-size` OK. No code changed.
