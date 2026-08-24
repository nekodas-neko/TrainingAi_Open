# Two queue corrections: Q-302 is already fixed, Q-306 is blocked in prose only

**Branch:** `docs/queue-corrections-tdee-deload` · **Lane B** · docs-only

Both came out of the standing "re-verify the entry's premise before writing code" pass. Neither
needed code; recording why is the deliverable.

## Q-302 — removed, the defect is fixed on `main`

The entry: *"adaptive TDEE has not fired once in 30 days, and nothing tells the user why."* It asked
for copy along the lines of *"Adaptive TDEE needs 10 logged days in a fortnight — you have 4. Log 6
more to switch it on."*

That message ships. `maintenanceGapMessage` (`packages/shared/src/nutrition/adaptive-tdee.ts:188`)
produces it per `excludedReason`, and `calorie-balance-bar.tsx:98` renders it whenever
`maintenance.source === 'formula'` — no drift condition, no dismissal, on both the Nutrition tab and
Health. `tdee-adaptation-card.tsx`'s explain state carries it too. All of it arrived with **Q-401**,
after this entry was filed.

Driven against `pnpm dev` as the seeded user, whose food logging is sparse enough to keep the gate
shut:

```
GET /api/nutrition/energy-balance
  maintenance: { kcal: 2197, source: "formula", daysLogged: 0, daysInWindow: 14,
                 gapMessage: "Log food on 10 more days to calibrate" }

/nutrition, on screen:
  Estimated maintenance 2,197 kcal — Log food on 10 more days to calibrate.
```

The entry's own instruction — *"Check first what the card currently renders… it may already show
something, in which case this is a copy change rather than a new state"* — is what found this.

**One residual nit, handed to Lane A rather than kept here.** The line says *"Log food on 10 more
days"* without naming the window, so it can be read as any ten days rather than ten within the
fortnight. That string lives in `packages/shared/`, which is Lane A's, and it is a one-line copy
change on a message four surfaces read. Not worth a Lane B entry; noted here so it is not lost.

## Q-306 — `Needs: Q-289` added

The entry says twice, in prose, that the threshold must be re-derived *after* Q-289's calibration
lands and that it *"is blocked on Q-289"*. `Needs:` is the field the tooling reads, and it was
absent — so `next-item.js` kept offering a blocked entry as READY. It now parks with its reason
visible.

Nothing else changed. Its second issue (the three uncoordinated ACWR thresholds) shipped on
2026-08-24 and its `Keep:` line already records what is left.
