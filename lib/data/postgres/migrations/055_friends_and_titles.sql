-- Add friend_code and equipped_title to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS equipped_title text;

-- Generate TAI-XXXX codes for existing users that don't have one
DO $$
DECLARE
  r RECORD;
  code text;
  attempts int;
BEGIN
  FOR r IN SELECT id FROM users WHERE friend_code IS NULL LOOP
    attempts := 0;
    LOOP
      code := 'TAI-' || upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 4));
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE friend_code = code);
      attempts := attempts + 1;
      IF attempts > 100 THEN
        RAISE EXCEPTION 'Could not generate unique friend code after 100 attempts';
      END IF;
    END LOOP;
    UPDATE users SET friend_code = code WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE users ADD CONSTRAINT users_friend_code_unique UNIQUE (friend_code);

-- Friend connections
CREATE TABLE IF NOT EXISTS friendships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       text NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (requester_id, addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx ON friendships(addressee_id);
CREATE INDEX IF NOT EXISTS friendships_requester_idx ON friendships(requester_id);

-- Season snapshots
CREATE TABLE IF NOT EXISTS seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label      text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL
);

CREATE TABLE IF NOT EXISTS season_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id   uuid NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank        int NOT NULL,
  sessions    int NOT NULL DEFAULT 0,
  volume_kg   float NOT NULL DEFAULT 0,
  badge_label text NOT NULL CHECK (badge_label IN ('Gold', 'Silver', 'Bronze')),
  UNIQUE (season_id, user_id)
);
