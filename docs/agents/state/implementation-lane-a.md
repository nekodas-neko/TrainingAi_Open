# 🚧 Implementation Agent (A) — baton

> **Successor sessions are titled `🚧 Implementation Agent (A) 🟢`** — exactly, emoji included. The title
> is how six concurrent sessions stay tellable apart; a renamed successor is a lost thread even with a
> perfect baton.

**Updated:** 2026-08-25 · **By:** the eighth session to run as Lane A · **Next ID:** `LA-23`
(`grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1` is the authority, not this line)
**Migrations:** through 215; next free is **216**. Local SQLite **v28**, untouched this session.

## Now

Nothing in flight. Twelve PRs merged and closed out; no branch of mine is open.

**Start with `node scripts/next-item.js --lane A`.** Whether the top entry is actually startable is
exactly what reading the file cannot tell you.

Session record:
[`docs/handoff-2026-08-25-readiness-baseline-seed-and-lane-a-sweep.md`](../../handoff-2026-08-25-readiness-baseline-seed-and-lane-a-sweep.md).

## Owed, and owed to the owner — do not mark these shipped

1. **The BF-13 / Q-506 / TN-8 batch is code-complete and its DATA half is unrun.** The seed fix
   protects baselines built from now on; the stored ones are still zero-folded. **One Redecode run on
   production re-derives them** (`run.ts:917` null-seeds the fold under `fullHistory`, which the
   Redecode endpoint already sets) — **and it cannot be run from a sandbox**, because the rollup needs
   the vendored Oura constants Q-49 removed. Every pass test in all three entries measures that run,
   not the code. Afterwards: deviation mean within ±0.05 °C with ~half the nights negative;
   `temp_dev_c > 1.0` on 0 nights; and re-measure the biomarker table, because every z moves ~19× and
   the radar may then fire **too often**.
2. **TN-6a is a suppression, not a fix.** TN-6 retires it; its ±0.05 °C pass test is what does.
3. **LA-22 — should E2E be a required check?** #454 merged with its own E2E red, which is how a red
   `main` reached four branches before it was traced. Gated on the owner.
4. **Nothing this session was device-verified**, and the sleep + readiness changes are read paths on
   screens the owner opens daily.

## Do not re-litigate

- **The baseline seed lives in a wrapper (`seedOrUpdateBaseline`), never in `updateBaseline`.** That
  function is a faithful ecore port and `warm_up_then_settle` pins its zero start against open_oura's
  own test vector. Changing it makes the port a lie about what the ring does.
- **Never widen a threshold to quiet a broken input** — TN-6a, Q-506, TN-8 and BF-13 all refuse it:
  it hides the defect behind a plausible firing rate and desensitises a real fever once the baseline
  converges.
- **Export coverage is a map plus a CI check, not a longer array**, and deliberately not driven from
  `generate-claude-ro-views.js` — its views scope to one fixed owner, the export to the requester.
- **`ai_health_insights` has no hash-less read.** Deleting `getAiHealthInsight` is what makes the
  stale-insight class unreachable rather than merely fixed.

## Traps this session paid for

- **An `aria-hidden` overlay makes `getByRole` report an affordance as ABSENT, not obscured** — and a
  `grep` for the label then appears to confirm it. I filed a finding claiming a test could never have
  passed; the modal was simply in the way, and it was already fixed. Reproduce, then verify against a
  second source before calling anything unpassable.
- **Read a failing test before adjusting it.** Four here were pinning the defect, not guarding — one
  asserted a baseline of `580`, exactly half the correct `1160`, with a comment about units.
- **Backlog conflicts have two opposite shapes and identical markers.** Both sides deleting their
  finished entry → keep neither. Both sides inserting a new one → keep both. Read the headings.
- **Rebuild `docs/doc-size-baseline.json` from `origin/main` on a conflict; never splice.** Splicing
  once silently reverted three other agents' raises.
- **A stale base cost three CI cycles**, each looking like a real failure (component size, doc size,
  Lint on another agent's stray file). Merge `origin/main` before believing a failure is yours.
- **`pnpm dev` failed on a missing `@sentry/nextjs` and was never retried** after a `pnpm remove`
  repaired the workspace — which also fixed the two long-standing `qrcode` test failures. Retry it
  rather than assuming it is still broken.
