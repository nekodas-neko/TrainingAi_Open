# 2026-09-29 — LB-149: the browser died, and the step built to explain it printed nothing

**Lane B.** Branch `fix/e2e-browser-death-diagnostic`. CI workflow and docs only — no product code, no
version bump.

## The witness arrived and the instrument was broken

`LB-149` has said for four days: *"the cause is NOT established, and this entry closes when the next red
E2E reports."* It reported. Run `36508371834`, the first four-way sharded run, shard 2:
`meal-label.spec.ts:542` failed with `browser.newContext: Target page, context or browser has been
closed` and a 32-frame **`chrome-headless-shell` crash stack**. Shards 1, 3 and 4 were green.

And the `kernel OOM kills` group in the job log is **empty**. Not "no OOM kill found" — empty, with not
even its own fallback line.

```
sudo dmesg 2>/dev/null | grep -iE "killed process|…" | tail -20 \
  || echo "no OOM kill in dmesg — …"
```

**`tail` exits 0 on empty input**, so the `||` arm is unreachable. The step could only ever print
matches, and silence meant nothing at all. Three sessions of *"the dmesg witness is now the thing that
answers it"* rested on a line that cannot answer.

The fix reads dmesg once and branches, and keeps the third case separate: **"no OOM lines" and "dmesg
would not talk to us" are not the same claim**, and from silence they are indistinguishable. All three
branches were exercised against a fake dmesg before pushing — no-OOM, OOM-present, and a refusing
dmesg — because a CI-only shell step has no other way to be tested.

The `free -m` / `ps` block is now labelled **AT TEARDOWN**. It ran minutes after the crash and reported
11 GB free of 16 with swap untouched; reading that as "memory was fine" is the mistake the label exists
to prevent. Catching the peak needs a sampler running alongside the suite, which is not built.

## Two things that DID work, both from LB-166

The `if: ${{ !success() }}` artifact upload retained the first attempt — `playwright-report-2`, 33
files, 15.7 MB. And the four-way split localised the fault to one shard while three stayed green.

## ⛔ The artifact URL in the log is a dead end from a sandbox, and its 403 lies

`github.com/<owner>/<repo>/actions/runs/<run>/artifacts/<id>` — the URL the upload step prints — comes
back **403** from this container, with a body reading *"sessions are bound to their configured
repositories"*. That is the agent proxy, not GitHub, and it reads exactly like an auth failure. The
repository-scoped REST path works:

```
curl -sSL -o a.zip https://api.github.com/repos/<owner>/<repo>/actions/artifacts/<id>/zip   # 200, 15,686,307 bytes
```

The id comes from `get_job_logs` — the upload step prints `Artifact ID …`. This matters more than it
looks: reading the retained first attempt is the method `LB-178` prescribes, and the baton recorded it
as *"downloadable unauthenticated from the artifacts API"*, which is true only for this path.

## What the artifact then settled, in one read

Shard 2's other failure — `food-log-swipe-delete:238`, failed twice — is **not** collateral from the
browser death. The retained first attempt holds a full DOM snapshot, so the browser was alive and
rendering: the row is swiped open, `button "Delete Spec Swipe Yoghurt": Delete` is in the tree, and the
confirmation heading never appeared (*element(s) not found* after 5 s). A genuine assertion failure,
ahead of the crash rather than caused by it. Run in isolation locally the same day: **8 of 8, `:238` in
14.3 s.**

That is recorded on `LB-178` as its fourth data point and its first under sharding — and it is a real
result for that entry, because a **database per shard did not make `:238` go away**, and one shared
seeded database was its leading suspect. The snapshot also names a candidate: the *"Finished logging
this day? · 0 of 10 days marked"* banner is in the CI tree, and whether it renders is database state,
which moves the row the tap coordinate was computed against.

## Not fixed

- **`LB-149` does not close.** The crash is witnessed and the instrument repaired; what is owed is one
  more red E2E read through the working dmesg branch. Claiming a cause from a stack trace and a
  teardown memory figure is exactly what this entry has refused to do four times.
- **`food-log-swipe-delete:238` is not fixed either**, only correctly classified. The banner hypothesis
  above is a candidate, not a finding — nothing has been measured against it.
- **The fix cannot be verified before it merges.** A workflow change only runs on a runner, and this
  step only runs when a shard fails, so the next red E2E is the test. Its three branches are proven
  against a fake dmesg locally; nothing here proves the real `sudo dmesg` is readable on a GitHub
  runner — and if it is not, the new third branch is what will say so.
