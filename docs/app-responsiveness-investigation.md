# Why the app doesn't feel native — investigation brief

> ## ⚠️ SUPERSEDED 2026-07-28 — read this box before anything below it
>
> The live plan is **[`docs/superpowers/plans/2026-07-28-native-feel-roadmap.md`](superpowers/plans/2026-07-28-native-feel-roadmap.md)**.
> This document is retained for the reasoning that still holds; **three of its claims are
> retracted**, and its central open question turned out to be a false lead.
>
> **Root cause found:** the app service moved to Singapore on 2026-07-28 while the **Postgres
> service stayed in us-east**, so every query crossed the Pacific — strictly worse than before
> either move, and silent. Postgres was moved to Singapore later the same day. **Everything
> recorded below was observed against a configuration that no longer exists.**
>
> **Retracted — do not re-derive:**
> 1. **§1d / §2 — the 172 ms public proxy never touched the app.** Only two pools exist:
>    `lib/data/postgres/client.ts` reads `DATABASE_URL` (internal — the entire app, 59 sites) and
>    `lib/data/postgres/readonly-client.ts` reads `CLAUDE_DB_READONLY_URL` (the public proxy),
>    serving `/api/admin/db-query` alone. §2's "this may be the whole answer" is **wrong**; the
>    172 ms was measured against the admin audit endpoint.
> 2. **§1c — "every screen change waits for a network round trip" is too broad.**
>    `components/shell/tab-shell.tsx` keeps the five main tabs as a persistent client shell
>    switching via `replaceState`; tab flips never reach the SW navigation path. The critique
>    applies to cold start and the six non-tab routes only — which makes §3B (bundling the shell)
>    buy less than implied here.
> 3. **§4 — coverage is 85%, not "the gap is coverage".** 61 of 72 `cachedFetch` consumers already
>    seed synchronously; an earlier count grepped `readCacheSync` and missed `readTodayCacheSync`.
>    Exactly one unseeded surface is visible on load (`home-day-timeline`).
>
> That is now **three** claims in this document that read as measurements but were inferences —
> the same failure mode it warns about in §1a. Measure, then write.

**Status:** superseded — see the box above. Original text follows unchanged.

**The owner's question:** *"Some apps are always instant and very responsive, like Swift apps. Is
there something big we're missing that's stopping that?"*

**Short answer: yes, two things, and neither is a coding-style problem.** The app's UI document is
fetched from a server on the other side of the planet, and the service worker is configured to go to
the network for it every time. No amount of component-level optimisation reaches either.

---

## 1. Established facts (measured, not inferred)

### 1a. Geography is the floor — but the deployment region is NOT knowable from a response header

⚠️ **An earlier draft of this document claimed the server was in Virginia, based on
`x-railway-edge: iad1`. That was a misreading and is retracted.** `x-railway-edge` (and
`x-hikari-trace`) report the **edge PoP that served the request**, i.e. where the *caller* entered
Railway's network — not where the container runs. Every request from a US-based agent sandbox
returns `iad1` no matter which region the service is deployed to. No response header inspected
(`server`, `x-railway-request-id`, `x-hikari-trace`, `x-railway-edge`) discloses the deployment
region.

**Both the app and the Postgres service are in Singapore as of 2026-07-28.** An earlier version of
this line said the co-location risk was "ruled out" — **it was not; it had already materialised.**
The app moved first and Postgres stayed in us-east for a window, which is exactly the strictly-worse
configuration warned about here. The owner moved Postgres later the same day. Sequence matters:
anything measured or felt during that window describes the pathological split, not the app.

The geography argument itself still holds, and is the reason the move matters:

| route | distance | realistic RTT |
|---|---|---|
| Brisbane ↔ Ashburn (us-east) | ~15,500 km | **~220–280 ms** |
| Brisbane ↔ Singapore | ~6,000 km | **~90–110 ms** |

