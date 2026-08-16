## 2026-07-23 — D0 CLOSED: historical step backfill executed by owner

**Branch:** `claude/oura-ondevice-hybrid-5xycdr`. Docs-only — records the final step of D0
(`step_counter` as the ring's primary daily-steps source). No code change.

### What happened
The owner reviewed the preview (`/admin/oura-ble` → "D0 historical step backfill" → **Preview
backfill**): **14 days would change, total steps 223,191 → 73,055**. Sanity-checked and approved —
notably the day the fix shipped on (2026-07-23) barely moved (4625 → 4639), while every pre-fix day
dropped substantially, which is exactly the signature a correct fix should produce (the old flat-30
estimate could only over-count, never under-count). No `manual`-sourced day appeared in the list.

The owner tapped **Run backfill now** and confirmed the destructive-action dialog. The run took
several minutes (the redecode route reuses the existing full-history `redecodeOuraRawSamples` +
`aggregateOuraRawSamples(fullHistory:true)` path — noted as a known, accepted tradeoff at build time:
correctness and infra reuse over speed for a one-time run) and completed successfully. **Preview
backfill re-run afterward confirmed 0 days remaining.**

### D0 exit criteria — all met
- [x] Daily steps come from `step_counter` (not the flat-30 estimate).
- [x] History backfilled.
- [x] On-device totals confirmed sane (owner's counted 100-step walk matched a ≈99.3-step model burst).
- [x] Historical inflated days corrected (14 days, 223,191 → 73,055 total steps), owner-confirmed and
      executed.

**D0 is fully closed.** No further action needed on it.

### Noted for later (not blocking, not actioned)
The `?allowStepsDecrease=1` redecode route is heavier than a steps-only fix strictly needs (it also
re-derives `decoded` for the whole `oura_raw_samples` table and reprocesses sleep/HR/temperature/
resilience for full history) — a deliberate infra-reuse tradeoff at build time, confirmed to work but
slow (several minutes for ~484k raw rows / ~16 days). Worth a dedicated lightweight steps-only backfill
endpoint if this needs to run again for another reason, but not a current priority — D0 doesn't need it
again.
