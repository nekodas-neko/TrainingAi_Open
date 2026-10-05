# 2026-09-29 — BF-199 Phase 1: every model prescription is recorded beside the rules prescriber's

**Lane A · migration `202609291131_prescription_shadow.sql` (new table) · `claude_ro` view regenerated.**

- **What:** `packages/shared/src/ai-periodization/prescription-shadow.ts` →
  `buildPrescriptionShadow`. `generatePrescriptionForSession` captures the model's raw phase and
  action before reconciliation, and after `storePrescription` writes one `prescription_shadow` row
  pairing each given exercise with `buildRulesPrescription`'s, by id. It is best-effort (an async
  wrapper with a catch), so it can never cost a plan. It is excluded from the user data export as
  ops evidence, like `ai_call_log`.
- **First real sample** (`pnpm dev`, owner snapshot, Push, one real model call): rest 209 / 141 /
  97 / 113 s given against the style's 120 / 75 / 60; the rules path had nothing for the styleless
  Cable Chest Dips; and **the model's prose said it had excluded Dumbbell Fly while its numbers
  included it**.
- **Tests:** a builder unit test, a real-Postgres write test, the prescription suites (173), the
  claude_ro role and snapshot suites (34 run, none skipped), the views-file test, the
  test-typecheck, and Custom Rules.
- **Owed:** the two-week read (BF-199 `Keep:`), from 2026-10-13, which unblocks BF-199b.