That cost is paid on **every** request — every navigation, every `/api/*` call — and no application
code can move it. Only the region can, which is why the move is expected to be the single largest
improvement available.

### 1b. The APK is a WebView on the live remote URL — the shell is not on the device

`capacitor.config.ts`:

```ts
server: { url: 'https://trainingai-production.up.railway.app', cleartext: false }
```

So the HTML document, the RSC payloads, and every navigation come from the Railway deployment,
wherever it is. A Swift app's UI code is on the device and costs 0 ms to present; here the
*document itself* is a network fetch — a region move shrinks that cost but never removes it. This is already known and named in `CLAUDE.md` (Canonical Runtime) — bundling the shell is
listed as an unscoped "endgame project" in `docs/implementation-backlog.md`.

### 1c. The service worker deliberately never serves navigations or API calls from cache

`public/sw-template.js`:

- `/_next/static/*` → cache-first ✅
- `/exercise-media/*` → cache-first ✅
- `/api/*` → **`fetch(e.request)` — never cached, always network**
- top-level navigations → **network-first**, with cache only as an offline fallback

The navigation choice is documented and deliberate: the WebView points at a constantly-redeploying
`main`, so a cached document can reference a previous build's chunks and hit Next.js deployment
skew. That reasoning is sound — but the cost is that **every screen change waits for a network
round trip before it can paint**, however close the server is.

### 1d. The read-only audit path goes through Railway's *public* proxy — 172 ms floor

```
SELECT 1  ->  172ms
SELECT 1  ->  172ms
SELECT 1  ->  1223ms
```

The audit endpoint's pool connects to `kodama.proxy.rlwy.net:16635` (confirmed by the endpoint's own
`GET` schema-discovery response). `SELECT 1` cannot take 172 ms of *query* time — that is
connection/routing overhead on the public proxy path.

---

## 2. ~~THE OPEN QUESTION~~ — CLOSED 2026-07-28, and it was a false lead

> **Answered: the app uses the INTERNAL host.** Source-verified — only two pools exist.
> `lib/data/postgres/client.ts` reads `DATABASE_URL` (internal; the entire app, 59 call sites);
> `lib/data/postgres/readonly-client.ts` reads `CLAUDE_DB_READONLY_URL` (the public proxy) and
> serves `/api/admin/db-query` alone. **The 172 ms below was measured against the admin audit
> endpoint and never applied to any user request.** Everything in this section arguing it "may be
> the whole answer" is wrong. Retained only to show why the lead was chased.

**Does the app's own `DATABASE_URL` use Railway's private network, or the public proxy?**

**This is independent of the region and is NOT answered by the Singapore move.** Both services being
in Singapore rules out a cross-region hop, but a `*.proxy.rlwy.net` host still routes out to the
public internet and back *within* the region — the measured floor was 172 ms on the audit path.
Same-region proxy overhead will be lower than that cross-region figure, but it is not free, and it
is paid per query.

This could not be determined from the sandbox: the session-start hook unsets `DATABASE_URL`, and it
is not in the repo. **Check the Railway dashboard — it takes ten seconds** — or print the host
(never the password) from the running service.

| If `DATABASE_URL` host is… | Then a query costs | And `aggregateSignals`' ~12 sequential waves cost |
|---|---|---|
| `*.railway.internal` (private) | ~1–5 ms | ~15–60 ms — negligible |
| `*.proxy.rlwy.net` (public) | **~172 ms** | **~2 seconds of pure round-trip** |

If it is the public proxy, that single misconfiguration is very likely the dominant cause of the
"few seconds before the AI prescription appears", it is a one-line environment-variable fix, and it
would make most other optimisation work unnecessary. **Establish this before doing anything else.**

Note `lib/data/postgres/client.ts` keeps `max: 10` and a `statement_timeout`; both matter more if
connections are expensive to establish, so also confirm the pool is actually being reused rather
than reconnecting per request.

---

## 3. Remediation ladder — highest leverage first

