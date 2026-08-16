ALTER TABLE users ADD COLUMN IF NOT EXISTS food_region TEXT NOT NULL DEFAULT 'AU';

CREATE TABLE IF NOT EXISTS meal_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  emoji           TEXT NOT NULL DEFAULT '🍽️',
  sort_order      INTEGER NOT NULL DEFAULT 0,
  time_start_hour INTEGER NOT NULL DEFAULT 0,
  time_end_hour   INTEGER NOT NULL DEFAULT 24,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_items (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  brand          TEXT,
  serving_size_g DOUBLE PRECISION NOT NULL DEFAULT 100,
  calories       INTEGER NOT NULL,
  protein_g      DOUBLE PRECISION NOT NULL DEFAULT 0,
  carbs_g        DOUBLE PRECISION NOT NULL DEFAULT 0,
  fat_g          DOUBLE PRECISION NOT NULL DEFAULT 0,
  fiber_g        DOUBLE PRECISION,
  sugar_g        DOUBLE PRECISION,
  sodium_mg      DOUBLE PRECISION,
  sat_fat_g      DOUBLE PRECISION,
  source         TEXT NOT NULL CHECK (source IN ('ai', 'barcode', 'manual', 'text')),
  barcode        TEXT,
  region         TEXT NOT NULL DEFAULT 'AU',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS food_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date                TEXT NOT NULL,
  meal_type_id        UUID NOT NULL REFERENCES meal_types(id) ON DELETE RESTRICT,
  food_item_id        UUID NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  logged_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs(user_id, date DESC);

CREATE TABLE IF NOT EXISTS saved_meals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_meal_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saved_meal_id       UUID NOT NULL REFERENCES saved_meals(id) ON DELETE CASCADE,
  food_item_id        UUID NOT NULL REFERENCES food_items(id) ON DELETE RESTRICT,
  quantity_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0
);

CREATE TABLE IF NOT EXISTS nutrition_targets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  calories   INTEGER,
  protein_g  DOUBLE PRECISION,
  carbs_g    DOUBLE PRECISION,
  fat_g      DOUBLE PRECISION,
  fiber_g    DOUBLE PRECISION,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
