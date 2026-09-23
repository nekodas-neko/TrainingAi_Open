# 2026-09-23 — LA-130: it never came back, because it never left

**Branch:** `lane-a/la130-unshallow-once` · **Lane A** · the session-start hook and the CLAUDE.md
Git Workflow rule. No product code.

## The entry was mine, filed this morning, and its central claim is false

LA-130 said a bare `git fetch origin main` **re-shallows the sandbox clone every time**, measured
"four separate times, and `.git/shallow` came back on every one". CLAUDE.md carried the same claim
as a rule: fetch with `--unshallow` *every* time, and re-check `test -f .git/shallow` after,
"a plain fetch re-grafts at the new tip, so one unshallow does not immunise the next fetch".

Measured properly on a purpose-built `git clone --depth=1`:

| step | `.git/shallow` | commits |
|---|---|---|
| after the shallow clone | PRESENT | 1 |
| bare `git fetch origin main` ×2 | PRESENT | 1 |
| `git fetch --unshallow origin` | **absent** | 1,444 |
| bare `git fetch origin main` ×3 | absent | 1,444 |
| `git checkout -B t origin/main` | absent | 1,444 |
| fetch of two branch tips never seen before | absent | 1,448, one root, valid merge-base |

**One unshallow immunises the clone permanently, including against tips it has never seen.** What a
bare fetch cannot do is *deepen* a clone that is still shallow — which is the whole illusion. The
four fetches that "re-shallowed" were four fetches on a clone that had never successfully been
unshallowed in that stretch. It did not come back; it never left.

The last row matters most, because "a tip the clone has never seen" is the precise case the old
rule claimed would re-graft. It does not.

## Why the wrong conclusion was reachable

`git fetch --unshallow origin` **fatals** on an already-complete repository — *"--unshallow on a
complete repository does not make sense"*. Every invocation today was piped through `tail -1`
alongside a second command, so a fetch line from the *second* command is what got read. A fatal and
a success look the same through that pipe, and the diagnosis that follows is "the unshallow worked,
so something undid it" rather than "the unshallow never ran".

## What shipped

**The rule is corrected in place** — one unshallow per clone, guarded by `test -f .git/shallow`
because running it blind on a whole repository is an error, not a no-op.

**The session-start hook now does it**, so no session has to remember. It is deliberately the *last*
thing in the hook and deliberately non-fatal: the hook runs under `set -euo pipefail`, and the
`unset DATABASE_URL` / `unset DATABASE_SSL` writes above it are what keep `pnpm dev` off the
production database. A fetch that aborts the hook before those writes would point the dev server at
production, which is a much worse failure than a shallow clone.

## Mutation pass

No unit test can reach a bash hook, so these were run as behaviour against real clones rather than
against a suite. Stated plainly because a table of "killed" is otherwise misleading.

| # | mutation | observed |
|---|---|---|
| 1 | `test -f .git/shallow` guard removed | on a complete clone, prints `fatal: … does not make sense` and fires the warning **every session** — noise that trains the reader to ignore it |
| 2 | `\|\| echo …` fallback removed | `set -e` aborts the hook; the line after it never runs, which is why the block is last |
| C | `[ -f … ]` written as `[ -e … ]` | identical behaviour in both clone states (correct — equivalent for a regular file) |

Verified directly: on a fresh `--depth=1` clone the block takes it to 1,444 commits and exits 0; run
a second time against the now-complete clone it exits 0 and changes nothing.

## Also corrected

`docs/overview/entries/2026-09-23-lane-a-e2e-test-path-filter.md` repeats "`--unshallow` on **every**
fetch" — a blockquote there now points at this entry. The other copies live in other agents' batons
(`bugfix.md`, `review.md`, `tuning.md`, `implementation-lane-b.md`) and were left alone: those files
belong to those roles, and CLAUDE.md is the shared authority that has been fixed. Lane B's baton
states a *different* and correct fact — that `--unshallow` does not update `origin/main` on an
already-unshallowed repo — which is the same fatal seen from the other side.

## Not done

- **No wrapper, alias or git config.** The entry floated all three, preferring a config "because it
  survives a session forgetting". There is no `fetch.depth` config in git, so that option never
  existed — and once the premise collapsed, a per-fetch mechanism has nothing left to protect.
- **The hook only reaches `$CLAUDE_PROJECT_DIR`.** A clone a session makes itself in the scratchpad
  is its own to unshallow; the corrected rule says so.
- **Failure surfaces not exercised:** the hook was run as an extracted block against real clones,
  not by starting a new session end-to-end. That happens on the next session start.
