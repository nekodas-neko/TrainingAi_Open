# 2026-09-10 — a red CI job could only say it was red; the cause was a missing `-U postgres` (LB-54)

**Branch:** `fix/lb-54-readable-ci-logs` · three lines of `ci.yml` · no product code.

## The symptom, and how long it stood

`get_job_logs` could not reach any step's output on this repo's jobs. Every retrieval — by `job_id`,
by `run_id` with `failed_only`, at `tail_lines` from 60 to 400 — returned only the post-job Postgres
service dump: thousands of lines of `role "root" does not exist`. A failed `Tests` job's entire
retrievable content was **2,797 characters, none of it vitest's**.

That cost a session on BF-111, where CI went red while the same commit ran **6,429 passed, 0 failed**
locally, and the only instrument available for telling a flake from a real failure was spending the
one permitted re-run.

## The cause

All three Postgres services in `ci.yml` ran `--health-cmd pg_isready` **with no `-U postgres`**.
`pg_isready` then connects as the container's OS user — root — which does not exist as a Postgres
role, so the server logs `FATAL: role "root" does not exist` on every probe, every 10 seconds, for
the life of the job. The runner prints that dump *after* all steps, which makes it the tail of the
log and therefore the only part `get_job_logs` can reach.

**`android-emulator.yml` has always had the `-U`.** The corrected form was already in the repo; three
jobs simply never got it.

## What is not claimed

**Whether a step's output is now retrievable needs the next genuinely red job to prove.** This
removes the documented cause of the noise, which is not the same as observing the cure — and I cannot
manufacture a red job to check. The entry says so rather than closing.

## The other half of LB-54, deliberately not done

E2E still has no green baseline on `main`: the job is gated `if: github.event_name != 'schedule'`, so
the nightly skips it and CI history cannot answer *"is this red on `main` too?"* — the first question
the CI rules say to ask.

Removing that line looks free and is not. **LB-31 chose "one job rather than six" for the nightly on
purpose**, and E2E is 26 minutes. More decisively, **LB-56 records that `main` would not pass the
suite today**, so enabling it now buys a nightly that is red from its first run — the "advisory check
decays unwatched" failure LB-56 itself warns about, at 26 CI-minutes a night.

LB-54 now carries `Needs: LB-56`, which parks it behind the decision that actually settles whether a
nightly baseline is the right instrument. The entry says why, so the next session does not make the
one-line change on the grounds that it is only one line.

**Surfaces not exercised:** none apply — CI configuration only; no runtime code, no device path, no
schema. YAML re-parsed; `pnpm check:rules` **Ran 73 of 73**.
