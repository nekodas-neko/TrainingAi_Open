## 2026-09-08 — The journal-entry ceiling stopped every lane, so the fold ran (compaction chore)

**Branch:** `chore/fold-journal-entries` · **Lane A** (see the note on ownership below)

### Why this ran now, and why it is not a ceiling raise

`docs/overview/entries/` hit the **320-entry ceiling**. That is not one PR's problem: the check fails
on the *directory*, so the next journal entry from **any** lane fails CI, and every session is
required to write one. It was blocking a PS-39 test PR when it surfaced; it would have blocked the
next thing anyone merged.

**The ceiling was not raised.** It went 250 → 320 once already (#788), and the Lane A baton records
the condition for doing it again: only if the floor rises from something *other* than journal
citations. It does not — 291 of 320 entries are cited by `projectOverview.md`, a domain index, a
handoff or another lane's baton, so citations are exactly what the floor is made of. Raising the
number again would have bought a few days and made the real work larger.

### What was folded

**29 entries — the unlinked ones only — into `docs/overview/history-2026-09-08.md`**, oldest-first,
and `git rm`'d. 320 → **291**, under the ceiling. A new history file rather than an append:
`history-newest.md` is 341 KB and is a *closed* batch (Sessions ~209–216), and the README's rule is
to start a new one past ~250 KB. The new file is 128 KB.

**Anything another document links to stayed loose.** That is the sweep's first documented trap: an
earlier attempt folded all 61 loose entries and broke 48 links, several inside another lane's baton.
`grep -rl <filename> --include='*.md' .` decides it, not judgement.

One link needed rewriting, and it is trap 3's exact shape: `2026-09-07-planner-trailing-rest.md` is
folded and links to `2026-09-07-transition-clock-semantics.md`, which stays loose — so the link takes
an `entries/` prefix rather than pointing into the history file.

### Verification

- `node scripts/check-doc-links.js` — **OK, 1031 files**, clean on the first pass.
- Trap 4 checked from the other direction too: no still-loose entry cites a folded one.
- `pnpm check:rules` — **Ran 70 of 70**. `check-doc-index-size` passes at 291.
- `projectOverview.md` gains one Document Map row (10418 → 10419), because a history file nobody can
  find from the map is one nobody reads.

### On ownership, and what is still owed

**The compaction chore is Orchestrator's**, per `docs/agents/README.md` and the Lane A baton, and this
took the mechanical half of it because the ceiling had stopped the line. What is left is the half
that actually removes the pressure and is *not* mechanical: **291 entries are unfoldable only because
durable docs cite them by path.** Until those citations point at batched history instead, every sweep
can only reclaim the handful of entries nobody happened to link, and the ceiling returns within days.
That repointing is a judgement call across `projectOverview.md`, the domain indexes and four batons —
Orchestrator's, and still owed.

No version bump: docs only.
