# 2026-08-30 — Q-311: the credential-shaped literals in a public repo's CI (and one dead env var)

**Branch:** `chore/e2e-auth-secret-before-public-cut` · **Lane:** A · **Domain:** platform

## What this was

Q-311 was filed on 2026-08-16 as a deadline rather than a priority: `.github/workflows/ci.yml`
sets `AUTH_SECRET: e2e-ci-secret-not-used-outside-this-job` inline, and the entry's point was that
**a reader of a public repo cannot tell a dummy from a leak by looking**. The deadline passed — the
repo went public on 2026-08-17 — so this shipped late.

The entry offered two acceptable fixes and asked only that the value not be left "bare and
unexplained": move it to a repository secret, or keep it inline with a comment saying what it is.

## What shipped

**Kept inline, commented.** Reasons, since the entry left the choice open:

- A repository secret **is not passed to a pull request from a fork**. E2E is a *required* check, so
  moving the value would fail every outside contributor's PR — a real regression for a repo that
  just went public, which is the exact context that motivated the entry.
- Hiding the value does not answer the reader's question. It leaves them wondering whether CI
  depends on a real credential; a comment says outright that it does not.
- A repository secret needs the owner to set it, which would have blocked the item.

Comments added at three env blocks — the CI Build job, the CI E2E job, and the emulator job — each
saying that the values are throwaway literals for a job whose server and database are destroyed
with the runner, and (on the E2E one) why it is deliberately inline rather than a secret.

**README** gained a short "the credentials you will find in this repo are fixtures, not leaks"
paragraph covering both the workflow literals and the seeded `test@local.dev` user the entry also
flagged.

## The premise check found something the entry did not

Before writing the comment I checked that `AUTH_SECRET` is actually read. It is —
`auth.config.ts:7`, as the entry said. But the same grep for its neighbour came back **empty**:

**`SESSION_SECRET` is read by no code in this repository.** It was `auth.config.ts`'s fallback for
`AUTH_SECRET` until that fallback was deleted (recorded in `docs/overview/history-early.md:1194`),
and the variable outlived its only consumer in four places: `CLAUDE.md`'s "Required in Railway"
list, the README's env template, and **two CI workflow env blocks** — where it was one of the four
credential-shaped literals this entry was about. Two of the four were for a variable nothing reads.

So the dead lines were deleted rather than commented, and the docs corrected. The inverse error was
sitting next to it: **`AUTH_SECRET` — the one variable whose absence stops anyone logging in — was
listed in neither `CLAUDE.md` nor the README.** Both now list it; `SESSION_SECRET` is a tombstone in
`CLAUDE.md` next to the `GEMINI_API_KEY` one, marked safe to remove from Railway.

## Files

- `.github/workflows/ci.yml` — comments on the Build and E2E env blocks; `SESSION_SECRET` removed.
- `.github/workflows/android-emulator.yml` — same comment; `SESSION_SECRET` removed.
- `README.md` — `SESSION_SECRET` → `AUTH_SECRET` in the env template; fixtures-not-leaks paragraph.
- `CLAUDE.md` — `AUTH_SECRET` added to the required list, `SESSION_SECRET` tombstoned.
- `docs/implementation-backlog.md` — Q-311 removed.

## Verification

`pnpm check:rules` — **Ran 62 of 62**, all passed. Both workflow files re-parsed with a YAML parser
after editing and their job/env structure printed to confirm `SESSION_SECRET` is gone from both and
`AUTH_SECRET` survives in the two jobs that need it. `grep -rn SESSION_SECRET` over the whole repo
now returns only prose (this entry, `CLAUDE.md`'s tombstone, and historical journal lines).

**The load-bearing check for the deletion is CI's own Build job**, which is what consumed the
removed variable: if anything had needed it, Build goes red. Nothing does — the full-repo grep found
no consumer, and every local `pnpm build` in this repo already runs with `SESSION_SECRET` unset.

**Not exercised:** no runtime surface changed, so there was nothing to smoke on `pnpm dev` and no
device check is owed. No version bump — nothing user-visible shipped.
