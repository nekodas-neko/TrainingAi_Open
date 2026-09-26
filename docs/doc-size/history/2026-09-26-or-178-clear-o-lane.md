# 2026-09-26 — `CLAUDE.md` 1054 → 1056

**Branch:** `chore/or-178-clear-o-lane`

Two lines, both definitional rather than narrative:

- **`Lane: T`**, Tuning's lane, added in the same PR (OR-178). The lane list in `CLAUDE.md` is the
  one place every agent reads before writing a `Lane:` field, so a fifth value that is not listed
  there is a value nobody uses. Compressed twice before raising — the first draft was five lines.
- **The doc-size note convention** (LB-130): a baseline raise now writes its reason to its own file
  under `docs/doc-size/history/`, which is what this file is. One line, in the paragraph that
  already covers the `.size` split.

**This is the first note written under the new convention**, which is the other reason to keep it:
the paragraph it documents would otherwise describe a directory holding nothing.
