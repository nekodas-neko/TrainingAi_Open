# 2026-09-30 — LB-106's cause was in its own log for sixteen days

**Branch:** `docs/lb106-cause-is-the-browser-crash` · docs-only, no version bump

#2029 left one concrete unfinished read: whether `LB-106`'s CI-only `net::ERR_ABORTED` is
`LB-149`'s browser crash. It is, and establishing it took **one log fetch**.

## What was read

Job **103882629107** of run **34814623905** (2026-09-14). The job log is still retained sixteen
days on — the **artifact** is not, at `retention-days: 7`, which is worth knowing: for a
fortnight-old run the log is the only surviving evidence and it is enough.

```
1) [mobile-chromium] › e2e/preferences-survive-reinstall.spec.ts:36:5 …
   Error: page.goto: net::ERR_ABORTED at http://localhost:3100/
   …
   [pid=4243][err] Received signal 11 SEGV_MAPERR 0000000001b0
```

**The SIGSEGV is inside that spec's own failure block, at the same pid as the browser whose
`page.goto` aborted.** `plan-rescale`'s crash in the same run is a separate process, `[pid=5177]` —
so there were **two** crashes, one per failing spec, not one crash plus one mystery. That is
`LB-56`'s fourth sighting exactly: `ERR_ABORTED` is what the harness reports once the browser
process is gone.

## What is deliberately NOT claimed

The crash line is the last entry in that process's stderr and carries **no timestamp** — Chromium's
crash handler prints without the `MMDD/HHMMSS` prefix its console lines have — so the log alone
cannot order the SIGSEGV against line 53's `goto`. **The attribution is Playwright's**, which
reports that browser's stderr under that test's failure, not an ordering I measured. Strong enough
to stop hunting an app-side cause; not strong enough to call the sequence proven, and the entry says
so in those words.

## Three things follow

1. **The relaunch reshape is not the fix.** It is defensible on fidelity, as its own note argues,
   but it cannot address a browser that died.
2. **The service-worker block should go.** The spec's header carried an explicit falsification —
   *"If the abort returns, the SW was not it"* — the abort returned with the block in place, and it
   is now justified by nothing.
3. **`LB-106` is no longer its own investigation.** It is a symptom of `LB-149`, whose remedy is a
   harness decision (a Playwright/Chromium bump, or a flag), and its ten-clean-runs pass test
   measures the runner's luck rather than anything the spec does. `LB-149` now says it owns this.

## Why this is worth a session's tail

`LB-106` is dated 2026-09-14 and carries a careful, correct investigation: it ruled out `storage`
listeners, `location.assign`, and `beforeunload` by reading rather than guessing, and it refused to
lengthen the poll timeout. All of that was sound and none of it could succeed, because the fault was
never in the app. **The one thing not done was reading the rest of its own log** — and the entry
even quotes the crash, two bullets above "no cause is claimed", filed under *"runner instability …
context for how loaded that run was rather than a second bug to chase."*

That is the same shape as this morning's `LB-149` error, inverted: there I wrote a signature up
without grepping for it; here the signature was in hand and read as background. Both are cheap
lookups skipped next to expensive reasoning.

## Verified

`check-backlog-pointers` OK · `check-doc-index-size` OK. No code changed.

## Not exercised

- **Nothing was run.** One archived CI log was fetched and read.
- **The ordering within the crashed process** — see above; it is Playwright's attribution, not a
  measured sequence.
