# 2026-08-04 — First read of `error_events` in production

The error-reporting work (Q-58, v1.256.2/1.256.3) exists to make the *next* fault diagnosable. But
`error_events` has been collecting from 13 routes and the client reporter for a month already, and
nobody had read it. This is that read.

**464 rows: 99 server, 365 client.** Three findings, one of them live.

---

## 1. 🔴 LIVE — React hydration error on the home screen, 283 times, still happening

**Minified React error #418** (`args[]=text`) = *"Text content does not match server-rendered HTML"*.

| route | count | last seen |
|---|---|---|
| `/` | **283** | **2026-08-03 23:13** |
| `/health` | 17 | 2026-07-14 |
| `/more` | 15 | 2026-07-14 |

`/health` and `/more` stopped in mid-July. **Home did not.** Daily counts for the last two weeks run
1–13 a day with no downward trend — 12 on 2026-08-03.

### What is established

- It is a **text** mismatch, not an attribute one, so the theme/brand pre-hydration script (which
  writes classes and `data-brand`) is not the cause.
- It is **client-reported** (`ErrorReporter`), with the full production URL — so it is real browsing,
  and the owner browses through the APK WebView.
- The lazy-initializer rule is **not** being violated: `grep` for `useState(() => readCacheSync…)`
  or `useState(… localStorage …)` across `app/` and `components/` returns nothing. The session-165
  fix is holding.
- `/` renders `TabPage initialTab="home"`, and **the tab shell mounts all five tabs at once**. So a
  mismatch inside any tab's content surfaces on `/`. That plausibly explains why `/` carries ~17×
  the count of the individual tab routes, and it widens the search rather than narrowing it.

### What was tried and did not reproduce it

`pnpm dev` (which emits the **un-minified** error naming the component and both texts), driven with
Playwright at the S25 viewport, signed in as the seeded user, loading `/` and waiting 9 s:
**no hydration message of any kind**. So it needs something the sandbox does not have — production
data shape, the WebView itself, or a specific time of day.

### Two leads chased and killed — do not re-chase these

**`toLocaleString()` on the steps number is NOT it.** The theory was that Node ships minimal-ICU and
drops thousands separators, giving server `1234` vs client `1,234` from
`components/home/home-card-widget.tsx:225`. Checked: this Node is **full-icu** and
`(1234).toLocaleString()` returns `1,234`, identical to Chromium. Dead.

**DOM nesting is NOT it either.** The error's args are `['text', '']`, which reads like React's
"in HTML, %s cannot be a child of <%s>" — text placed where HTML forbids it, classically whitespace
inside `<table>`/`<tr>`/`<select>`. Checked: **there is no table markup anywhere on the home path**
(`components/home`, `components/health`, `components/shell`, `app/(home)`). Dead.

### Where to go next

**Capture the un-minified error on the device.** That is now the cheapest decisive step, not the
fallback: two rounds of static reasoning have produced two dead leads, and the un-minified build
names the component and prints both strings. Everything short of that is guessing at which of five
simultaneously-mounted tabs owns the mismatch.

---

## 2. 🟠 `/api/sync/pull` — 37 failed queries, stopped 2026-08-01

Drizzle `Failed query:` on `programs`, `workout_sessions`, `mood_logs`, `day_checkins`,
`program_sessions`. That prefix is what surfaces when the underlying query throws — for this shape,
almost always a pool-acquire timeout rather than bad SQL (the same class as the I19/I20 incidents in
`docs/oura-ble-operations.md`, where the aggregate read-herd starves the 10-connection pool).

**Last seen 2026-08-01**, so it may already be resolved by work since. Worth re-checking after a few
days rather than chasing now.

## 3. 🟡 `/api/oura-ble/samples#aggregate` — 19 failed queries, stopped 2026-07-28

Same shape, on `oura_raw_samples`. Quiet for a week.

---

## Everything else in the table is stale — checked, so it need not be re-triaged

The remaining client errors were all last seen weeks ago and none is recurring:

| last seen | n | message |
|---|---|---|
| 2026-07-30 | 1 | `Cannot read properties of undefined (reading 'call')` |
| 2026-07-29 | 2 | React #310 |
| 2026-07-21 | 10 | `(intermediate value)….reduce is not a function` (on `/workout`) |
| 2026-07-12 | 20 | `Cannot read properties of null (reading 'x')` (on `/`) |
| 2026-07-10 | 4 | `network error` |
| 2026-07-07 | 3 | `"OuraBle.then()" is not implemented on android` |

**#418 is the only live client fault.** The two with real volume — the `.reduce` crash and the
`null.x` crash — both stopped in mid-July and have not returned. They are inside the 30-day prune
window today and will age out of it; if either matters, it has to be captured before then.

## The meta-finding

All three were invisible until someone looked, and two of them had already stopped by the time
anyone did. The table has a 30-day prune, so a fault that stops is *gone* within a month — which
means "check `error_events`" belongs in the session-start routine, not in whatever session happens
to remember. A `projectOverview.md` Known-Issues row exists for the hydration error; this document is
the evidence behind it.
