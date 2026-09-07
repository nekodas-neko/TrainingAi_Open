## 2026-09-07 — Zod's own phrasing no longer reaches the user, and the obvious fix for that was wrong (LA-70)

**Branch:** `fix/zod-error-wording` · **Lane A**

### What shipped

`invalidBodyResponse(error, fallback?)` in `lib/api/route-errors.ts`, applied to all **19** sites
across **18 routes** that answered `{ error: parsed.error.issues[0]?.message ?? 'Invalid body' }`.
Live, that put the library's phrasing on screen: *"Too big: expected string to have <=80
characters"*.

### The entry's proposed fix would have silently dropped messages

LA-70 said to surface `issue.code === 'custom'` only. That is the natural reading — `custom` is what
`.refine`/`.superRefine` produce, and BF-129's equipment error is exactly the kind of message worth
keeping. **Measured against zod 4.4.3 before implementing it, it is wrong:**

| schema | `issue.code` | `issue.message` |
|---|---|---|
| `z.string().min(1, 'Name is required')` | **`too_small`** | `"Name is required"` |
| `z.string().min(1)` | `too_small` | `"Too small: expected string to have >=1 characters"` |
| `.refine(…, { message: 'Must be q' })` | `custom` | `"Must be q"` |

A hand-written message on a **built-in** check keeps the built-in code. Filtering on `custom` shows
the third row and throws away the first — a message someone wrote for the user, discarded, with
nothing to notice it.

So the discriminator is not the code, it is **whose words these are**: the helper renders what zod's
own error map would say for that issue and surfaces the message only when it differs. Two carve-outs,
both failing toward the generic string:

- **`invalid_type` and `unrecognized_keys` are never surfaced.** They describe the request's *shape*
  — a number arriving as a string, a key the schema does not know — which is never something a user
  chose. `invalid_type` also cannot be compared: the issue reaching a caller has lost its `input`, so
  the default map re-renders it as "received undefined" and every one would read as hand-written.
- **Anything that throws falls back.** `z.core.locales` is not part of zod's documented surface, so
  if a future version moves it the answer must be a generic message, never a leaked internal.

### What the sweep found

**None of the 19 sites had a message to preserve** — no `.refine`, no `.superRefine`, and no
message argument on any built-in check across all 18 files. So today the change is purely
subtractive; the preservation logic is for the schema someone writes next, and it is tested rather
than asserted.

Two stale quotes fixed while here: `push-coercion-visibility.test.ts` and `adapter.ts` both
documented Q-485 by quoting `{"error":"Too big: expected number to be <=500"}` from
`POST /api/body-metadata` — a route in this sweep, so that string no longer exists. Both are comments,
not assertions, and Q-485's substance (400 vs 200) is unchanged.

Two sites deliberately **not** changed: `app-load` logs the message to the console rather than
returning it (nobody reads it but us), and `sync/push` has a different shape and reports per-mutation
errors.

### I merged three PRs with Build red, and this PR is what caught it

**#935, #936 and #937 all merged with the `Build` job failing.** This PR's Build failed on
`check-test-typecheck.js`, and the two files it named — `ingest-routes-fail-closed.test.ts` (#935)
and `home-aggregate-routes.test.ts` (#936) — are mine, so `main` had a red Build for roughly 45
minutes before anything noticed.

**Two mistakes, and the second is the one worth fixing.**

*The gate I ran was incomplete.* I ran `npx tsc --noEmit`, which uses the app's tsconfig. The test
files are checked separately under `tsconfig.tests.json`, by a script that runs **inside the Build
job**, and I never ran either. The errors were real: `vi.fn(async () => …)` infers a zero-parameter
signature, so `mock.calls[0]` is typed `[]` and every cast off it is an error. Fixed by declaring the
mocks' parameters and deleting the casts — the tests are unchanged in behaviour and still pass.

*I merged on an incomplete reading of CI.* On all three I saw Build still `in_progress` and merged
anyway, on CLAUDE.md's guidance that "the reliable green check is attempting the merge", since
branch protection refuses a pending required check. **It did not refuse — so `Build` is evidently
not enforced as a required status check on this repository, whatever the documented list says.**
That guidance is written for a *stale read* of a check that has actually finished; I used it to
skip waiting for one that genuinely had not, which is not the same thing and is not what it says.

The rule that follows, and that I have applied from here on: **do not merge until every check has a
conclusion**, and run `node scripts/check-test-typecheck.js` (plus `pnpm build`) locally before
pushing, not just `tsc --noEmit`. A green Lint/Tests/Custom Rules is not a green CI.

### Verification

- `lib/api/__tests__/invalid-body-response.test.ts` — 8 tests, including the `too_small`-with-a-
  message case the entry's version gets wrong.
- **Mutation-checked three ways.** Swapping in the entry's `code === 'custom'` filter fails 3 cases;
  dropping the `invalid_type`/`unrecognized_keys` carve-out fails the request-shape case; making the
  locale lookup fail *open* instead of closed fails 4 — which is the proof that the fallback
  direction is the safe one rather than an untested claim.
- `pnpm check:rules` — **Ran 69 of 69**. `tsc --noEmit` clean, ESLint clean apart from one
  pre-existing unused `z` import in `food-items` (present on `main` too, left alone).
- `pnpm dev`: **all 18 changed routes hit with their real methods, every one 401 rather than 500** —
  which is what proves the sweep's import resolves and each module still compiles under Next.

**Not exercised: the 400 body itself, on a real request.** Every one of these routes authenticates
before it validates, so the changed branch is unreachable in the sandbox without a Google OAuth
session. What is verified is the helper directly, plus that each route still loads. On-device and
signed-in is where the new message would first be *seen*.

No version bump: error copy on a validation failure, no behaviour change to any successful request.
