# 2026-09-30 — Lane B's queue emptied, so the work became reconciling what was already in it

**Branch:** `docs/lane-b-baton-queue-empty` · docs-only, no version bump

`node scripts/next-item.js --lane B` returns **READY 0**, and that is a real state rather than a
stall. Three head items resolved three different ways in one session: `OR-206` shipped (#2027),
`OR-167` was decided against a build and removed (#2028), and `BF-183` turned out engine-first so its
storage half went to Lane A as `LB-199` (#2028). None was buildable here.

With nothing to build, the productive place is the KEEP list — and what it needed was not building.

## ⚑ Three entries were tracking ONE fault, with no link between them

**I caused the third of these, this morning, and it is the reason the other two surfaced.**

In #2023 I pulled `Received signal 11 SEGV_MAPERR 0000000001b0` out of an E2E artifact and wrote it
onto `LB-149` under the heading **"THE WITNESS ARRIVED"**. It is the **ninth** sighting.
`grep '0x1b0' docs/implementation-backlog.md` returns `LB-56`, which has carried that exact address
**since 2026-09-09, six times**, and which had already settled the mechanism I was treating as open:
its fourth sighting caught one test whose *attempt* died with the `SIGSEGV` and whose *retry* died
with `net::ERR_ABORTED`, proving the two signatures are downstream views of one crash.

**The cost is evidence, not pride.** The prior sightings date the fault to at least 2026-09-09
across eight runs, which supports "one reproducible code path" far better than a single run could,
and they say it predates everything shipped recently.

What that run genuinely added stands: the crash is in the **browser process**, through
`libglib-2.0`'s main loop rather than a renderer — which is why every later test in the shard then
fails to get a context — and a SIGSEGV is not a kill, so **OOM is out**.

Corrected `LB-149`'s novelty claim in place, added the ninth sighting to `LB-56`, and cross-linked
them.

## And the third entry had the answer in its own log

`LB-106` (`preferences-survive-reinstall` fails on CI, passes everywhere else) states **"no cause is
claimed"** — and two bullets earlier notes that the same run carried a `chrome-headless-shell`
segfault with `cr2: 0x1b0`, dismissed as *"runner instability … context for how loaded that run was
rather than a second bug to chase."*

That is the same address, and `LB-56` had already shown `ERR_ABORTED` is what a later test sees
**after the browser process is gone**. The dismissal is what left the entry hunting an app-side
cause that no inspection ever found — which also explains every property that made it baffling: it
never reproduces locally, and it lands on whichever spec navigates next.

**Not claimed as proven.** The segfault in that run was on a different spec and nobody has checked
whether it preceded line 53. The honest next step is written into the entry: re-read run
34814623905's log for a `Received signal` line *before* the abort. That is a read, not an
experiment, and it should happen before the relaunch reshape is treated as the fix.

## Also checked and confirmed NOT startable, so the next session does not repeat it

- **`BF-51` ①** (back from Edit exits the tab) — the fix is **built and deliberately held**: it
  destabilises `e2e/meal-photo-picker.spec.ts` reproducibly, and the entry says reproduce on the S25
  first, because `sheet-back-stack.ts`'s three previous bugs were every one of them found on a
  device. Recorded in the baton rather than re-derived next time.
- **`LB-106`** — its pass test is *ten* consecutive clean CI runs on that spec. I have observed
  about three and have **not** claimed it met.

## The baton

Rewritten in full, as always, and it stays inside its 59-line ratchet. It now carries the true
queue state, the checked-and-not-startable list above, and the lesson: **before writing up a log
signature as a new finding, grep the backlog for it.**

## Verified

`check-backlog-pointers` **522 entries, OK, no cycles, all `Needs:` targets known** ·
`check-doc-index-size` OK. No code changed.

## Not exercised

- **Nothing was run.** This PR is entirely reconciliation of existing entries against each other.
- **`LB-106`'s cause is still not established** — narrowed to a strong suspect with a named read
  that would settle it.
