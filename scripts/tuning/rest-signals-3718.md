# rest-signals-3718.sql — the production count for #3718

`rest-signals-3718.sql` is one SELECT with no semicolon and no comment (the claude_ro tool takes exactly
one statement), so what it says about itself lives here. Paste the whole file as the `sql` body, as in
`docs/session-start-reads.md`. Read-only, owner-scoped `claude_ro` views, counts only, last 90 local
days ending yesterday. The cuts are the first CTE, `p`, pinned to the shared constants by
`packages/shared/src/ai-periodization/__tests__/rest-signals-replay-3718.test.ts`.

Columns: `signal`, `evaluable_days` (the signal's inputs present, fresh and not gappy; on the `any` row,
days at least one signal was evaluable), `flagged`, `already_suggested` (the check already suggested
rest that day for another reason), `workout_done`.

Same rules as the app: a trend is compared as the ratio rounded to two decimals, as the AI prompt prints
it, and is ignored when its newest night is not the day or the oldest of its recent three nights is more
than 4 days back.

Where it still approximates the app (the exact count is `scripts/tuning/rest-signals-replay.cjs`, the
shipped code run over a local database or a restored backup):

- Sleep reads the duration trend (the prompt's fallback), not the app's sleep-quality trend, which is
  computed in code from stages, latency and timing. One row per wake date, its longest; partial nights
  skipped. Naps the app's night picker drops can count here.
- HRV and blood oxygen: a row with no `source_map` key is not inferred to a device, and the #3601
  algorithm-version grouping is skipped.
- "Already suggested" leaves out the raised-temperature arm (its TN-18 trust check is not rebuilt in
  SQL), so that column is a floor.
- Rounding: Postgres `round` on a decimal against the app's `toFixed` on a binary float can differ only
  when a ratio sits within about 1e-15 of a half step. Not expected to move a count.
- A day is judged by the final stored readiness and trends, not what the check saw early that morning.
