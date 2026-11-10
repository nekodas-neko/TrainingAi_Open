-- #2300 (PR 1 of 3): a trainer is a relationship between two users, not a property of one.
--
-- `trainer_relationships` is the friendship handshake (`friendships`) with a direction that
-- matters: the trainer requests, the trainee accepts, either party can revoke. `(A trains B)` and
-- `(B trains A)` are two different rows. `isAdmin` is not involved anywhere.
--
-- `trainer_program_assignments` records which program a trainer built for which trainee, so a
-- trainee can see where a program came from and a trainer can list what they assigned. The program
-- itself is an ordinary row in the TRAINEE's account (the trainee owns everything it depends on),
-- so this table is provenance only: deleting a program, or revoking the relationship, never
-- changes the program.
--
-- Shipped alone (CLAUDE.md: a migration never rides in a batch with anything else), and the owner
-- reviews it first: this is authorization groundwork. Nothing reads or writes either table until
-- the routes PR.
--
-- Add-only: two new empty tables, no column added to an existing table, so there is nothing to
-- default, make nullable or backfill, and no existing row is touched. The defaults below are on the
-- new tables' own id and timestamp columns, matching `friendships`.
--
-- The status CHECK fails closed: a value outside the three states cannot be written by any code
-- path, including a buggy one. A user training themself is refused in the slice and the guard, not
-- by a CHECK: the shared every-user-table fixture (account-deletion test) fills both user columns
-- of a table with the same account, and `friendships` has no such CHECK either.
--
-- REVERSE (drops only what these tables hold; nothing else references them):
--   DROP VIEW IF EXISTS claude_ro.trainer_program_assignments; DROP VIEW IF EXISTS claude_ro.trainer_relationships;
--   DROP TABLE IF EXISTS trainer_program_assignments; DROP TABLE IF EXISTS trainer_relationships;
--   (the views select from the tables, so the DROP TABLEs fail without the DROP VIEWs; the boot
--   rebuild recreates the claude_ro views from claude-ro-views.sql)

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE TABLE IF NOT EXISTS trainer_relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trainee_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trainer_relationships_pair_key UNIQUE (trainer_id, trainee_id),
  CONSTRAINT trainer_relationships_status_check CHECK (status IN ('pending', 'accepted', 'revoked'))
);

-- "Who trains me" and "who do I train" are both looked up by one party; the unique index above
-- already serves the trainer side.
CREATE INDEX IF NOT EXISTS trainer_relationships_trainee_idx ON trainer_relationships (trainee_id);

CREATE TABLE IF NOT EXISTS trainer_program_assignments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id  uuid NOT NULL REFERENCES trainer_relationships(id) ON DELETE CASCADE,
  program_id       uuid NOT NULL UNIQUE REFERENCES programs(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trainer_program_assignments_relationship_idx
  ON trainer_program_assignments (relationship_id);
