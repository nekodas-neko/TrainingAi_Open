# 2026-08-18 — the response body stopped publishing the schema (Q-483)

**Lane A** · branch `fix/routes-leak-raw-driver-error` · four routes, a CI rule, two tests · no
migration, no Kotlin, no APK.

Four routes returned `errorLog(error, …)` as their JSON body. `errorLog` builds
`` `[ERROR]: ${error}` ``, and for a Drizzle failure that string is the whole failing statement — so a
malformed id published every column of `workout_sessions` to the client:

```
GET /api/workout-sessions/not-a-uuid/recap  →  500
{"error":"[ERROR]: Error: Failed query: select \"id\", \"user_id\", \"session_id\",
 \"session_name\", \"started_at\", \"completed_at\", \"hr_synced_at\", …
```

Reproduced on all three of `recap` / `energy` / `timing`; the control — a valid-but-missing UUID —
returned a clean `{"error":"Not found"}` 404, so it was specific to the malformed id reaching the
driver as `22P02`. `session-explain/insight` carried the same pattern without leaking today, because
its id is guarded upstream; fixed anyway, since "does not leak yet" is a property of the guard, not
of the route.

**Priced as the entry priced it, not upward.** This is disclosure to an *authenticated* user, and
this app's users are its own account holders. Production showed **zero** `22P02` rows in
`error_events`, so on that evidence the leaking response has never actually been served. It is worth
fixing because it is the only place in the app that publishes table structure, and because it costs
nothing: `reportServerError` is already called on the line above.

After: `{"error":"Internal error"}` with the same 500, control still 404.

## The log line is not lost, and that was checked rather than assumed

`errorLog` calls `console.error` **internally** and returns the string, so calling it and discarding
the return keeps the full detail in the server log. That is the whole reason this fix is three lines
rather than a refactor — but it is also exactly the kind of thing that would silently delete
diagnostics if it were wrong, so there is a test asserting `errorLog` logs *and* returns.

## The check is deliberately narrow, and says so

`scripts/check-no-raw-error-in-response.js` bans `errorLog(...)` in a response body, in both the
inline and the `const errMsg = …` binding forms (verified against a reintroduction of each).

Its first draft was broader and flagged **14 more sites** — `const msg = e instanceof Error ?
e.message : 'Create failed'` returned as a 500 body. It was **right to**: a Drizzle error's
`.message` *is* `Failed query: select …`. But several of those sites return the same `msg` on a
**4xx** where it is a genuine user-facing message, so untangling them is real work rather than a
wider regex. Filed as **Q-320** and recorded in the check's own comment, because a check that fires
on correct code gets deleted rather than obeyed.

Custom Rules is now **46 of 46**.

## Not exercised

Production, and the APK. Both are read paths with no device-specific behaviour.
