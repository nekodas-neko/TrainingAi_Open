-- #2120 — account deletion. A `DELETE FROM users` has to succeed for every account, and on main it
-- does not: two foreign keys refuse it. Measured on a fresh database with every migration applied:
--
--   a user with a custom exercise  → exercise_library_created_by_fkey   (NO ACTION, on users)
--   a user with a saved meal       → saved_meal_items_food_item_id_fkey (RESTRICT, on food_items)
--
-- The second sits INSIDE the cascade: deleting the user cascades to both `food_items` and
-- `saved_meals`, and the RESTRICT check on `food_items` fires before the cascade through
-- `saved_meals` has removed the items that point at it. `food_logs` carries the same two RESTRICTs
-- (food_item_id, meal_type_id) and happens to pass today only because of the order Postgres fires the
-- cascade triggers in. An order is not a guarantee, so all three change together.
--
-- What changes, and nothing else:
--   1. exercise_library.created_by → ON DELETE SET NULL. A custom exercise is already in the shared
--      catalogue every account reads, and other accounts' programs and logs may name it; after its
--      author is deleted it is a catalogue row with no author, the same state every seeded row is in.
--   2. The three RESTRICTs → NO ACTION DEFERRABLE INITIALLY IMMEDIATE. For every statement that does
--      not ask for deferral this is the same refusal as before, checked at the end of the statement,
--      so a lone `DELETE FROM food_items` or `meal_types` that still has referencing rows is still
--      refused (the meal_types soft-delete comment in schema.ts relies on that). Only the
--      account-deletion transaction runs `SET CONSTRAINTS ALL DEFERRED`, which moves the check to its
--      COMMIT, after the whole cascade. A reference that survives to COMMIT (another account's row
--      pointing at this one's) still fails the deletion and rolls it back, rather than deleting it.
--
-- Each FK is found by its column, not its name, so a production constraint created under another
-- name is replaced too. Replay-safe: the second run drops and re-adds the same four constraints.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname, cl.relname
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND cardinality(con.conkey) = 1
      AND cl.relnamespace = 'public'::regnamespace
      AND (cl.relname, a.attname) IN (
        ('exercise_library', 'created_by'),
        ('saved_meal_items', 'food_item_id'),
        ('food_logs', 'food_item_id'),
        ('food_logs', 'meal_type_id')
      )
  LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.relname, r.conname);
  END LOOP;
END $$;

ALTER TABLE exercise_library ADD CONSTRAINT exercise_library_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE saved_meal_items ADD CONSTRAINT saved_meal_items_food_item_id_fkey
  FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE food_logs ADD CONSTRAINT food_logs_food_item_id_fkey
  FOREIGN KEY (food_item_id) REFERENCES food_items(id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE food_logs ADD CONSTRAINT food_logs_meal_type_id_fkey
  FOREIGN KEY (meal_type_id) REFERENCES meal_types(id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
