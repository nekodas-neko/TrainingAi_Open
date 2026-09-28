# 2026-09-29 — `next-item.js` no longer lists work that already has an open PR as READY

**Lane A · tooling.**

- **Why:** on 2026-09-28/29 a Lane A session rebuilt five security fixes (RV-190, 191, 192, 193,
  197) and most of two more (RV-195, RV-196), all of which already had open PRs from earlier Lane A
  sessions. A queue entry stays in the file while its PR waits on the owner, and READY ("nobody has
  started it") could not see a PR, so every one of them was offered as startable work. The
  duplicates are named on RV-221; the two genuine additions went into #1930 and #1755.
- **Change:** `scripts/lib/open-prs.js` reads open PRs with `gh`. It matches an entry's id in a PR
  title, or in a branch name where ids are lower-cased and de-hyphenated (`rv190`). A number can
  never claim a longer one (`RV-19` ≠ `RV-190`). Matched entries leave READY and print under
  **IN FLIGHT** with their PR numbers. The first real run found **12** in Lane A.
- **Off switches:** `--no-prs` or `NEXT_ITEM_NO_PRS=1`. It is also always off under Vitest and CI.
  When `gh` cannot answer, the tool says so on one line rather than implying nothing is in flight.
- **Tests:** `next-item-open-prs.test.ts`, covering title and branch matches and the prefix
  boundary. The scripts suite passes: 47 files, 450 tests.
