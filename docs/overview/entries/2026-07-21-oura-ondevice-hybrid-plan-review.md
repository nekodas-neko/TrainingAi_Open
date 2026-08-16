## 2026-07-21 — Oura on-device + own-analysis master plan: 4-lens adversarial review + fixes (docs-only)

Follow-up to the data-requirements map + master plan (PR #733). Ran **four parallel adversarial reviews**
(metric/model parity · offline-first & performance · data-loss & durability · rule-compliance & sequencing),
folding in the owner's three concerns: (1) is now the time for the APK-first/Railway-as-sync move + how does
it perform without API calls; (2) are we SURE we own an equivalent for every Oura-ML metric *before*
deprecating; (3) this touches offline + Oura models + storage, so review it well. **Docs-only — no code, no
migration, no data.**

**Verdict:** architecture sound, no CRITICAL data-loss (D4 drop properly gated), but the draft was **not yet
correctly sequenced** for "build once, build right." Added a "Review Outcome" block to the master plan
capturing the findings + corrections; the material fixes:
- **Neural-port inversion (headline).** Phase-1 ports **dHRV** to device WASM (a model D5 deletes) and omits
  **step_counter** (the model D7 keeps) → after the D3 read-flip, steps would regress to the flat-30
  heuristic the D0 fix addressed. **Reordered: D6→D5 (own daytime-HRV, validated on Polar H10 not dHRV) →
  D2 (SleepNet + step_counter WASM, dHRV-free).**
- **CSP blocker (perf review).** Prod `script-src` has no `wasm-unsafe-eval` → `onnxruntime-web` blocked in
  the WebView; the parity test runs under Node (no CSP) so it false-greens. Added as a D2 Task-0 prereq.
- **Migration numbers:** 136 → **130 + 137** (per Phase-2's allocation; 136 was already claimed — the draft
  re-introduced the R7 collision).
- **Enforceable D1→D4 gate:** the ordering was prose-only; the D4 drop must be gated on all six forms in
  `SyncDelta` + a device-verified restore-proof artifact by SHA + `oura_raw.db` own-reconcile + a
  full-date-range completeness audit (fail-closed). D4 now needs **D1+D2+D3** (D3 hard precondition).
- **D3 read-flip** gates on a data-presence check (not just plugin-availability) + a stated rollback posture.
- Parity nuances recorded in the map: illness is a coarser heuristic than Oura's CNN (no regression — CNN
  never ran); awake-HR gap-filling is **declined, not replaced**.

**Owner's concern #2 answer:** deprecation is **safe as sequenced** — every dormant Oura ONNX never fed a
displayed value (zero live loss at D7); the one wired oracle (dHRV) is a real build (D5) gated behind
validation before deletion. For temp/HRV/RHR/respiratory/illness/chronic-stress/energy we own + wire
equivalents on equivalent inputs.

**Verification:** docs-only; nothing to device-verify in this PR. No owner decision blocks the plan revision
(all fixes are engineering corrections; the destructive D4 drop stays owner-confirm at implementation time).
No version bump.
