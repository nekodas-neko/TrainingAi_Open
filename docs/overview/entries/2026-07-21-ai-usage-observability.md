## AI usage observability — instrumentation + admin panel (B1+B2, v1.197.0, 2026-07-21)

Workstreams B1 (instrument) + B2 (admin panel) of the app-responsiveness + AI-optimization
initiative. "We don't know how many AI calls happen, from how many places, how often" — this makes
it measurable, so the double-trip reduction (B3) can be driven from real data.

**What shipped**

- **One instrumentation chokepoint** (`lib/ai/instrument.ts`): all 15 `@ai-sdk/google` call sites
  (14 files) now route through `loggedGenerateText` / `loggedGenerateObject` / `loggedStreamText`,
  which wrap the existing `withAiRetry` retry policy and log one row per call. Model id was inlined
  14× as `google('gemini-3.1-flash-lite')` — now centralised as `AI_MODEL_ID` / `aiModel()`.
- **`ai_call_log`** (migration 136, Postgres-only): section, model, input/output/total tokens (from
  the SDK `usage`), latency, ok/error, a request **fingerprint** (sha256 of section + key inputs,
  16 hex — metadata only, never prompt bodies or health data), user_id, created_at. Logging is
  best-effort, fire-and-forget, wrapped in try/catch — it never fails or slows the AI call. Pruned
  (30d) opportunistically from the write path via the existing `retention-throttle` (no cron layer).
- **Admin → AI Usage tab** (`components/admin/ai-usage-tab.tsx`, `GET /api/admin/ai-usage`): calls by
  section (count + tokens + est. cost, worst-first), calls over time (CSS bars — no chart.js in the
  admin bundle), and **double-trip detection** (window function over `(user, section, fingerprint)` —
  flags a section firing the same logical call again within N seconds). Read-only, isAdmin-gated
  (DB-authoritative `requireAdmin`), Zod + rate-limit at the route, cache-seeded readout
  (`readCacheSync` + `cachedFetch`, per Workstream A's instant-paint rule).

**Verification (dev-server, real Gemini key present in sandbox)**

- All three wrapper shapes log real SDK token counts end-to-end: `generateText` (running-plan-explain
  53/27), `generateObject` (health-insight), and `streamText` via `onFinish` (ai-chat 1983/65).
- Admin route: 200 for admin, **403 for a demoted user** (confirms the DB-authoritative gate wins
  over the stale JWT flag), correct worst-first aggregation, double-trip detection flags a repeated
  health-insight call, timeline buckets via `date_bin`.
- **Bug found & fixed by dev-server testing** (would have shipped silently otherwise): a circular
  module-eval import (`instrument.ts` → `@/lib/data` → adapter → …) made `getRepository` `undefined`
  at call time, so *no rows were logged* despite calls succeeding. Fixed with a lazy dynamic import
  inside the (already-async) fire-and-forget path — zero hot-path cost.
- `tsc` clean (only the pre-existing `onnxruntime-web` sandbox errors), lint 0 errors, full suite
  **1819 passed** (only the pre-existing `wasm-parity` suite fails on the missing `onnxruntime-web`
  package — green on CI), 12 new `instrument` unit tests, `check-push-mutations` + `check-reconcile`
  green. The admin `/admin` page SSRs 200.

**Not exercised / flagged**

- The panel's **pixel render at the S25 viewport / both themes** wasn't eyeballed (no browser in the
  sandbox) — it's an admin-only surface, tsc/lint/API-verified; give it an on-device glance. It uses
  theme tokens + CSS bars (no chart.js, no hardcoded palette).
- **Est. cost** uses approximate Gemini Flash-Lite pricing ($0.10/1M in, $0.40/1M out) — labelled an
  estimate for relative comparison, not billing.
- No change to what any AI route returns — instrumentation only. Double-trip counts are deterministic
  and diagnostic; no logged number gates behaviour (per the AI-security rule).

Next in the initiative: **A2** (the four Category-2/3 UI fixes from the A1 audit) and **B3** (dedup
the double-trips this panel surfaces).
