# 2026-09-28 — `docs/agents/state/implementation-lane-b.md` baseline raised

**Branch:** `fix/stress-bucket-fixture-rename` · **Lane B** · one baseline, the Lane B baton.

## Why it grew

One lesson added, and it is the kind the baton exists to carry — a habit that changed, not a fact
that will go stale:

> **Read the CI log of the PR you already merged — auto-merge fires on the five required checks and
> E2E is not one of them.**

`LA-176` (#1893) merged with the advisory E2E job still running. Going back to read that job
afterwards is what found this PR's bug: two E2E specs still `INSERT` the column `LA-114` renamed
(`bucket_start` → `bucket_mid`) the same day, so they died in `beforeAll` on every run. An advisory
check nobody reads is a check the repo does not have, and the lesson is the reading habit rather than
the column.

Its second half is the one worth the lines: **establish each failure's MODE before filing a census
row.** Those two specs failed deterministically; counted as flake they would have inflated `LB-178`'s
rate by 40% and aimed that investigation at test ordering, which is the one place the bug was not.

## Not folded

Nothing was removed to make room. The two other batons the checker looked at
(`device-verification.md`, `review.md`) were left alone inside their 25-line slack bands, per LA-129 —
that is what keeps concurrent PRs off one another's `.size` files.
