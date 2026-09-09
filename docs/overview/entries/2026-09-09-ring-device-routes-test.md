# 2026-09-09 — the ring-device three, and a NaN that emptied a panel (PS-39, 10 → 7)

**Branch:** `test/ring-device-routes` · **One product change**, in `device-metrics`.

29 cases over `oura-ble/rekey`, `oura-ble/device-metrics` and `colmi/status`.

**`rekey` declares a re-key; it does not perform one.** The re-key itself is a deliberate act done
with `open_oura` on a laptop, and it is what an app uninstall destroys unrecoverably — nothing here
touches the ring. The route exists so the ingest path stops guessing, because guessing from counter
shape re-timed the owner's entire sleep history twice (+12.17 h, then +14.16 h): a re-key and a
history re-drain are identical by shape, both dropping a batch's max ds below the epoch high-water
mark.

## A non-numeric `?days=` reached the window arithmetic as NaN

`device-metrics` clamped with `Math.min(14, Math.max(1, Number(param)))`. **That is NaN for a
non-numeric param** — and the adapter's own clamp is the same three functions, so it does not repair
it. `?days=abc` therefore reached `Date.now() - NaN * 86_400_000`, and the panel read empty: a
diagnostic answering "no data" where the truth was three days of it, which is the failure mode a
diagnostic exists to avoid.

Verified rather than assumed, before changing anything:

```
route clamp of ?days=abc -> NaN
adapter clamp of that    -> NaN
window ms                -> NaN
```

Now `Number.isFinite(rawDays) ? … : 3`. A mutant restoring the old expression is caught.

## The fixture-trap, twelfth-and-a-half variant

**A wrong-day sleep session whose times ALSO fall outside the day is rejected by the clamp before the
date filter is reached.** The obvious fixture — yesterday's night, dated yesterday — clamps to a
zero-length window, so deleting `.filter(s => s.date === date)` changes nothing and the case passes
either way. That mutant survived, which is how it was found.

The fixture is now a session dated to the 6th whose times sit inside the 7th, so only the date field
can exclude it. Both mutants are caught now — the date filter and the clamp are tested separately,
which is the point of having both.

This is the general form the PS-39 checklist already names (a case meant to fail on guard X, which a
different guard rejects first), and it keeps arriving in new clothes.

## What else the tests hold

- **The declaration is idempotent and says which case happened.** The effect is deferred until the
  ring next reports, so "queued" and "already waiting" produce identical observable state — without
  the flag and its sentence, pressing the button twice looks like it worked twice.
- **A consumed declaration is deliberately not cancellable.** The epoch it opened exists and every
  timestamp derived from it depends on that row as the audit trail; only a pending one can be
  withdrawn, and "Nothing was pending" is what an owner sees when they try anyway.
- **Today is a partial day.** Completeness for today is measured against the bins elapsed so far,
  not a full 96 — otherwise every reading before midnight looks like a wear failure. Both sides are
  asserted against a pinned clock.
- **Each 15-minute bin counts once**, however many frames land in it: wear is "was the ring on",
  not "how many frames arrived".
- **`colmi/status` is deliberately NOT admin-gated**, unlike its two neighbours in this file. It is a
  signed-in user's own ring status. A mutant that adds an admin gate is caught, because that
  asymmetry is easy to erase while "making the file consistent".

## Mutation pass

**25 of 25 caught** after the fixture rebuild; the twenty-sixth is an equivalent mutant planted as a
control and survived as designed.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite green · route ratchet **10 → 7**.

**Not exercised:** the curve builders and the completeness scorer are stand-ins, so this says nothing
about whether a curve is right — only which samples reach it. No SQL, no ring, no device.
