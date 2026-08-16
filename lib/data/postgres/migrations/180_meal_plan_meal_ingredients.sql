-- Persist a planned meal's ingredients (Q-192). Plan: docs/superpowers/plans/2026-08-11-meal-plan.md
--
-- Phase 1 stored a name and four macro targets per meal. The ingredient breakdown — which the
-- generator produces, the review step shows, and the portion scaler sizes — lived only in the
-- unsaved draft and was discarded on save. The consequence the owner hit immediately: once a plan
-- is saved there is nothing to re-scale or re-render, so swapping one meal means rebuilding the
-- whole plan.
--
-- Stored as a denormalised JSONB snapshot rather than rows joined to food_items, for the same
-- reason meal name and macros are denormalised one table up: the offline mirror has to RENDER this
-- row, and a local table holding only foreign keys cannot (the food_logs -> food_items data-loss
-- bug). A snapshot also keeps a plan readable after a library item is edited or deleted, which is
-- what you want from a plan — it records what was prescribed, not what the library says today.
--
-- Shape matches NutritionIngredient / the food-scan schema exactly, so the same sumIngredients()
-- and scaleIngredientsToTargets() helpers apply with no conversion:
--   [{ name, weightG, caloriesPer100g, proteinPer100g, carbsPer100g, fatPer100g }]

ALTER TABLE meal_plan_meals ADD COLUMN IF NOT EXISTS ingredients JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The generator already computes a suggested time per meal from the training-time split; it had
-- nowhere to live, so a saved plan lost it and the meal list could not show when to eat.
ALTER TABLE meal_plan_meals ADD COLUMN IF NOT EXISTS suggested_time TEXT;
