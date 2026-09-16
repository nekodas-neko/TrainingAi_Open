# 2026-09-16 — Lane A · TN-37: the connector guide now describes the code, and step 2 was wrong

**Branch:** `lane-a/tn37-connector-guide-invariant` · docs-only · no version bump

TN-37 said §5.4 of the connector guide states an invariant the pillars do not hold, and gave three
steps. **Step 1 shipped. Step 2 turned out to be a regression waiting to happen**, and the entry's own
instruction is what caught it.

## Step 1 — §5.4 says what is true now

It claimed *"Every calculation in §4 reads generic tables, never a device-specific one."* The
**formulas** hold that; the **assembly that feeds them** does not. `readiness-payload.ts` reads seven
stores in one `Promise.all` and four are device-specific, supplying about twenty payload fields for
which a non-Oura source is structurally invisible.

§5.4 now carries the read list and what each store contributes. §5.5 is corrected too: it called
PS-41 *"the concrete, fixable instance"* — singular — of the general rule. It is **a** concrete
instance, and now says so.

## Step 2 — corrected, and this is the part worth reading

The entry said: *"Drop the two dead Cloud reads — `getOuraDaily` and `getLatestOuraCloudVitals`
return nothing usable."* It also carried a ⚠ to **re-verify the NULL-on-recent-rows finding at the
time of the change rather than trusting the snapshot**. Doing exactly that is what caught it.

**`getOuraDaily` is not dead.** The snapshot was right about what it measured — every *Cloud-scored*
column is NULL, 35 of 35 rows since 2026-08-14: readiness, sleep, activity, temperature deviation,
VO₂ max, vascular age, stress/recovery high, day summary, bedtime. But **`non_wear_time_sec` is
populated on 35 of 35**, written by the BLE rollup's wear step — and `readiness-payload.ts:329,341`
feeds it to `excludeLowWearDays` for the **HRV and RHR baselines**. Dropping the read would have
silently disabled wear filtering on two baselines: a scoring change, and one that nothing in the
test suite would have caught.

**`getLatestOuraCloudVitals` is a deliberate stale surface**, not a dead read — it supplies `vo2Max`,
`vascularAge` and `cloudVitalsDate`, which the UI renders *"as of `cloudVitalsDate`"*. Dropping it
removes those fields outright.

So step 2 is now a ⛔ in the entry rather than a task, with the measurement attached.

**The generalisable mistake:** *"every scored column is NULL"* is not *"the table is dead"*. The
original audit read the columns it cared about and concluded the table was a shell; it has a live
writer for a column the audit wasn't looking at. **Check for a live writer before calling a read
dead.**

## Step 3 unchanged

Deciding what the derived layer *is* — app-computed and source-neutral, or genuinely Oura-only —
still needs its own plan, as the entry and `2026-08-02-de-oura-naming.md` both say. Not started.

## Verification

Docs-only: no code changed, so `pnpm test` and the gates are unchanged from the merge base.
`check:rules` **75 of 75**, `check-backlog-pointers` OK.

Every production figure is the owner's rows only (`claude_ro` is row-scoped) and comes from the admin
read endpoint. **Not exercised:** nothing was run — no device, no rollup, no authenticated request.
The claim that `excludeLowWearDays` would lose its input is read from the call sites, not observed by
removing the read.
