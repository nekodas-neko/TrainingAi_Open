# 2026-08-26 — the size ledger stops being a merge conflict (LA-33), and E2E can be required (LA-22)

**Branch:** `feat/per-file-doc-size-baselines` · **Lane A** · no version bump (CI + doc tooling, nothing user-visible)

## LA-33 — one file per tracked doc

Every PR that raises a documentation baseline edited the same two lines of
`docs/doc-size-baseline.json`, so **two open PRs conflicted by construction** — whether or not they
were about the same document. Measured this session: one PR was outrun by `main` **four times in 35
minutes**, and every single conflict was in that ledger, the backlog, or the changelog. Never in
code.

Baselines now live at `docs/doc-size/<the tracked path>.size`, one number each:

```
docs/doc-size/projectOverview.md.size          → 8105
docs/doc-size/docs/implementation-backlog.md.size
docs/doc-size/docs/agents/state/tuning.md.size
```

The filename mirrors the tracked path, so nothing is encoded or decoded and `ls -R` shows what is
tracked. Two PRs raising two different docs now touch **no common line**. Two raising the *same* doc
still conflict — which is correct, because they genuinely disagree about one number, and that is a
two-way choice between two integers rather than a hunk to splice.

**This is the fix the session journal already took.** `docs/overview/entries/README.md` records that
moving from a shared history file to one file per entry took the most frequent multi-PR conflict to
zero. Same shape, same answer.

**What did NOT move:** the `entries` policy stays in the JSON. It is one rule about a whole
directory rather than a number per file, so splitting it would buy nothing.

### Failing loudly was the design constraint

A baseline that silently fails to load is a ratchet that silently stops ratcheting — the file becomes
unbounded and nothing says so. So a malformed `.size` **throws** rather than being skipped, and a
missing directory throws rather than tracking nothing. Both are tested, and both mutations are
caught.

The loader is extracted to `scripts/lib/doc-size-baselines.js`, matching the repo's existing pattern
for testable script logic (`completion-words.js`, `entries-verdict.js`). `baselinePathFor()` is the
single place the filename spelling is decided, so the failure message and the loader cannot disagree
about which file the author is being told to edit.

## LA-22 — E2E gated on UI paths, so it can safely be required

The owner chose **required on UI PRs only**, from required-on-UI-PRs / not-required-but-loud-on-main
/ required-everywhere / leave-it.

**The obvious implementation is the wrong one.** A `paths:` filter on the job would leave a required
check that never reports on a non-UI PR, blocking it forever — the same reason the Android workflow
is deliberately *not* required. So the job **always runs and always reports**, and short-circuits to
success when the PR touches none of `app/`, `components/`, `e2e/` or `playwright.config.ts`. A
non-UI PR pays ~20 s (checkout plus the Postgres service) instead of ~10 minutes.

The diff uses `merge-base` (`BASE...HEAD`), so unrelated commits landing on the base branch while a
PR is open cannot make an engine-only PR look like a UI one.

### ci.yml claimed the opposite, and was wrong

A comment in the E2E job read *"E2E is a required check, so it blocked the merge outright."* It is
not, and LA-22 was filed because **#454 merged with E2E red**. Confirmed first-hand before changing
anything: three PRs were merged this session while E2E was still `in_progress`, and
`merge_pull_request` validates against real branch-protection state. The comment is corrected in the
same change.

### ⛔ One owner action, and nothing has changed until it happens

**Add `E2E` to the required checks on `main`'s branch protection.** That setting is not in this
repository and cannot be changed from a session. Until it is flipped, E2E still cannot block a
merge — exactly as #454 showed. LA-22 stays queued with that as its `Keep:`.

## Also in this PR — Q-388 re-opened

The owner supplied a datum that breaks its conclusion. The entry argues the ring's drain decision is
binary (SpO₂ on or off) because SpO₂ is the largest event source. The owner: *"It was on on the oura
ring software too and it wasnt this bad."*

SpO₂ being enabled therefore does **not** distinguish our 15–38%/night from stock's ~14%/day —
something *we* do differs with the same sensor running. Turning it off would trade away real data to
work around an unidentified cause, and would probably still not reach stock's figure. The entry now
carries that, with the candidates (BLE connection/notify pattern, battery-poll cadence, live-HR
connect behaviour, the fast-HR fix that has not reached the device) and a first action that is a
measurement rather than a change: **get the pending APK on the device, then compare a week of
`oura_ble_battery_poll` against the pre-fix week.**

## Verification

13 unit cases for the loader, each mutation-checked with an asserted anchor: accepting any value
fails 2, dropping the missing-directory guard fails 1, dropping the `.size` filter fails 1. The
committed baselines are themselves asserted — every tracked path exists, every number is a positive
integer, and the orientation docs stay tracked.

The workflow change is validated by parsing `ci.yml` (all six jobs intact) and by
`pnpm check:rules` still reading **Ran 59 of 59** — it parses that file to find the Custom Rules
steps, so a malformed edit would show up there.

Full suite, `tsc --noEmit`, lint.

## Not exercised

**The E2E gate itself will not be proven until a PR exercises both halves** — this PR touches no
`app/` or `components/` file, so it takes the skip path, and the run path is unproven until a UI PR
follows. That is the wrong way round for a first outing and is worth watching on the next Lane B PR.
Also not exercised: branch protection, which is the owner's to change and cannot be read from here.
