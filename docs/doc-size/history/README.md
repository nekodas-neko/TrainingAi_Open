# Doc-size baseline notes — one file per change

A baseline raise or ratchet-down carries a number and a reason. The number lives in
`docs/doc-size/<path>.size`; **the reason lives here, as its own file.**

## The convention

Name the file `YYYY-MM-DD-<branch-slug>.md`, the same shape
[`docs/overview/entries/`](../../overview/entries/README.md) uses. Write which document moved, from
what to what, and **why** — the arithmetic is recoverable from git and the reason is not.

## Why per-file rather than one shared document

`docs/doc-size-baseline-history.md` is 18,000 lines and every note was prepended to the same region
of it, which made it one of the three files that collide on every pair of concurrent PRs (LB-120
measured OR-118's #1333 taking six resolve-and-push cycles, the same three files each time). Two
agents writing two different notes have no genuine disagreement, so they should not be editing the
same line. A per-file note takes that collision to zero, exactly as it did for the session journal.

**The other two of those three files:** the backlog's own `.size` baseline is gone (LA-129 reports
the backlog rather than ratcheting it), and `docs/implementation-backlog.md` itself is irreducible —
two agents removing two finished entries is a real concurrent edit.

## The batched file stays

[`docs/doc-size-baseline-history.md`](../../doc-size-baseline-history.md) keeps every note written
before 2026-09-26 and is still the place to read history. A periodic compaction sweep folds these
per-change files into it, the same way the session journal is folded. Nothing reads either file: no
check parses them, so a missing note fails nothing — which is exactly why the convention has to be
written down rather than enforced.