**A. ✅ DONE 2026-07-28 — the deployment was moved to Singapore by the owner.** Brisbane → Singapore
is ~6,000 km versus ~15,500 km to us-east: roughly **~90–110 ms RTT instead of ~220–280 ms**, a
~2.5× cut on *every request in the app*, for a configuration change and no application code.
Postgres is in Singapore too — **confirmed by the owner 2026-07-28**, so the co-location risk is
ruled out. **Still to verify:** that the improvement is real when measured from the owner's device
(see §5). This was expected to be the single highest-leverage change; confirm that it was, because
if the app still feels slow afterwards the cause is §1b/§1c, not geography.

**B. Bundle the app shell into the APK.** Already scoped-but-unplanned in the backlog. Navigation
becomes local and instant; only data crosses the ocean. Interacts with the PWA plumbing — read the
Canonical Runtime section of `CLAUDE.md` before touching it, since the service worker is *also* the
push-notification transport and gives the APK its offline cold start.

**C. Reduce round trips per screen, and extend local-first reads.** The app already has both
patterns and they work — where a screen is cache-seeded (`readCacheSync` + `cachedFetch`) or reads
the on-device SQLite mirror, it *does* feel instant. The sluggish surfaces are the ones that
don't. Known offenders:
- ✅ **FIXED in #866** — `GET /api/ai-periodization/session/[id]` used to run the full ~30-signal
  `aggregateSignals` on every prescription-card load *and* every ~3 s poll tick, to produce six
  fields per exercise. Now a light path sharing the engine's own trend derivation: **40 → 10
  queries per request**, measured. Its real-world value still depends on §2.
- Cross-session aggregates (`weekly-stats`, `weekly-muscle-sets`, `weights-summary`,
  `muscle-recovery`, `home-day-timeline`) are server-only **by design** — see the Offline-First
  section of `CLAUDE.md` before "fixing" those; they are a sanctioned exception, not an oversight.

**D. Do NOT start with component-level render optimisation.** Memoisation, selector narrowing and
render discipline are already enforced by `CLAUDE.md` and are not what makes the app feel slow. A
16 ms render saving is invisible next to a ~100 ms network floor, let alone a 250 ms one.

---

## 4. What "good" looks like

A Swift app feels instant because presentation never waits on a network. The equivalent here is:
every screen paints from the on-device store or a cache seed **first**, and the network only ever
*corrects* what is already on screen. The app's own rules already say this ("a skeleton flash on a
repeat visit is a bug"); the gap is coverage, plus the two architectural facts in §1 that no screen
can work around on its own. Note the region move shrinks the floor; it does not remove it, so §1b
and §1c still matter after it.

---

## 5. Prompt for a fresh session

> TrainingAI feels sluggish compared to a native app. Read
> `docs/app-responsiveness-investigation.md` — the groundwork is done, don't redo it.
>
> Start with §2: determine whether the production `DATABASE_URL` uses Railway's private network
> (`*.railway.internal`) or the public proxy (`*.proxy.rlwy.net`). A `SELECT 1` through the public
> proxy measured 172 ms, so if the app is on that path, its ~12-wave signal aggregation is spending
> ~2 seconds per prescription-card load on connection overhead alone, and it is an env-var fix.
> Report that finding before writing any code.
>
> Then quantify, from the S25 on a real connection, where the time actually goes on one screen
> open: DNS/TLS, document fetch, RSC payload, each `/api/*` call, and first paint. Do not try to
> infer the deployment region from response headers — `x-railway-edge` reports the caller's edge
> PoP, not the container's region. Confirm the region in the Railway dashboard instead.
>
> Then propose (do not implement yet) a costed comparison of the §3 ladder: a Railway region move
> to Singapore, bundling the shell into the APK, and trimming the periodization endpoint's payload.
> The owner decides which to take. Note that the region move touches production infrastructure and
> the Postgres service must move with the app — treat it as confirm-first.
