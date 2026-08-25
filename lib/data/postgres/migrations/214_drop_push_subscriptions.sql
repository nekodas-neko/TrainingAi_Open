-- Q-285: the web-push stack had no senders and no subscribers. `sendPushToUser`'s only caller was
-- the test route, and `push_subscriptions` held 0 rows on 2026-08-15 and still 0 rows eight days
-- later. The owner decided to delete it rather than wire it (2026-08-24), after Q-286 — the one
-- consumer it might have served — turned out to be already delivered by native local notifications.
--
-- This is a data-dropping migration. It is safe here for a reason that must NOT be generalised:
-- the table is EMPTY in production and cannot refill, because the subscribe route and the client
-- that called it are deleted in the same change.

-- The claude_ro view depends on the table, so it goes first. Dropped BY NAME rather than with
-- CASCADE: cascade would silently take whatever else happened to depend on the table, and the
-- point of a migration like this is that its blast radius is written down. Migration 215
-- regenerates the whole claude_ro schema (it drops and rebuilds every run), so nothing is left
-- missing — but this file must run first, and filename sort order is what guarantees that.
DROP VIEW IF EXISTS claude_ro.push_subscriptions;

DROP TABLE IF EXISTS push_subscriptions;
