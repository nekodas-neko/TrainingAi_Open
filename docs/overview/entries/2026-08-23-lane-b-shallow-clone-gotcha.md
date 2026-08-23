## 2026-08-23 — the clone re-shallows on every fetch, and the baton now says so

**Branch:** `docs/lane-b-shallow-gotcha` · docs-only, no version bump.

The Lane B baton recorded the shallow-clone trap as *"the container re-clones SHALLOW on resume"*.
That is an undercount, and it cost a second merge in the same session.

**Measured:** after a full `git fetch --unshallow origin`, a single plain `git fetch origin main`
puts `.git/shallow` back and `origin/main` reads as **one** commit. The next `git merge origin/main`
then dies with *"refusing to merge unrelated histories"*. It is not a resume-only condition — it
recurs after **every** fetch, which is why it caught the same branch twice.

The second time was worse than the first, because by then `main` genuinely appeared to have a single
root commit locally, which reads as a repository disaster rather than a clone setting. `list_commits`
against GitHub settled it in one call: full history, and the branch point an ancestor.

The baton now carries the measurement, the one-line check (`test -f .git/shallow`), the habit
(`--unshallow` immediately before every merge, not once per session), and the instruction to confirm
against GitHub before believing local history is gone.

**Also folded in:** BF-4's Lane B half added to the run summary — with the part that matters, that it
is **not** shown to be the owner's slowdown and that #112, the client-timing sink and the Railway
cold-start check stay open and are Lane A's. The `Next` section is rewritten, since BF-4 still reads
as top of READY while its Lane B half is done; a successor should skip to Q-326.

**On the baseline: raised 97 → 102, three hours after I ratcheted it down to 97.** Trimmed first and
got two lines back before the returns went flat. Lane A's 2026-08-20 note already argued that *"the
ratchet is the wrong instrument here"* for a file rewritten in full at every handoff, and two lanes
have now hit that independently on the same file class. The durable fix is PS-4's — move the
inherited findings to permanent homes — which neither lane has done.

**Verification.** `pnpm check:rules` — **Ran 51 of 51**, all passed.

**Not exercised:** nothing runtime. This PR contains no code.
