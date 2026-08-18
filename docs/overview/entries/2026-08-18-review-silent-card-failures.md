# 2026-08-18 — Review sweep 33: three lenses, two clean

**Agent:** Review 📖 · **Branch:** `review/silent-card-failures` · **Docs-only.** Filed **Q-499**.

Three lenses. Two came up clean, and they are recorded first — a lens that confirms is still a lens,
and a successor should not spend the time again.

**Clean 1 — internal error text in responses.** Seven route files return `err.message` or
`String(err)` in a response body, and every one is admin- or session-gated. Two apparent hits are not
responses at all: `oura-ble/samples:171` is a `console.error` + `reportServerError` on a background
rollup, and `log-calendar-event:64` is a log line already truncated to 200 chars. `admin/db-query`
returning the raw SQL error is **correct by design** — it is a SQL console, and hiding the error would
defeat it. No finding.

**Clean 2 — rate-limit coverage on AI routes.** A path/import grep produced 25 candidates, seven with
no `rateLimit` call — six `ai-periodization/*` routes and `training-load`. Checked individually, **all
seven make zero LLM calls**; they matched on the `ai` path segment alone. Every route that actually
calls an LLM has a rate limit, so the rule is fully satisfied. That is the sixth consecutive sweep
where the mechanical version of a check over-reported — reliable enough now to expect.

**Q-499 — and it starts with a correction to the rule that names it.** `CLAUDE.md` says `cachedFetch`
*"swallows `!res.ok`"*. It does not unconditionally: `cachedFetchCore` accepts an `onError` callback
and swallows only when the caller declines it. That makes this a **coverage** problem with an existing
mechanism rather than a missing capability, and the rule's wording should name the hook.

78 components call `cachedFetch`; **18 reference `onError`**, and that is an upper bound because some
are unrelated matches. **Two were verified by hand and both conflate failure with emptiness:**
`health/hr-recovery-profile-card.tsx` fetches with no `onError` and returns `null` while `profile`
stays null on failure, so a failed request and an empty profile render identically; and
`health/strength-progress-card.tsx` does `.catch(() => {})` — the smell `CLAUDE.md` names — then
returns `null` on an empty list.

**Scoped honestly:** a crude filter produced 12 candidates and 2 were confirmed. The other ten are a
worklist, not a defect count — several `return null` paths there are legitimate empty states, and
telling them apart needs exactly the per-file judgement that Clean 2 shows a grep cannot make.

**Why it matters more than it looks:** `cachedFetch` treats any `!res.ok` alike, **including a 429
from the app's own rate limiter**. A user who trips a limit watches health cards vanish instead of
seeing "try again in a minute", and the same silence covers a 500. Offline it is worse, since
`cachedFetch` cannot revalidate at all.

**Not exercised:** static reading plus two hand-verified components. The vanish was **not reproduced
in a browser** — no card was driven to a 429 or a 500 to watch it disappear, which is the obvious next
step and would promote the ten candidates to a count. No device, no production.
