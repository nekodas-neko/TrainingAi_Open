# 2026-09-20 — "still called oura readiness?" and "recommend deload?" are two different bugs

**BugFix intake.** Docs-only. Owner, on the *Why Upper?* screen: *"Still called oura readiness and
reccomend deload?"* Two findings, unrelated to each other: **BF-178** and **BF-179**.

## BF-178 — the number is ours, three surfaces credit Oura

`liveReadinessForDay` returns `oura_daily_derived.readiness_score` where the source is
`ble-derived` — the app's own composite. The frozen Cloud column is a fallback only for pre-re-key
days. Production on the day of his screenshot: **46, `ble-derived`**, as is every recent row.

Home calls the same number "Readiness". The explain screen calls it "Oura readiness". The worse half
is `session-explain/insight/route.ts:46`, which feeds the model `- Oura readiness: ${...}` — so the
generated prose says it too, which is why his screenshot reads *"Despite your Oura readiness of
46"*. A label is a rename; a prompt line teaches the model to attribute our composite to a third
party in text nobody reviews.

## BF-179 — a dismissed prescription that expired three days ago is setting today's loads

First, the two deloads are different systems. The explain screen's signals feed
`computeDeloadStrength`, which gates on `consecutiveTrainingDays < 3` and with his **0** returns
`recommended: false`. The workout screen's banner is the **periodization prescription**, which never
consulted those signals. So "every signal says I'm fine, why deload" has a real answer: nothing on
that screen produced it.

Then the defect. Upper's stored row, measured 2026-09-20:

| field | value |
|---|---|
| `prescription_status` | **dismissed** |
| `prescription_expires_at` | **2026-09-17 21:25** |
| `phaseAction` | `deload_recommended` |

The ageing-out check in `reevaluate.ts:104-110` covers `auto_applied | accepted | consumed`.
`dismissed` is in neither that set nor the deliberate `pending` carve-out, so `needsRegenerate`
never fires and `workout-data` takes the `else` branch — which **re-stamps the stale prescription
and writes it back**. The expired offer is refreshed, not tolerated.

**This is Q-229 returning through a status its fix did not name, and the file says the symptom out
loud**: *"an 8-day-old deload-era 52% served on a live Intensification day."* His screenshot is
**52% across all five exercises**.

## The one thing not pinned down, recorded rather than guessed

`prescriptionDrivesLoad` returns false for `dismissed`, and the card's "· Deload recommended" copy
is gated on `isPending` — so by the code a dismissed prescription should do neither, yet the device
does both. Two candidates with different fixes: a stale `workout-card:` cache seeded by the
read-only `?tab=all` path while the prescription was still pending, or a status divergence between
client and row. The entry names both and the test that separates them. The expiry gap is real
either way.

## What was not exercised

Nothing on the S25. Both were traced in source and confirmed against production rows — the readiness
source column and the periodization row — not reproduced at runtime. BF-179 carries a device check
because the 52% is what the owner actually sees.
