# 2026-08-26 — the evening digest can now see what the morning said (Q-291)

**Branch:** `fix/ai-surface-shared-state` · **Lane A** · no migration, no APK.

On 2026-08-06 the readiness insight read a temperature 0.8 °C above baseline and told the owner
*"Keep your planned exercise intensity low."* He trained twice. That evening the digest said
*"Crushing three PRs… **keep that same energy tomorrow!**"* Readiness then fell 79 → 76 → 76 → 65
across 08-05…08-08, so the morning was arguably right and the evening encouraged a repeat of what
degraded it.

Neither surface was wrong about its own data. Each builds its own prompt from its own slice, and
**none could see what another had already told the user that day.**

## The entry's own open question, answered first

Q-291 said to check *"whether the digest has any access to the day's readiness advisory at all, or
only to the outcome numbers — that determines whether this is a prompt change or a data-plumbing
change."*

It has **neither**. `app/api/daily-digest/route.ts` reads nine sources — sessions, PRs, program, food
logs, nutrition targets, morning check-in, goals, body metrics, exercise library — and not the
readiness score, let alone the insight. So: data plumbing.

## What shipped

- **`listAiHealthInsightsForDate(userId, date)`** on the repository — the day's rows, ordered by
  section.
- **`lib/ai/same-day-context.ts`** — `readSameDayInsights()` formats them for a prompt, and
  `SAME_DAY_GUIDANCE` is the instruction that pairs with it.
- **The digest reads it**, and pushes the block into `lines` **before** the context is hashed.

## Two decisions worth not re-litigating

**The read graph is one-directional, and that is a correctness requirement rather than a
simplification.** The digest reads the four health-insight sections; those read nothing. Every
surface caches on a hash of its prompt context, and anything the model sees must be inside that hash
or the cache serves an insight built from a context it no longer matches. So if A's hash covered B's
text *and* B's covered A's, regenerating either would invalidate the other, whose new text would
invalidate the first — and model output is not deterministic, so **it never settles**. A cycle in the
read graph is a regeneration loop that bills per iteration. The digest's own section
(`'daily-digest'`) is excluded from `SHARED_SECTIONS`, so it structurally cannot read itself, and
there is a test for that at both the helper and route level.

**The instruction permits disagreement.** It forbids contradicting *silently*, not contradicting. The
evening surface knows things the morning one did not; an instruction never to contradict would make
it endorse advice the day has since disproved. A test asserts the permissive wording, so a later
tightening to "never contradict" fails rather than passes quietly.

## Verified

- **Full suite green — 598 files, 4,894 tests**, against 4,879 on clean `origin/main`: exactly
  the 15 added here. `tsc --noEmit` clean · `pnpm check:rules` **Ran 58 of 58** · lint 0 errors.
- **Every new test is mutation-checked, with proof the mutation applied** — a `sed` whose anchor has
  drifted silently mutates nothing and reports a pass, which is how a vacuous test certifies itself.
  Helper: dropping the empty-string return, admitting `'daily-digest'` to the shared sections,
  dropping the trim, reversing the order — four mutations, each failing exactly the test that covers
  it. Route: appending the block *after* the hash instead of inside it fails the cache test;
  removing the guidance fails the prompt test. Adapter: dropping the `user_id` scope fails all four
  scoping tests.
- **One of my own tests was vacuous and is fixed.** The ordering assertion passed against an adapter
  with **no `ORDER BY` at all** — Postgres happened to return these rows alphabetically. Inserting
  out of order is not enough; the seed now **updates** the row that sorts first, because Postgres
  writes a new tuple at the end of the heap rather than in place, which moves it physically last.
  With that, removing the `ORDER BY` fails. Ordering matters here because the text feeds a context
  hash: an unstable row order regenerates an unchanged digest.

## A latent test collision that this PR surfaced, and fixes

Adding one test file turned the suite red **in a file neither this change nor any recent one
touches** — `daily-summary-incremental.test.ts`, failing on
`oura_daily_summary_user_id_fkey`: its user was gone at insert time.

Clean `origin/main` passed the full suite, so "pre-existing flake" was not available as an
explanation and the failure had to be traced. It is a **shared test-user UUID**:
`...05e3` is `daily-summary-incremental`'s only test user, and it is also
`daytime-stress-buckets.test.ts`'s incidental `OTHER_USER_ID`, which that file **deletes** in
cleanup. Vitest runs files in parallel workers against one shared local database, so that delete can
land between the other file's `beforeAll` insert and its first query. It stayed hidden for as long as
scheduling kept the two apart — **adding an unrelated test file is enough to change that**.

The incidental id is now `...05f3`, with a comment saying why it must not be `...05e3`. The suite
went 4,879 → **4,894** tests, which is exactly the 15 added here, so nothing else moved.

## The dead-method check I shipped this morning was wrong, in the way that gets a check deleted

`check-dead-repo-methods.js` (LA-26, merged hours earlier) failed this PR, reporting
`listAiHealthInsightsForDate` as called by nothing. It has a caller —
`lib/ai/same-day-context.ts:45` — in a file that was **untracked**, and the check built its file list
from `git ls-files`.

So the guard's false positive lands on exactly the workflow it exists to support: **add a repository
method and its first caller in one change.** By my own argument for BF-20's root-module guard, a
check that fails on correct code is one the next person deletes. The list is now
`git ls-files --cached --others --exclude-standard` — tracked plus untracked, minus gitignored — and
`scripts/__tests__/dead-repo-methods.test.ts` gained a case that writes a probe file and asserts it
is seen. Reverting to `git ls-files` fails that case and nothing else.

Worth stating plainly: this was found by the check firing on correct work, not by review. A guard's
first false positive is the most informative thing it produces.

## A trap that cost a debugging round

**A `beforeAll` that throws is reported by vitest as SKIPPED tests**, which reads exactly like a
`describe.skipIf` guard firing — and this file has such a guard, so "4 skipped" looked like
`DATABASE_URL` being unset. It was a `users_email_unique` violation: I changed the test users' UUIDs
without changing their hard-coded emails, so `ON CONFLICT (id) DO NOTHING` did not fire and the old
rows still owned the addresses. The seed now derives the email **from the id**, so the two cannot
drift. Run a suspicious skip with `--reporter=verbose` before believing the guard.

## Not exercised

- **The model's actual behaviour.** That the instruction *reaches* the prompt is tested; whether
  Gemini honours it is not, and cannot be from a deterministic test. The failure mode if it ignores
  the instruction is the status quo, not something worse.
- **Production.** No migration, so this ships on the next Railway deploy. **No APK needed** — server
  and JS only.
- Nothing native, offline-first, safe-area or gesture-related, so **no device smoke run is owed**.
