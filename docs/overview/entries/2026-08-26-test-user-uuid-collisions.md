# 2026-08-26 — the shared test-user UUID, and why the obvious check would have been deleted (LA-32)

**Branch:** `fix/test-user-uuid-collisions` · **Lane A** · no migration, no APK.

Three times on 2026-08-25/26, **adding an unrelated test file turned the suite red in a file the PR
never touched**. Vitest runs test files in parallel workers against one shared local Postgres, so if
file A hardcodes a user UUID as its only test user and file B hardcodes the same one as an
incidental "other user" it deletes in cleanup, B's delete can land between A's seed and its first
query. A dies on a foreign key, naming a table nobody edited — and it stays hidden for exactly as
long as scheduling keeps the two apart.

## The count in my own entry was wrong, and finding that out was the work

LA-32 was filed with a survey saying **7 risky, 2 fixed, 6 remaining**. Re-measuring against current
`main` before touching anything — the habit that has now paid on eight consecutive entries — found
**one** real collision. Five of the six were false positives:

| UUID | verdict |
|---|---|
| `…00cf01` / `…00cf02` | **REAL.** `clear-program-prescriptions` and `coach-domains` both INSERT *and* DELETE both ids, with **different hardcoded emails** — so they race on `users_email_unique` as well as the foreign key. |
| `…00d011` | **False.** It is a *program* id in `coach-options-source`, which deletes entirely different users. |
| `fe481797…` | **False.** It is the canonical `claude_ro` owner id, which those files are *supposed* to agree on. Nothing deletes it as a user. |
| `1111…4111…`, `…0000ff` | **False.** Pure-logic files that never touch the `users` table. |

The filing's rule was "shares a UUID literal, and some holder mentions `DELETE FROM users`". That is
not the same claim as "shares a *user id* that someone deletes", and the gap was 83% noise.

## Why that ratio decided the shape of the fix

**A check that is 83% false positives is one the first person it stops will baseline into
uselessness.** So the detection is narrow: the UUID must reach an `INSERT INTO users` /
`DELETE FROM users` statement — directly, or through a `const` named inside it — in two or more
files, with at least one deleting it. `scripts/check-test-user-uuid-collisions.js`, in the Custom
Rules job (**Ran 59 of 59**, up from 58), **baseline empty** so the next collision is a regression.

**Getting that narrowness right took three attempts, and the first two shipped bugs the tests now
pin.** A fixed 400-character tail after the SQL keyword swallowed the *following* statement — that
is how `fe481797` was reported, from an unrelated `ALTER ROLE … claude_ro_owner = '<uuid>'` on the
next line. Breaking instead at "a line ending in `)`" stopped **inside** the SQL, which ends lines
with `)` constantly (`… VALUES ($1, $2, 'x', 'T')`), so no parameters were seen at all. Tracking
string parity fails for a third reason: a match starting at the SQL keyword starts *mid-literal*
with no way to know which delimiter opened it. What works is scanning the whole `query(...)` call
with balanced parens — the parameter array is inside it by construction and the next statement is
outside it by construction.

## Verified

- **Seven detection tests, five of them false-positive cases**, because those are what the check
  lives or dies on. Mutation-checked with proof each edit applied: restoring the 400-char tail fails
  the after-the-delete case; dropping the users-table requirement fails the program-id case.
- **The real collision fixed** — `coach-domains`'s `OWNER3`/`OWNER4` moved to `…cfa1`/`…cfa2` with
  **emails derived from the id**, so a stale hardcoded address can never outlive a rename. Both files
  run green together (33 tests), which is the pair that could not before.
- **Full suite 600 files / 4,908 tests green** — exactly +7. `tsc --noEmit` clean ·
  `pnpm check:rules` **Ran 59 of 59** · `check-backlog-pointers` OK at 205 entries.

## Not exercised

No migration, no APK, no runtime code — test fixtures and a CI script. The check's known blind spot
is a user id passed through a helper the scan cannot follow, which reads as unused. That is
deliberate under-reach: a false negative costs a flake, a false positive costs the check.
