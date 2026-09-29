-- BF-199 Phase 1. One row per model-generated prescription: the numbers the lifter was given
-- beside the numbers the rules prescriber would have produced, plus the model's phase before and
-- after reconciliation. Read by a db-query summary; nothing in the app decides anything from it.
-- Plan: docs/superpowers/plans/2026-09-29-rules-prescription-engine.md.
CREATE TABLE IF NOT EXISTS prescription_shadow (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_session_id uuid REFERENCES program_sessions(id) ON DELETE SET NULL,
  model_phase        text NOT NULL,
  model_phase_action text NOT NULL,
  final_phase        text NOT NULL,
  final_phase_action text NOT NULL,
  rows               jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prescription_shadow_user_created_idx ON prescription_shadow (user_id, created_at);
