# Handoffs

One dated document per line of work, written when a cluster closes or a role changes hands. The
`handoff` skill (`.claude/skills/handoff/SKILL.md`) owns the template, the naming and the honesty
rules.

**`handoff-YYYY-MM-DD-<domain>-<descriptive-title>.md`** — `<domain>` is the primary pillar slug
from [`../domains/README.md`](../domains/README.md), and the title describes the *work*, not the
session.

## Finding one

The date and domain are in the filename on purpose:

```
ls docs/handoffs/handoff-*-sleep-*.md      # every sleep handoff
ls docs/handoffs/handoff-2026-09-*.md      # everything from September
```

A doc covering more than one pillar takes the primary slug in its filename and lists the others in
its header, which is what keeps that first command a complete answer.

## Why this directory exists

Handoffs lived loose in `docs/` until 2026-09-27 (OR-190), by which point **68 of the 118 files at
that level were dated handoffs** — the root read as session artefacts with 50 reference docs mixed
in. The move was mechanical and rewrote 235 links and 246 bare path mentions; `check-doc-links` and
`check-index-doc-paths` both verify it.

**One line of work gets ONE handoff file.** Update it rather than adding a second — that rule
predates this directory and is the reason the list stays navigable.
