-- Q-396 — a small photo per saved meal, so a meal built weeks ago is recognisable from more than
-- its name.
--
-- **Stored as a base64 `data:` URI in a text column, and that is deliberate rather than lazy.** The
-- app is offline-first with no blob host, and a URL renders nothing in airplane mode — which breaks
-- the standing rule that a local table must hold everything needed to render its row offline. A
-- capped data URI is the only shape that survives the canonical runtime.
--
-- **The cap is the whole design.** `users.avatar` is the visible precedent and it does NOT transfer:
-- an avatar is one row per user and never enters the sync delta, so its 5 MB ceiling costs nothing.
-- A meal thumbnail is one per saved meal and saved meals **sync** — every image rides the outbox
-- push, the pull delta and the on-device SQLite mirror, on a phone, forever. Copying 5 MB here would
-- be the largest single regression the sync engine has taken. The ceiling is 16 KB, enforced in code
-- (`SAVED_MEAL_IMAGE_MAX_BYTES`), and nothing fails loudly if it slips: the outbox just gets slower
-- and the first symptom is a sync timing out on a bad connection.

ALTER TABLE saved_meals ADD COLUMN IF NOT EXISTS image_data_uri text;
