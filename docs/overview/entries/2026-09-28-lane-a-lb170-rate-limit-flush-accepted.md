# 2026-09-28 — LB-170: a rate-limit increment lost on deploy is accepted, and now says so

The limiter's flush to Postgres runs after the response, and nothing awaits it. So a deploy that
replaces the container mid-flush drops that increment. LB-170 asked for a judgement, preferring a
recorded decision unless draining on shutdown was cheap.

**It is not cheap.** Nothing in the app handles SIGTERM, and there is no lifecycle layer
(`docs/module-map.md` §0), so draining would mean inventing process-level hooks for a counter. The
loss is a count low by the few requests in flight during one deploy, the same class as the cold-replica
lag the file's header already accepts. `lib/rate-limit.ts` now records that decision beside the
other one, along with LB-168's warning not to drain in the shared test setup.

Comment-only change; nothing to test. LB-170 leaves the queue.
