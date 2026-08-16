-- Migration 079: AI Dynamic Periodization
-- Adds training_goal + auto_apply_prescriptions to programs,
-- time_budget_minutes to program_sessions,
-- program_session_id FK to workout_sessions (for prescription trigger linkage),
-- and creates session_periodization + program_volume_targets tables.

-- programs: training goal and auto-apply preference
ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS training_goal TEXT NOT NULL DEFAULT 'strength',
  ADD COLUMN IF NOT EXISTS auto_apply_prescriptions BOOLEAN NOT NULL DEFAULT FALSE;

-- program_sessions: time budget per session type
ALTER TABLE program_sessions
  ADD COLUMN IF NOT EXISTS time_budget_minutes INTEGER NOT NULL DEFAULT 60;

-- workout_sessions: FK to program_session for prescription trigger linkage
-- Nullable for historical rows that pre-date this migration.
ALTER TABLE workout_sessions
  ADD COLUMN IF NOT EXISTS program_session_id UUID REFERENCES program_sessions(id) ON DELETE SET NULL;

-- Per user × program session: phase state and current AI prescription
CREATE TABLE IF NOT EXISTS session_periodization (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_session_id          UUID NOT NULL REFERENCES program_sessions(id) ON DELETE CASCADE,

  -- Phase state
  phase                       TEXT NOT NULL DEFAULT 'baseline',
  -- 'baseline' | 'accumulation' | 'intensification' | 'realisation' | 'deload'
  phase_started_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sessions_in_phase           INTEGER NOT NULL DEFAULT 0,
  baseline_complete           BOOLEAN NOT NULL DEFAULT FALSE,
  baseline_1rm                JSONB NOT NULL DEFAULT '{}',
  -- Keys: session_exercises.id (UUID). Values: { kg: number, source: "amrap" | "personal_record" }

  -- Current prescription (for the NEXT session of this type)
  prescription                    JSONB,
  prescription_generated_at       TIMESTAMPTZ,
  prescription_expires_at         TIMESTAMPTZ,
  prescription_status             TEXT NOT NULL DEFAULT 'none',
  -- 'none' | 'pending' | 'accepted' | 'auto_applied' | 'dismissed' | 'consumed'
  last_session_ran_prescription   BOOLEAN,

  -- Pending phase transition recommendation
  pending_transition              JSONB,
  -- { newPhase, reasoning, urgency } or null

  -- Emergency deload: phase to return to after deload resolves
  pre_emergency_deload_phase      TEXT,

  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, program_session_id)
);

-- Weekly volume targets per program per muscle group
CREATE TABLE IF NOT EXISTS program_volume_targets (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id            UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  muscle_group          TEXT NOT NULL,
  target_sets_per_week  INTEGER NOT NULL,
  UNIQUE(program_id, muscle_group)
);
