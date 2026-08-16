# 2026-08-02 — Roadmap review against the native endpoint, and the public-repo resequence

_Branch: `claude/app-review-native-roadmap-mcj2ab` · Domain: `platform` · Docs-only._

## What this was

The owner asked for a review of the app's road plan — specifically whether it aligns with ending up
as a native APK — then, after the review, for the public-repo migration to be planned and slotted.
No code changed this session.

## What shipped

- **[`docs/reviews/2026-08-02-native-convergence-roadmap-review.md`](../../reviews/2026-08-02-native-convergence-roadmap-review.md)**
  — eight findings against the native-convergence goal layout and the docs feeding it. Verdict: the
  roadmap converges on a native-*data* app on one device, not on a shippable product, and the two
  are about one unwritten stage apart.
- **[`docs/superpowers/plans/2026-08-02-public-repo-migration-roadmap.md`](../../superpowers/plans/2026-08-02-public-repo-migration-roadmap.md)**
  — backlog **Q-49**. Phase A (model delivery) + Phase B (the cut, CI, Railway repoint, archive).
- Backlog: **Q-49** added at the top; **Q-48** (the review's remaining findings, renumbered from
  Q-46 after run-1 claimed that number the same day); **Q-31** and **Q-32** re-scoped with their
  gates released.
- Five drifted doc claims corrected, and `CLAUDE.md`'s `body_hex` rule qualified as server-side.

## The finding that changed the plan

`CLAUDE.md`'s Canonical Runtime, the goal layout and `device-agnostic-source-architecture.md` are
three same-day documents that disagree about the destination — "single-user app on the S25" versus
"other people use this, the intent is a Play Store listing". Most of the review follows from that.

The one with teeth: **after Stage 2 bundles the shell, every UI change becomes a manual sideload**,
and there is no OTA path in the repo. The assessment calling that low-priority was written
2026-07-31, one day before multi-user was confirmed permanent, and Stage 6 — the Compose migration —
is the highest-UI-churn period the app will ever have. Untracked until now; it is Q-48 F2.

## The correction the public-repo plan is built on

Q-32 planned to gitignore the SleepNet and `step_counter` weights and keep them on the owner's build
machine, reasoning that Phase 3 leaves no public server deploy. Traced against source:

- Phase 3 splits `api/` onto its own Railway service; it does not remove the server.
- Those models load through `onnxruntime-node`, are marked "Server-only", and `sleepNetStages5Min`
  runs inside `aggregateOuraRawSamples` (`adapter.ts:5006`) — on Railway, which deploys from git.
- Every loader returns `null` on failure by design, so a missing asset degrades the hypnogram and
  daily steps **silently**.

So the dependency in front of the cut is getting those bytes to Railway without git — not Q-1 or
Q-30, which were sequencing preferences. Owner chose a build-time fetch from private storage. Two
facts make it cheap: `ONNX_DIR` (`inference/session.ts:12`) is a single choke point, and the WASM
sibling `session-web.ts` already exists with byte-parity tests and zero callers, fed by the same
directory when D2 Task 6 wires it up.

## Reconciled with #999 mid-session

Eight commits landed on `main` while this was being written, including **#999**, whose
[`2026-08-02-oura-ip-triage.md`](../../superpowers/plans/2026-08-02-oura-ip-triage.md) had already
audited the seven-module import graph independently — deeper than this session's sketch. The plan
was rewritten to consume it rather than duplicate it: #999 decides *what* happens to each module,
Q-49 decides *how it reaches production* and sequences the cut. #999's replacement tasks are
explicitly off Q-49's critical path, because A1 makes a gitignored asset deployable.

## Owner decisions recorded

Build-time fetch now with WASM later · snapshot minus the model tree, no dead-code sweep in the same
cut · repoint the existing Railway service (the domain is hardcoded in `capacitor.config.ts`, so
keeping it means installed APKs keep working) · same GitHub account, new public repo, name at
Phase B.

**One repo, not two.** The owner asked whether a second repo should hold the native APK; it should
not — Stages 6–7 ship Compose and WebView screens in the same APK, so splitting them forces the
clean-slate rewrite the goal layout already rejected on measured grounds.

## Second half — the owner retargeted the perf work

After the review merged, the owner clarified where the app actually feels slow: **the home screen
and tab navigation**, not the workout screen. That invalidated the aim of both live perf tracks, and
the repo's own docs said so already — Phase 3's sizing note (*"it will not make navigation
faster"*) and Stage 6's ordering, which ranks the workout screen first.

The load-bearing discovery: **`components/shell/tab-shell.tsx:97` renders `SessionSelectContent` for
the `home` tab.** Stage 6 lists that file as *"session select (1,407)"*, which hid the fact that it
is the most-touched screen in the app — and it is statically imported into the tab shell, so its
1,414 lines sit in the main bundle, on the cold-start path the device profile says is dominated by
JS parse/execute.

Filed as **Q-51** (#1016, renumbered from Q-50 after a parallel collision): split the home
component → prefetch the four tab chunks on idle → **profile cold start on the S25**, in that order,
with the measurement last because it is what should decide whether Stage 5 or Stage 6 is worth their
cost. Owner endorsed the prefetch specifically.

**Owner then approved a full sequence** (#1018), recorded in `projectOverview.md`, the goal layout
§4 and the Q-1 entry: Q-51 → Q-49 → Stage 3 → measure again → Stage 5 → Phase 3 and Compose only if
a gap remains. **Phase 3 is measurement-gated, not cancelled** — placed directly under the older
"don't let a millisecond count talk you out of it" note so the two read as one, and explicit that it
is not licence to delete the entry or spend Gate A.

## Corrections to this session's own work

- **My ONNX figures were wrong** — 46 files / 31 MB, actually **10 / 23 MB**. A `grep -c onnx` over
  `git ls-files` matched every path *containing* "onnx", including the `__fixtures__` goldens.
  Caught by another session in #1014; the plan is unaffected.
- **Q-number collisions twice in one day** (Q-46 in #1003 vs #1005, Q-50 in #1015 vs #1016). The
  backlog told you to claim *migration* numbers against open PRs but said nothing about Q numbers;
  it now does, with the tie-break used here — the entry attached to in-flight work keeps the number.

## Not verified

Nothing ran. No device, no APK, no `pnpm dev`, no test suite, no Kotlin compile, no production
queries. Every claim is documentation- or source-level, and the file:line references were checked
against `main` at `e6ae0a6`. Q-49's Phase A1 boot assertion and Phase B4 repoint are the two steps
that will need real verification when someone builds them.
