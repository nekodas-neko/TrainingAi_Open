# The pillars audited against the connector guide's own invariant

**Filed:** 2026-09-15 · **Agent:** Tuning · **Entries:** TN-37 ·
**Owner:** *"we get data from Oura; then we normalise/calculate it into usable fields… then we use
those fields to calculate our pillars. Can we make sure we are doing this correctly?"*

**That architecture is already written down** — `docs/data-source-connector-guide.md`, §0 *"The model,
in two layers"* and §5 *"decode, normalize, then write"*. So the useful question is not *what should
it be* but **does the code hold the contract the guide says it holds.** It does at the input layer
and does not at the scoring layer.

---

## 1. The input layer is exactly what the owner described, and it works

`body_metrics` carries a per-field `source_map`, and `SOURCE_RANK`
(`packages/shared/src/health/source-rank.ts`) resolves collisions:
**`manual > scale_ble > oura_ble > oura_cloud > health_connect`**.

Measured over the last 30 days — **16 fields, two live sources, no collisions unresolved**:

| written by `oura_ble` | written by `scale_ble` |
|---|---|
| `hrv_ms`, `resting_heart_rate`, `spo2_pct`, `steps` (31 days each) | `weight_kg`, `body_fat_pct`, `fat_free_mass_kg`, `muscle_mass_kg`, `bone_mass_kg`, `body_water_pct`, `protein_pct`, `skeletal_muscle_pct`, `subcutaneous_fat_pct`, `visceral_fat_index`, `bmr_kcal`, `metabolic_age` (30 days each) |

**This half needs no work.** One rollup behind an I/O port, a CI rule against a second one, and a
ranked per-field merge. It is the design the owner is asking for, already built.

---

## 2. The scoring layer does not read only from it — and the guide claims it does

**§5.4 states the invariant outright:**

> *"Every calculation in §4 reads generic tables, never a device-specific one."*

**`lib/health/readiness-payload.ts:278-291` reads four device-specific stores in one
`Promise.all`**, alongside the two generic ones:

| read | layer |
|---|---|
| `listBodyMetrics` | ✅ normalised |
| `listSleepSessions` | ✅ normalised |
| `getOuraDaily` | ❌ Oura **Cloud** shape |
| `getOuraDailySummary` | ❌ Oura-specific |
| `getOuraDailyDerived` | ❌ Oura-specific |
| `getLatestOuraCloudVitals` | ❌ Oura **Cloud** |
| `getHrForWindow` | ❌ raw HR series |

**And `oura_daily_derived` is written by the Oura rollup and nothing else** — `rollup-io.ts:83` plus
one adapter mutation path. **No other source can reach it.**

**About twenty fields in the readiness payload come from those stores rather than the normalised
layer**, including `daySummary`, `temperatureDeviation`, `stressHigh`/`recoveryHigh`,
`recommendedBedtimeStart`/`End`, `vo2Max`, `vascularAge`, `readinessScore`, `sleepScore`,
`activityScore`, `steps`, `zoneMinutes` and every contributor block.

**So for those fields a non-Oura source is structurally invisible.** That is the owner's
*"consistency across multiple input sources"* question, made concrete: **the normalise layer exists
and the pillars reach past it.**

---

## 3. What the guide already knows, and what it does not

**§5.5 names one violation** — Health Connect's `HeartRateSeries` is read, used inline to enrich
`activity_logs`, then discarded instead of normalised into `oura_heartrate`. Filed as **PS-41**.
**That one is real and already tracked.**

**It does not name §2's.** The guide treats the HR-series gap as *"the concrete, fixable instance of
the general rule"* — singular. The readiness read path is a second instance, larger, and the one that
makes §5.4's sentence false as written.

**⚠ This is a contract-vs-code divergence, not a new architecture proposal.** The fix is to make the
sentence true or to amend it; it is not to redesign anything. The plan for the naming half already
exists (`2026-08-02-de-oura-naming.md`) and correctly refuses to start without its own plan, since
`oura_daily_derived` is one of six tables a rename would touch.

---

## 4. Two things that soften it, stated so the entry is not overread

**`oura_daily` is dead weight, not a live wrong value.** Rows exist through today, but every scored
column on the recent ones is **NULL** — the Cloud was retired 2026-08-13 and the rows are shells.
`cloudDailyLive` passes its `isPreRekey` guard and then finds nothing, so the fallbacks carry. **It
costs a query and a branch, not a wrong number.**

**Health Connect currently writes nothing.** Zero `health_connect` entries in `source_map` over 30
days. **So today the divergence has no victim** — it is a latent defect that fires the first time a
second source supplies a field the pillars take from the Oura path. That is an argument about when to
fix it, not whether.

---

## 5. Recommendation

**Do not redesign. Close the gap between the guide and the code, in three steps of rising cost.**

1. **Amend §5.4 to say what is true today** — the invariant holds for `body_metrics` and
   `sleep_sessions` and does not hold for the derived/score layer, with the readiness read list named.
   **A written invariant the code does not hold is worse than none**, because the next connector
   author will trust it. Docs-only, and it should not wait for 2 or 3.
2. **Drop the two dead Cloud reads** — `getOuraDaily` and `getLatestOuraCloudVitals` return nothing
   usable and are two of the four device-specific reads. Removing them shrinks the violation by half
   at no behavioural cost. **⚠ Verify the NULL-on-recent-rows finding still holds at the moment of the
   change** rather than trusting this review's snapshot.
3. **Then decide what the derived layer is.** Either it is app-computed and source-neutral — in which
   case the rename plan applies and any source should be able to contribute — or it is genuinely
   Oura-only, in which case **§4's calculation-input table should mark which pillars degrade without
   a ring**, which is what a future connector author actually needs to know. **⛔ Do not start 3
   without its own plan**; the naming plan already says so and it is right.

**⛔ Do not treat this as a reason to delay the connector registry** (`2026-09-14`, PS-40). That plan
is metadata over the existing ingest routes and is unaffected — if anything §2 strengthens its case,
since a `supplies` declaration is exactly what would have made this divergence visible without an
audit.
