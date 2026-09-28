# 2026-09-28 — BF-214 ②: migrations order by number, and new ones are named by the minute

Both appliers sorted migration filenames as strings. `ensureSchema` and `migrate.js` now sort by the
leading integer, with ties broken by filename (`sortMigrationFiles`). Every existing prefix is three
digits, so the order production applied is unchanged; a test asserts this against the real
directory. Once the sort was numeric, the prefix could stop being a shared counter.
`next-schema-number.js` now hands out a UTC minute, `YYYYMMDDHHMM`. If a claim already holds that
minute, it hands out the next one instead. A branch can sit open for days and its prefix stays
valid. Only two migrations written in the same minute collide, and `check-migration-numbers.js`
still catches that case.

`migrate.js` now exports the sorter and runs `main()` only when executed directly. That lets one
test hold both copies to a single order. Mutation pass: 6 of 6 killed, control green. One mutant
(local time in place of UTC) only bites where the machine's zone is not UTC, which is true here and
in production but not on CI's runner. The CI replay is clean.

What is left is a reply on issue #1620, a public comment. BF-214 stays in `O` as a Keep line with a
draft.
