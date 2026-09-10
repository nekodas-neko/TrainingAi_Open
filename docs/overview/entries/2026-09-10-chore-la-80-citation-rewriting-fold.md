# 2026-09-10 — the journal's recent window can shed again: 345 entries → 60 (LA-80)

**Branch:** `chore/la-80-citation-rewriting-fold` · one new script, a fold, and the citations that
made the fold impossible before. No product code.

## The bind it removes

`docs/overview/entries/` was meant to be a readable *recent* window, and two rules made that
impossible together. The entries README said **do not fold an entry another doc links to** — right,
because a broken citation in someone else's handoff is worse than a long list. And **305 of 342
entries were cited**. So the only entries a sweep was permitted to fold were the **newest**, meaning
obeying a total ceiling required deleting the recent window to preserve the archive. It had blocked
two unrelated PRs in two days; earlier today I folded 20 entries from the previous 48 hours purely
because nothing older was eligible.

"Do not fold a linked entry" was never really a rule about folding. It was a workaround for having
no way to move the link.

## `scripts/fold-journal-entries.js`

Folds oldest-first into `history-<date>-folded-N.md`, rolling a new part at ~250 KB, and **repoints
every citation** at `#<entry-name>` anchors named after the entry's old filename — so a rewritten
link still reads recognisably, and the anchor does not depend on anyone's heading-slug rules.
`check-doc-links` resolves the file and ignores the fragment, so a wrong anchor would be invisible to
CI; determinism there is doing real work.

**345 → 60 entries.** `check-doc-links` clean on 810 files, `check-index-doc-paths` clean on 1,098
paths across 12 orientation docs, `pnpm check:rules` **Ran 73 of 73**.

## A sixth trap, which the README's five did not cover

The README documents five link-breaking traps from earlier hand sweeps. All five are handled in the
script. The first full run then failed on a **sixth**:

> A citation names the path **twice** — once as the target, once as the backticked link *text*.
> Rewriting only the target leaves the text naming a file that no longer exists.

**`check-doc-links` cannot see this** — it reads targets. It passes that gate and fails
`check-index-doc-paths` instead, which scans orientation docs for repo paths. Eighteen survived the
first run. The fold now rewrites the text to the bare entry name, and the README's list is six long
with the instruction to run *both* checkers, because either alone calls a broken fold clean.

## What it deliberately will not fold

**An entry an agent baton cites.** Rewriting would work, but it means this sweep writing into another
lane's live state file — which the README calls out, and which races whatever that lane is doing right
now. Batons are rewritten wholesale at handover anyway. Five entries held back; the script says so.

## The ceiling, and my own duplicate

`totalCeiling` went 361 → 600 → **150** in one day. 600 was this morning's stopgap, taken because the
gate was unsatisfiable by any sanctioned action. It is satisfiable now, so 150 is a real gate again —
about ten days of headroom at ~13.5 entries a day — and the rationale in `check-doc-index-size.js` is
rewritten to say why rather than leaving the number bare.

**OR-107, which I filed this morning, was a duplicate of LA-80** — filed two days earlier by Lane A,
with the same diagnosis and the same measurement. I filed it out of a conversation about a gate that
was blocking me, without grepping the queue for the symptom first. Whatever blocks you has usually
blocked someone else already. Both entries are removed: one shipped, one should never have existed.

## Not done

- The 60 remaining entries include 20 that are cited and 39 foldable; nothing needs folding again
  until the window grows.
- The five baton-pinned entries stay until those batons turn over.

**Surfaces not exercised:** none apply — docs and one script; no runtime code, no device path, no
schema.
