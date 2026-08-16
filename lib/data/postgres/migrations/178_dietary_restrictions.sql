-- Dietary restrictions (Q-186, decision D8). Plan: docs/superpowers/plans/2026-08-11-meal-plan.md
--
-- A searchable structured picker, not free text. The owner asked to move away from a text box, and
-- a generator that suggests something you cannot eat is the first way this feature loses trust.
--
-- Stored per USER, not per plan. An allergy is a property of the person; putting it on the plan
-- means the next plan silently forgets it, which is the worst available failure here. The plan
-- keeps a snapshot (meal_plans.restrictions_snapshot) purely so an old plan can explain itself.
--
-- IMPORTANT, and the UI must honour it: capturing this reliably does NOT make an LLM's filtering
-- reliable. Nothing downstream may present this as a guaranteed allergen filter, and no automatic
-- action may depend on the model having respected it.

CREATE TABLE IF NOT EXISTS dietary_restrictions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referenced by code everywhere, never by label. Labels are display text and may be corrected;
  -- resolving a seeded row by name at migration run time is how the 042->047 fix chain happened.
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN ('allergen', 'diet_pattern', 'dislike')),
  -- Search matches label AND synonyms, so "milk" finds Lactose and "shellfish" finds Crustacean.
  synonyms   JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS dietary_restrictions_category_idx
  ON dietary_restrictions (category, sort_order);

CREATE TABLE IF NOT EXISTS user_dietary_restrictions (
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restriction_id UUID NOT NULL REFERENCES dietary_restrictions(id) ON DELETE CASCADE,
  -- 'allergy' items are rendered back on the plan review step as an explicit "must not contain"
  -- list, so that accepting the plan is itself the check.
  severity       TEXT NOT NULL DEFAULT 'avoid' CHECK (severity IN ('avoid', 'allergy')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, restriction_id)
);

-- Seed. Idempotent and keyed on `code`, so re-running is a no-op and a later label correction ships
-- as its own explicit UPDATE ... WHERE migration rather than being silently skipped here.
-- ON CONFLICT DO NOTHING only governs fresh rows: it will never correct a drifted production row.
INSERT INTO dietary_restrictions (code, label, category, synonyms, sort_order) VALUES
  ('peanut',      'Peanuts',        'allergen',     '["groundnut","peanut butter"]'::jsonb,               10),
  ('tree_nut',    'Tree nuts',      'allergen',     '["almond","cashew","walnut","pecan","pistachio"]'::jsonb, 20),
  ('milk',        'Dairy',          'allergen',     '["milk","lactose","cheese","yoghurt","yogurt"]'::jsonb,   30),
  ('egg',         'Eggs',           'allergen',     '["egg white","egg yolk"]'::jsonb,                     40),
  ('fish',        'Fish',           'allergen',     '["salmon","tuna","cod","seafood"]'::jsonb,            50),
  ('crustacean',  'Shellfish',      'allergen',     '["prawn","shrimp","crab","lobster","seafood"]'::jsonb, 60),
  ('soy',         'Soy',            'allergen',     '["soya","tofu","edamame","soybean"]'::jsonb,          70),
  ('wheat',       'Wheat / gluten', 'allergen',     '["gluten","bread","pasta","coeliac","celiac"]'::jsonb, 80),
  ('sesame',      'Sesame',         'allergen',     '["tahini","hummus"]'::jsonb,                          90),
  ('vegetarian',  'Vegetarian',     'diet_pattern', '["no meat"]'::jsonb,                                 110),
  ('vegan',       'Vegan',          'diet_pattern', '["plant based","no animal products"]'::jsonb,        120),
  ('pescatarian', 'Pescatarian',    'diet_pattern', '["fish only"]'::jsonb,                               130),
  ('halal',       'Halal',          'diet_pattern', '["no pork","no alcohol"]'::jsonb,                    140),
  ('kosher',      'Kosher',         'diet_pattern', '[]'::jsonb,                                          150),
  ('no_pork',     'No pork',        'dislike',      '["bacon","ham","pig"]'::jsonb,                       210),
  ('no_beef',     'No beef',        'dislike',      '["steak","mince","cow"]'::jsonb,                     220),
  ('no_lamb',     'No lamb',        'dislike',      '["mutton"]'::jsonb,                                  230),
  ('no_offal',    'No offal',       'dislike',      '["liver","kidney","organ meat"]'::jsonb,             240),
  ('no_mushroom', 'No mushrooms',   'dislike',      '["fungi"]'::jsonb,                                   250),
  ('no_onion',    'No onion',       'dislike',      '["shallot","spring onion"]'::jsonb,                  260),
  ('no_spicy',    'No spicy food',  'dislike',      '["chilli","chili","hot"]'::jsonb,                    270)
ON CONFLICT (code) DO NOTHING;
