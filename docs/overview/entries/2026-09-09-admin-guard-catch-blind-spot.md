# 2026-09-09 — the guard that could not see its own class (PS-39, 27 → 24)

**Branch:** `test/admin-feedback-invite-routes` · **Product change**, version 1.441.4.

10 cases over `admin/feedback`, `admin/feedback/[id]` and `admin/invites` — and, reached through
them, a much larger finding.

## The finding: a CI check named the defect and could not see it

`scripts/check-admin-guard-catch.js` exists for Q-548 — "an admin check that cannot run is not a
refusal" — and has been passing **70 of 70** in every run this session. [#1017](https://github.com/nekodas-neko/TrainingAi_Open/pull/1017) fixed two
routes of that class by hand. Writing this batch turned up two more, which prompted a proper sibling
sweep, which found **twelve live sites** the check was reporting clean.

Its detector was a single regex requiring the try's closing brace on the line immediately after the
call. Two ordinary shapes slip through it, and between them they covered every remaining offender:

1. **A trailing semicolon.** `await requireAdmin(a, b);` puts a `;` between `)` and the newline,
   which `\s*` does not cross. Purely stylistic, and it silently disabled the check for nine sites
   across four routes.
2. **A try holding the real work as well.** `admin/errors`, `admin/feedback`, `admin/feedback/[id]`
   and `admin/users` wrapped the repository read too, so the catch flattened a failed **query** into
   403 — the more dangerous shape, and invisible to a pattern insisting the brace comes next.

Measured, not argued: against a probe carrying both shapes the old regex matched **0 of 2**, and the
rewritten detector run over unfixed `origin/main` reports all **12** sites.

The old header claimed "the sweep that introduced this check cleared all 46, so the correct baseline
is zero". That was true only of the 46 the regex could see. **A check that cannot see most of its
class is worse than none, because the green tick is read as evidence** — it is what let me write
"Custom Rules 70 of 70" under a PR that fixed two of twelve.

## What shipped

- The detector now **brace-matches the enclosing `try`** instead of pattern-matching its shape, so
  spacing, semicolons and block contents are irrelevant.
- `scripts/__tests__/admin-guard-catch.test.ts` pins both blind spots plus the bind-but-ignore shape
  and the legitimate non-`requireAdmin` swallow (`db-snapshot`'s audit-log write, which must stay
  allowed or the check trains people to ignore it).
- All **12 sites** fixed across `exercises`, `feedback`, `feedback/[id]`, `generate-exercise-media`,
  `mirror-dataset-gifs`, `reference-figure` and `users`. Where the try also held the work, the work
  moved out of it.
- **`admin/invites` DELETE now normalises the email**, as POST already did. `removeInvite` is an
  exact-match delete on the stored (lowercased, trimmed) value, so revoking `Foo@Bar.COM ` matched
  nothing and still answered `{ ok: true }` — a revoked invite that was never revoked.

## The tests

The invite fixture is deliberately mixed-case with surrounding whitespace: an already-clean address
makes the normalising and non-normalising versions identical, which is how DELETE came to be missing
it in the first place. A malformed feedback id now answers **400 rather than 403**, since the old
catch swallowed the UUID guard too.

## Mutation pass

**11 of 12 caught**; the survivor is an equivalent mutant planted as a control.

## One thing seen and not explained

A full-suite run failed once with `error: deadlock detected` in an unrelated DB test's cleanup
(`user-stats-soft-delete`). The file passes 3 of 3 in isolation and the next full run was green, and
nothing in this diff touches `lib/data/**`. Filed as **LA-86** rather than called a flake: every DB
file uses its own test user, so a deadlock points at lock ORDERING between parallel files, which is
a different class from the statement-timeout contention already fixed and would read as a spurious
red PR in CI.

## Not exercised

The repository is mocked — no database, so the 503 path is proven by making the admin lookup reject
rather than by a real outage. The nine sites in `exercises`, `generate-exercise-media`,
`mirror-dataset-gifs` and `reference-figure` are **not** covered by a route test; what holds them is
the rewritten check plus its own self-test. Web/Node only: no device, no native surface.
