-- AI Coach conversation history.
--
-- The owner asked for persistence "if it's not too resource intense", so the two halves are built
-- separately and priced separately. The valuable half — applied changes — already exists as
-- `coach_changes` (migration 170) and costs nothing extra to list. This is the expensive half:
-- message rows that grow with use for a surface that may be opened rarely.
--
-- Hence the 30-day window, pruned on write. There is no cron layer in this app (docs/module-map.md
-- §0), so a scheduled job is not available and a prune that only runs when someone is already
-- writing is the honest design rather than a compromise.
CREATE TABLE IF NOT EXISTS coach_threads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- First user message, trimmed. Enough to recognise a conversation in a list.
  title       TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stores whole UI message **parts**, not just text. A thread rehydrated without its parts loses
-- its widgets, which would make the scrollback a lie about what actually happened.
CREATE TABLE IF NOT EXISTS coach_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES coach_threads(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  parts       JSONB NOT NULL DEFAULT '[]'::jsonb,
  position    INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (thread_id, position)
);

CREATE INDEX IF NOT EXISTS coach_threads_user_updated_idx
  ON coach_threads (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS coach_messages_thread_position_idx
  ON coach_messages (thread_id, position);
