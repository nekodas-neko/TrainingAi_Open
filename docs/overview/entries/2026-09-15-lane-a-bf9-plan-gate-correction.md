# BF-9's plan quietly loosened a gate the owner set — corrected the same day

**Lane A · branch `lane-a/bf9-plan-gate-correction` · docs only.**

## What was wrong

[`2026-09-15-trainer-role.md`](../../superpowers/plans/2026-09-15-trainer-role.md) shipped in #1222
with a §7 that read:

> *"Ask the owner before merging PR 2 or PR 3 … PR 1 (the migration) is reversible and additive and
> does not need that gate."*

BF-9's backlog entry says the opposite, in words:

> *"Ask the owner before merging **any of it**. This is an auth/authorization change, which CLAUDE.md
> puts in the confirm-first carve-out, and unlike most entries the carve-out is the whole feature
> rather than one migration inside it."*

The plan read *"rather than one migration inside it"* as carving the migration out. It means the
gate is **wider** than the usual case, where only a migration inside a feature needs asking.

## Why this was worth a PR rather than a mental note

The consequence of acting on the wrong version is small — an empty `trainer_relationships` table on
production, dropped in one statement. The consequence of the *pattern* is not. The plan reached its
conclusion by **quoting the entry's own sentence and inverting it**, which is the most credible-looking
way to be wrong: a later reader sees the gate's own words cited and stops checking. A plan that
loosens an owner's stated gate using that gate's own language is how a decision stops binding without
anyone deciding to stop honouring it.

The underlying reasoning error is worth naming too, because it generalises. `CREATE TABLE` really is
additive and reversible, so it really is outside the **destructive** half of CLAUDE.md's carve-out.
But that carve-out lists three independent triggers — data-dropping or non-reversible migrations,
**auth/session/security changes**, and secret handling — and this feature is caught by the second one.
Arguing hard about the trigger that does not apply, and never reaching the one that does, produces a
confident answer to the wrong question.

## What changed

Nothing about the schema, the task split, or the copy-on-assign decision in §2 — only whether PR 1
may merge unasked. It may not. §4's "Reversible" bullet now says reversibility is not the only
trigger here, §7 states the correction and why it was made, and BF-9's entry carries a line so
anyone holding the pre-correction plan knows which version they have.

## Not done

No code, and no PR 1. The migration stays unbuilt until the owner gives the word on the feature.

## Failure surfaces NOT exercised

Docs only. `pnpm ci:local` green, **Ran 75 of 75 Custom Rules steps**.
