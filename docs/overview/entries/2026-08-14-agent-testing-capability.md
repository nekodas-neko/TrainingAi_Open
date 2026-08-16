# 2026-08-14 — the agent-testing-capability cluster (docs-only)

**Branch:** `feat/agent-testing-capability` · **Type:** planning, no code changed
**Deliverables:** review §7 · six backlog entries (Q-249…Q-254) · one `projectOverview.md`
Known-Issues row · the session handoff.

Follows the same session's UI/flow/IA + caching review (PR #1338, `0d5cf1b`).

## What was asked

The owner asked what other access would let agents test end-to-end, citing the Railway API key as
the model — *"it allowed for much better triage. I want more like that"* — then, seeing the answer,
asked which of the queue's owner-gated items it would close, and to queue all of it before the
public-repo migration (Q-49).

## The measurement changed the answer

`projectOverview.md` carries **81** rows marked "NOT verified on device". They are not one gate:
**~25** need nothing but somebody running the app, **17** need an Android runtime, **~10** need real
data, **25** need real hardware, ~4 are perceived performance.

So the largest bucket needs **no new access at all**. There are **466 test files and none that runs
the app**: Chromium and Playwright's browsers ship in every session at `/opt/pw-browsers`, Postgres
is seeded, `pnpm dev` runs — and Playwright is not a dependency, so there is no harness and no
`e2e/` directory.

That reframes why those rows accumulated. The device-verification rule worked exactly as designed;
it had **no cheaper tier beneath it**, so for UI needing a browser rather than a phone, "cannot
verify here" was the only truthful thing a session could write. Rows like "Bodyweight sets no longer
count as zero volume" have sat since v1.50 for that reason, not because they need hardware.

## What was queued

**Q-249** E2E harness (marked *build, don't plan* — one PR, no new access) · **Q-250** Android
emulator job in CI · **Q-251** staging environment with a scrubbed prod-shaped snapshot ·
**Q-252** error tracking with session replay · **Q-253** device-farm run, filed to be decided and
possibly declined · **Q-254** sweep the 81 rows, after Q-249, driven by the harness rather than by
reading.

Placed **above the IA cluster** — Q-249 de-risks Q-232's restructure, the largest UI refactor in the
queue, which today has no way to prove it did not break a screen. The rationale is written into the
cluster header so it can be disagreed with rather than silently inherited.

## Two things verified rather than assumed

- **No Android emulator can ever run in a session.** `/dev/kvm` does not exist and `/proc/cpuinfo`
  reports neither `vmx` nor `svm` — the sandbox is a Firecracker microVM, so nested virtualisation is
  unavailable. GitHub's `ubuntu-latest` runners do expose KVM, which is where Q-250 has to live.
  Recorded so no future session re-attempts it locally.
- **The Q-49 deadline the owner set is load-bearing, not a preference.** That migration's 2026-08-10
  decisions commit to *"CI stays offline and holds no credential"*, while Q-252 wants a DSN and Q-253
  a device-farm key. Settling that on a private repo is straightforward; after the cut it is not.

## Traps hit

- **The Q-number pointer cannot see unmerged PRs, and it bit again.** The file said "next free: 248";
  open PR #1345 already held Q-248. `list_pull_requests` caught it — the same failure recorded on
  2026-08-08 and 2026-08-14. Meanwhile a parallel session claimed Q-245/246/247 mid-conversation and
  another is already implementing Q-242 (PR #1347).
- **`node_modules` was partially installed at session start** (68 packages), so `pnpm check:rules`
  failed with `Cannot find module 'js-yaml'` — indistinguishable from a broken gate until
  `pnpm install --frozen-lockfile` fixed it, after which it ran 33 of 33 clean.

## Not done

Nothing implemented. The per-row bucketing of the 81 rows was done **from headings, not by reading
each row** — directionally sound, not authoritative, and Q-254 re-tags them properly. The "81 → 30"
figure is a projection, not a promise.
