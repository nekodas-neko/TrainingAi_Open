# 2026-09-17 — the anchor moved itself, and the guardrail did not notice

**Tuning.** Docs-only. Earlier today this agent amended TN-30 with a new observed max of 175 and
wrote that two resolvers "should now resolve to 175 rather than 168 … **not verified here**".
Discharging that flag is the whole of this entry, and it found more than it went looking for.

## The verification

`computeObservedHr` takes the **5th-highest** reading (`CORROBORATION = 5`) over
`OBSERVED_WINDOW_DAYS = 90`. Against production the top twelve readings are **175 ×5, 174 ×7**, so
the 5th highest is 175. **`targetAnchorMax` resolves to 175 today.** Not "will"; does.

## What that did on its own

With a 28-day mean resting HR of 54, the guided walk's 0.70 fast target:

| anchor | fast target |
|---|---:|
| 168 — what the entry assumed | 134 bpm |
| **175 — live now** | **139 bpm** |
| 178 — the pinned anchor | 141 bpm |

**TN-30 carries `Needs: TN-25` precisely to stop this**: unifying the anchor "raises the walk's 0.70
target from 133 to 140, so it must not land before the walk stops using it". **Five of those seven
bpm have already landed** — no code change, no PR, no announcement.

## The general lesson

**Sequencing a code change does not sequence a data-derived constant.** `Needs:` expresses "this
entry waits for that entry", and there is no way in the queue's vocabulary to say "this threshold
will move on its own when the user does something". The guardrail was written correctly and was
bypassed by a run.

## And it makes TN-25 worse

That entry's complaint is that the walk's fast target has never been met in 44 attempts. The target
rose from 134 to 139 while the owner's measured fast-block HR on the 35-minute walk ran **97 → 116**.
The gap widened by 5 bpm with nobody touching it.

## Why no new entry

The actionable work is already queued — TN-25 owns the walk target and carries a live `Keep:` from
#1263; TN-30 owns the anchors. A new entry would be queue noise for a fact two entries already need
to know. Both were amended instead.

## Not exercised

Docs-only; no code changed, nothing run on device, no scoring change shipped. The resolver value is
computed by applying `CORROBORATION = 5` to production readings rather than by running
`computeObservedHr` itself, and the fast targets are computed from the reserve formula rather than
read from the app — **neither was observed in the running product**. Figures are the owner's own rows
through `claude_ro`, row-scoped to one user.
