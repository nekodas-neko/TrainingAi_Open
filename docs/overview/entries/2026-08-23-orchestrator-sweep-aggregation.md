## Orchestrator sweep 2 — aggregation, and two entries that were the same investigation (2026-08-23)

The queue held **201 entries and 2 `Batch:` slugs**, both seeds from when the field was invented.
This assigns the first real batch, sets the lanes that batch needed, and converts three prose
blockers into `Needs:` fields.

### The batch: `ring-service-device-pass` — Q-537 · Q-533 · Q-388

Three changes under `android/…/oura/`. Batched because **the axis is what one verification pass
covers, and this is one APK and one sitting with the ring**: reveal the stored key and confirm the
`clearKey` warning (Q-537), start a full re-sync and confirm the completion notification arrives
(Q-533), and let Q-388's battery telemetry accrue on that same install over the following days.
Separately they are three APK cycles, which `CLAUDE.md` names as the most expensive verification the
owner performs.

**Q-537 is why the batch is worth assembling.** It is the mitigation for the hazard that makes APK
delivery costly at all — an install that cannot upgrade in place forces an uninstall, and an
uninstall destroys the only copy of the ring key. Batching two more Kotlin changes onto that APK is
free; shipping the key backup late is not.

**Q-388 alone survives its own batch, and that is stated in the entry rather than left to be
discovered.** The PR ships its two do-regardless items — resetting `EXERCISE_HR` and fast-HR mode in
the connect-time sequence, and persisting the battery poll. Its SpO₂ question is a decision waiting
on the A/B that persisting the poll makes measurable at all. A batch normally closes every member;
this one does not, because the alternative is a second APK cycle for a five-line change.

### Q-116 and Q-388 are the same investigation, filed 11 days apart

Neither entry referenced the other. Q-116 (2026-08-06): a live HR reading on the Health tab with
nobody having tapped *Measure now*, suspected to explain ~15%/night of ring drain. Q-388
(2026-08-17): the owner reporting ~20% overnight, roughly 3.5× stock.

**Q-388's "separate latent defect, found while tracing" is Q-116's second leak vector, pinned to a
line.** `reqBleFastHrMode(false)` and `EXERCISE_HR → AUTOMATIC` appear only in `liveHrStopSequence()`,
so any live-HR session that never reaches `stopLiveHr()` leaves continuous fast-HR sampling on
permanently — healed by no reconnect, restart or service restart. Q-388 traced Q-116's suspected
cause without knowing Q-116 existed.

They are cross-linked rather than merged, and **Q-116 now carries `Needs: Q-388`**. Q-388's batch
closes that vector and persists the telemetry, so Q-116's diagnostic capture is worth running
*after* that APK and not before: if the leak is gone, what remains is the other two vectors, and if
it is not, there is finally a number to argue with. They stay separate because Q-116's leading
vector is a stale persisted Zustand workout store — Lane B — while Q-388 is Kotlin. That is also why
Q-116 still carries no `Lane:`; the diagnostic is what decides who owns the fix.

### Three prose blockers became fields

Each of these read as READY under `scripts/next-item.js` while saying in its own body that it was
not. An implementer had to reach the bottom of the entry to find out.

| entry | now | the blocker, in its own words |
|---|---|---|
| Q-184 | `Needs: Q-204` | *"hold Q-184 behind Q-270 and Q-204"* |
| Q-204 | `Needs: Q-270` | Gate 1 FAILED — `training_load_ots` is empty |
| Q-116 | `Needs: Q-388` | (new — see above) |

**Q-184 and Q-204 both quoted "0 of 42 days".** Re-measured 2026-08-20 during sweep 1, both columns
are 0 of **96** — 54 further days have changed nothing, and Q-270 has since been reopened 🔴 because
the fix that was meant to start populating one of them did not take. Both counts are now dated.

`READY` drops 165 → 162 and `PARKED` rises 30 → 33 as a result, which is the whole point: three
entries stopped advertising themselves as startable.

### Lanes, because a batch cannot mix them

Q-537, Q-533, Q-388, Q-114 and Q-104 carried **no `Lane:` field at all**, so each appeared in both
lanes' queues. All five are `android/**`, which `docs/agents/README.md` §3 puts in Lane A without
ambiguity. The existing `scale-weighing-ui` batch (Q-114, Q-104) had the same gap and now has a lane.

### One correction to a measurement I made mid-sweep

A first pass counted **56 "native" entries** by matching any mention of APK, Capacitor or "native".
Read properly, that collapses to about 20 that genuinely require a Kotlin change — and one of the
first candidates, **Q-538, is not native at all**: it declares Lane B and calls plugin-bridge methods
Lane A already shipped. A grep for the word is not a measurement of the work.

### Verification

`pnpm check:rules` — **51 of 51**. `check-backlog-pointers` — 201 entries, batches now
`calorie-budget-surface×2, ring-service-device-pass×3, scale-weighing-ui×2`, 9 `Needs:` with no
cycles and every target known.

**Nothing reordered.** No entry changed queue position. Batching does pull Q-533 and Q-388 forward
in practice, since a batch ships when its first member is reached — 15 places in a 201-entry queue.

**Not exercised:** nothing here touched the app. No runtime, no device, no version bump.
