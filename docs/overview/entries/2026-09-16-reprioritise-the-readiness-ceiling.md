# 2026-09-16 — three entries to the top, on the owner's instruction

**Tuning.** Docs-only, and a **pure reorder** — `sort`ing the file before and after produces
byte-identical output, so no entry was rewritten, merged or dropped.

## Why

Yesterday's audit established that the owner cannot score 100 on any pillar and that readiness has
never reached 90 in 62 days, with the cause named: `temperature` is scored closer-better against a
baseline that is miscentred, so it cannot reach its own optimum (TN-42). The fixes for that were
already in the queue — **at positions 180 and 190 of 341.** Lane A works the queue top-down from
`next-item.js`, so at that depth they would not be reached.

**Diagnosis without priority changes nothing.** The owner set the priority; this records it.

| new | was | entry |
|---:|---:|---|
| 1 | 37 | **TN-34** — the stress-deload override, one line, September deloads 11 of 15 → 1 of 15 |
| 2 | 190 | **BF-13** — the baseline EMA seeds at zero |
| 3 | 180 | **TN-6** — the temperature baseline, 0.36 °C low |

**BF-13 above TN-6 deliberately** — TN-6's own entry names BF-13 as the line underneath it, so
fixing the symptom first means doing the work twice. The EMA seed is also shared by all six
baselines, which is why it outranks the single contributor it was found through.

TN-39 (position 7) and TN-42 (position 10) were left alone: already high enough to be reached, and
TN-39 is a measurement rather than a fix.

## Also

**PR #1098 (RV-42, Lane A's meal-plan ownership fix) has the owner's confirmation** as of today,
after five days waiting on the security carve-out. The merge was attempted and refused with merge
conflicts against head `bbfb9a5c`, despite all six checks green on that head. **The conflict was
deliberately not resolved here** — it is Lane A's branch, pushed to at 09:16 the same morning, and
resolving another agent's in-flight security work is the shape that has previously restored deleted
backlog entries and corrupted changelog entries in this repository. The approval is recorded as a
comment on the PR so Lane A can resolve and self-merge.

## Not exercised

Docs-only; no code changed, nothing run on device, and **no scoring change shipped** — the three
entries moved are Lane A's to build and the owner's to sign off. The reorder itself was verified as
content-preserving by sorted-file comparison rather than by reading the diff.
