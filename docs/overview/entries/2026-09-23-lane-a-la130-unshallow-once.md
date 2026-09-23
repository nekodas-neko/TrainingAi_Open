# 2026-09-23 — LA-130: the gate was re-shallowing the clone

**Branch:** `lane-a/la130-unshallow-once` · **Lane A** · one CI step, the session-start hook, and the
CLAUDE.md Git Workflow rule. No product code.

## The cause is `pnpm check:rules`, and it is deterministic

```
before:             shallow=absent   count=1445
pnpm check:rules
after check:rules:  shallow=PRESENT  count=2
```

`check:rules` exists to run **every step** of the Custom Rules job against the local clone — that is
the whole point of it, and it is why the gate is trustworthy. One of those steps was:

```yaml
run: git fetch --depth=1 origin main || true
```

which is correct in CI, where `actions/checkout` is depth-1 and `origin/main` genuinely is not
there. Replayed against a developer's own clone it truncates that clone to two commits, every run.

**And `check:rules` is run immediately before every push.** So the clone was freshly shallow at
exactly the moment its ancestry mattered: the branch loses its history, `git merge origin/main`
fails with *"refusing to merge unrelated histories"*, GitHub reads the PR as conflicted, and **a
conflicted PR is never given a workflow run** — `get_check_runs` returns `total_count: 0` forever
while CI runs normally for everything else. Four PRs (#1426, #1428, #1430, #1435) were abandoned to
this with sound diffs.

## Two wrong diagnoses, and the same reason both survived

`LA-130` — which I filed this morning — said a bare `git fetch origin main` **re-shallows the clone
every time**, "four separate times". CLAUDE.md carried it as a rule: unshallow on *every* fetch.

The first attempt at this entry then went the other way and claimed the opposite: that one
unshallow immunises a clone permanently. That was measured on purpose-built `--depth=1` clones —
0 re-shallows in 16 bare fetches across two clones, including fetches of branch tips never seen —
and it was **also wrong**, because those clones never ran `check:rules`. The working clone was
re-shallowing between observations, just not from the command being blamed.

What let both stand is one detail worth keeping: **`git fetch --unshallow origin` fatals** on an
already-complete repository — *"--unshallow on a complete repository does not make sense"*. Every
invocation today was piped through `tail -1` beside a second command, so a fatal and a success read
identically, and the conclusion that follows is "the unshallow worked, so something undid it"
rather than "it never ran".

A fetch cannot *deepen* a shallow clone. That is all the bare fetch was ever guilty of.

## What shipped

**The CI step is guarded on the ref being absent:**

```yaml
run: git rev-parse --verify --quiet origin/main >/dev/null || git fetch --depth=1 origin main || true
```

In CI the ref is absent, so it fetches and nothing about the gate changes. Locally it is a no-op.
Verified both ways: `check:rules` afterwards still reports **Ran 77 of 77** and leaves the clone at
1,445 commits; with `refs/remotes/origin/main` deleted, the guarded command fetches it back.

**The session-start hook does one repair** for `$CLAUDE_PROJECT_DIR`, guarded on `.git/shallow`
because running `--unshallow` blind on a whole repository is an error rather than a no-op. It is
deliberately last in the hook and non-fatal: the hook runs under `set -euo pipefail`, and the
`unset DATABASE_URL` / `unset DATABASE_SSL` writes above it are what keep `pnpm dev` off the
production database — a fetch that aborted the hook before those writes would be a far worse
failure than a shallow clone.

## Mutation pass

Behaviour against real clones; a YAML step and a bash hook have no suite to run.

| # | mutation | observed |
|---|---|---|
| 1 | CI guard removed (the original step) | `check:rules` takes the clone 1,445 → 2 again |
| 2 | guard inverted (fetch only when the ref EXISTS) | CI case never fetches — the ratchets lose their base and degrade to baseline-only |
| 3 | hook's `test -f .git/shallow` guard removed | prints `fatal: … does not make sense` and fires the warning every session on a complete clone |
| 4 | hook's `\|\| echo …` fallback removed | `set -e` aborts the hook; the line after never runs, which is why the block is last |
| C | hook guard written `[ -e … ]` instead of `[ -f … ]` | identical in both clone states (correct) |

## Not done

- **No wrapper, alias or git config for fetching.** The entry floated all three; with the real cause
  found there is nothing for a per-fetch mechanism to protect against. There is also no `fetch.depth`
  config in git, so the option the entry preferred never existed.
- **The other batons still carry the old rule** (`bugfix.md`, `review.md`, `tuning.md`,
  `implementation-lane-b.md`). Those files belong to those roles; CLAUDE.md is the shared authority
  and it is corrected. Lane B's note — that `--unshallow` does not update `origin/main` on an
  already-unshallowed repo — is the same fatal seen from the other side, and is right.
- **Failure surfaces not exercised:** the hook was run as an extracted block against real clones,
  not by starting a session end-to-end; that happens on the next session start. The CI branch of the
  guard was exercised by deleting the ref locally, not by a real depth-1 `actions/checkout` — this
  PR's own Custom Rules run is the first real test of it.
