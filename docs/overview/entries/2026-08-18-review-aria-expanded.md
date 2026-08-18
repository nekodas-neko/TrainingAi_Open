# 2026-08-18 — Review: the `aria-expanded` list, re-checked

**Agent:** Review 📖 · **Branch:** `claude/review-control-semantics` · **Docs-only.**
**Filed:** Q-491 · **Review:** [`docs/reviews/2026-08-18-aria-expanded-collapsibles.md`](../../reviews/2026-08-18-aria-expanded-collapsibles.md)

## Why

`CLAUDE.md` names nine chevron toggles lacking `aria-expanded`, re-counted 2026-08-09. A named list
with a date is checkable, which is the reason to write one. Nobody had re-checked it.

## Still 9, but not the same 9

`more/profile-tab.tsx` is **fixed** — 0 chevrons remain. `components/weights-summary.tsx` has the
defect and **was never on the list**. `deload-explanation` and `signal-sections` have **moved**, so
the paths in the rule are stale. The other six are unchanged.

`weights-summary.tsx` partially compensates with `aria-label={collapsed ? "Expand" : "Collapse"}`, so
state does reach a screen reader — just not through the attribute that also expresses the
control→region relationship.

## Q-491

Severity low and honestly so: no known screen-reader user. Filed because the stated direction is a
Play Store listing, where accessibility is a review surface, and because the recommended fix removes
a maintenance burden rather than adding one — prefer Radix `Collapsible` (which supplies both
attributes for free) plus a shrink-only Custom Rules count, over hand-adding nine attributes that
will drift again.

## The pattern is worth more than the finding

Third hand-maintained count in `CLAUDE.md` found stale this run — Q-480 (repo helpers described as
hardcoding a timezone they take as a parameter), Q-490 (*"both long-standing memos"* — there are 66),
and this one. **Every ratcheted count is current**: hex literals, TTL divergence, component size,
doc-index size, backlog pointers.

`CLAUDE.md` already drew this lesson for hex literals — *"recorded here as improving and it was not …
because this line was prose and nothing measured it"* — and it applies to its own prose. **A count in
prose is a claim with a decay date; a count in a script is a fact.**

## Not verified

Static analysis; **no screen-reader testing**. The claim is that the attribute is absent, not that an
announcement is wrong. Not on the APK, where TalkBack is the relevant reader. `coach-content.tsx` was
examined and excluded — its chevron is a back button.
