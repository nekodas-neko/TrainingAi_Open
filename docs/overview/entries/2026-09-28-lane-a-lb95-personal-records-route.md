# 2026-09-28 — LB-95: a route that reads personal records with their dates

`personal_records` had no read that kept the date: `listPersonalRecords` returns a name → 1RM map,
and `/api/weights-summary` reports only the active program's exercises. BF-133's detail section
requires every value to carry the date it was read, so neither source could feed it.

`GET /api/personal-records` returns the caller's records for every exercise, newest first, each
with `achievedAt`. It reads through a new `listPersonalRecordsDated` placed beside the old map
read, whose 10 call sites keep their shape. The route test (real Postgres) pins the order, the
dates, and that another user's record never appears; mutating the user filter or the order fails it.

Not exercised: a signed-in `pnpm dev` call. The test drives the real handler against the database,
with only the session mocked. LB-95 is re-laned to B for the More-screen group.
