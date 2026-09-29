# 2026-09-29 — RV-218 ②: "burned" meant two numbers; Nutrition's movement header now says "earned"

**Lane A · `components/nutrition/energy-card.tsx`, plus the e2e assertion.**

- **Traced:** both screens' "burned" TOTALS already come from `computeEnergyBalance`. Day's energy
  timeline spreads `restingBaseKcal + activeKcal` from the same `/api/nutrition/energy-balance`
  response Home prints as `expenditureKcal`. The collision was Nutrition's header, "+237 burned",
  which is only the movement earned today. The Day screen's "Burned 1,694" is the whole day.
- **Changed:** the header now reads "+N earned", matching the "N earned from movement" line
  below. Verified on the owner's snapshot on 09-28 ("+369 earned") with `pnpm dev`. The e2e spec's
  assertion is updated and exact.
- **Not changed:** the budget's resting anchor (measured RMR) against expenditure's `restingBaseKcal`.
  That is BF-152's deliberate choice and part of the owner's LA-180 answer (RV-218 ①).
