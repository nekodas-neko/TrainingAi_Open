# Route device sweep 4b: a dead notification channel, and a scrim that stops at the tab shell

Orchestrator, 2026-09-26. Docs only. Device Verification's sitting 4b (#1701) closed five entries
itself; this routes what it could not.

## The find worth naming

Station A of `RV-155` reported row 11584 as FAILED: the S25 has no `health-alerts` notification
channel, only `oura-ble-v2`. Read at source the same day, that is not a device quirk —
`components/capacitor-native-init.tsx` creates exactly five channels and `health-alerts` is not one
of them, while `lib/health-alerts.ts:121` schedules with `channelId: HEALTH_ALERTS_CHANNEL`. On
Android 8+ a post to a channel that does not exist is dropped.

So illness, high-stress and low-readiness alerts have never been able to fire. Every layer above the
channel is healthy — `reconcileHealthAlerts` runs from the sync provider, `computeHealthAlertActions`
is unit-tested and green, the dedup key is written. **The only surface that shows the fault is the
device's channel list**, which is why a green suite and a working feature look identical here. Filed
`DV-21`, Lane B, rank 1.

## Routed

| from 4b | where it went |
|---|---|
| no `health-alerts` channel (RV-155 row 11584) | **`DV-21`** new, Lane B, rank 1 |
| pushed routes have no status-bar scrim | **`DV-22`** new, Lane B |
| RV-206 P29–P31 need the owner's OK | **`OR-176`** new, Lane O, `Ask: owner` |
| 36 stuck food-delete tombstones | `DV-8` re-scoped and retitled, stays Lane A |
| PS-35b launch half passes | `Verify:` narrowed to the one half still owed |

## Three things this got wrong on the way, and the one worth keeping

**`Verify:` on unbuilt work.** Both new entries were written with `Verify: device` for the check they
will owe once built. `Verify:` means SHIPPED, so `next-item.js` filed them under KEEP — *done, a look
is owed* — and `DV-21` did not appear in Lane B's READY list at all. CLAUDE.md names this exact trap
and it was still walked into, because the field reads like a natural place to put a device check. The
fix is prose, and both entries now say outright why it is prose.

**`DV-6` is not reopened.** The pushed-route scrim is the same defect on a surface DV-6's fix never
reached: it is mounted once in `tab-shell.tsx`, which covers the five tab panels and nothing pushed
on top of them. The fix was scoped narrower than the defect — nothing regressed, so `DV-6` keeps its
shipped status and `DV-22` carries the gap.

**`DV-8` was not promoted, only retitled.** Thirty-six stuck rows over fourteen days is a live defect
rather than the curiosity its title described. It still sits below Lane A's auth work, because
nothing is lost — the server applied every one of these — and the cost is unbounded `pending` rows
and a status column that lies.

## Not done

Station A's VERIFIED rows are owed to `RV-156`: their `projectOverview.md` Known-Issues rows should
move to the archive, and have not. Until that happens the list overstates what is unverified, which
is the drift `RV-155` exists to fix. Recorded on `RV-155` rather than left implicit.
