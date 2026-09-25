# 2026-09-25 — RV-79: one bare fetch converted, and the 68 others counted

**Branch:** `lane-b/rv79-mood-cached-fetch` · **Lane:** Implementation B

Home read today's mood with a bare `fetch`, against the standing rule that client GETs of `/api/*`
go through `cachedFetch`. The conversion is one line. What it took to be safe, and what counting the
rest of the class turned up, are the parts worth keeping.

## The predicate is the fix, not the conversion

This entry had already been corrected once by Lane B: the obvious conversion **reintroduces a live
bug**. `cachedFetchCore` writes the response after any 2xx, outside every null check, so a server
`null` overwrites an optimistic local mood log — and `readCacheSync` parses a stored `"null"` back
as a value rather than a miss, so this screen's seeds then paint `null` and the check-in card
re-prompts. That is the session-167 bug, arrived at by fixing a rule violation properly.

`shouldCache` shipped since (#1394, RV-189), so the read now passes `{ shouldCache: d => d != null }`
and the null branch keeps its guard. Without the predicate the change would satisfy the rule and
break the screen, which is why the guard test asserts the predicate rather than the conversion.

## Counting the rest of the class

RV-79 and `LB-154` (which I filed hours earlier, for the food-logger sheet reading meal types the
same way) both read as one-off violations. They are not: **68 bare `fetch()` calls of an `/api/` GET
exist in client code**, measured with a brace-balanced scan that drops any call with an explicit
`method:`, ternaries included.

> **Corrected 2026-09-25 (LB-155):** this said **69**. The scan dropped `method:` but not the
> SHORTHAND `{ method, headers }`, which has no colon, so one POST in `supplements-section.tsx` was
> counted as a GET. 68 was the figure at the time; it is 67 now, because this PR's own fix removed
> one. The scan is unit-tested from LB-155 onward.

By area: `components/oura-ble` **18**, admin consoles **15**, `components/nutrition` **10**, then a
long tail. So roughly half sit in BLE and admin debug surfaces where a cached read is *actively
wrong* — you want a live value while holding the device, which is the same reasoning CLAUDE.md
already uses to exempt those consoles from the timezone rule. Others are per-query by nature
(`food-items?q=`, `barcode?code=`), and `/api/version` is the one route deliberately exempt from the
no-store rule, read by the update check, which must not be cached at all.

That is filed as `LB-155`. The point of it is not the conversions — it is that **a rule with 69
violations and no written exemption list cannot be enforced**, and every future entry citing it will
single out one site as though it were exceptional. Which is exactly how these two were filed.

## Scope

RV-79 is removed from the queue: the fix is invisible (the screen already seeds from this key, so no
new paint), so nothing is owed, not even a device look. `LB-154` stays and now carries the
population. The remaining ~36 product-surface sites are `LB-155`'s, deliberately not swept here —
RV-79 is the proof that a conversion is not mechanical.

**Not exercised:** no device, no browser. The entry's own "not established" also stands — on the APK
the local-store branch short-circuits before this fetch, so how often it fires on device is still
unmeasured, and this change does not measure it.
