# 2026-09-01 — two settings that did nothing, both decided by the owner

**Branch:** `fix/settings-that-did-nothing` · **Entries:** LB-41, LB-29 · **Lane:** B · **Version:** v1.417.0

Both were **gated on the owner** and both were asked with a recommendation, alternatives and the
reversal cost, per the standing decision rule. Both recommendations were taken. They ship together
because each is small, neither needs a device, and the merge-race tax was running at roughly one
re-merge per PR — the batching rule's "aggregate on what has to be verified" cuts the other way when
the verification is this cheap.

## LB-41 — the Weight Units toggle had no consumer

`units` was `useState('kg')`: never persisted, never read, not even restored by `resetFromUser`, so
it silently returned to `kg` every time the sheet reopened. `grep -rn "'lbs'"` across `app`,
`components`, `lib` and `packages` found only that file's own three lines. **The row offered a
choice, appeared to take it, and changed nothing anywhere.**

**Owner's decision: remove it.** The alternative — real unit display — is a pass across every weight
the app renders (body metrics, the dial, PRs, goals, chart axes) plus a stored preference that
syncs; that is a feature, and filing it as one is honest where leaving an inert switch is not.
Reversal is the same nine lines.

**`e2e/profile-group-labelling.spec.ts` asserted this exact radiogroup** — found by grepping `e2e/`
for the accessible name before removing the affordance, which is the rule the baton carries because
a sibling sweep of the *code* once missed the spec whose whole subject was a moved button. The spec
follows the removal: Food Region inherits the always-one-checked assertion, and a new assertion
holds Weight Units at **zero**, so a re-added inert toggle fails.

## LB-29 — a choice could be overwritten by the server's older copy

`savePreference` writes `localStorage` and PATCHes fire-and-forget. Hydration then wrote **every**
key the bag carried, unconditionally — so a reload before the PATCH landed was answered with the
*previous* value, which overwrote the choice just made. **Offline it was not a race but permanent:**
the PATCH never lands, so every launch re-wrote the old value.

**Owner's decision: the change should follow to other devices**, which rules out the simpler
seed-if-absent rule (a device can never be clobbered, but a setting changed on the phone never
reaches the laptop). So the fix is a dirty mark, not a weaker hydration:

- `savePreferences` records the patched keys as unsynced in `localStorage` **before** the request,
  so a reload mid-flight finds the mark rather than racing it.
- Hydration **skips** a marked key, and **re-sends** the device's value instead of taking the
  server's — which is what makes the offline case self-heal on the first launch with a network
  rather than merely survive.
- Only a 2xx clears the mark. A 4xx/5xx leaves the key marked, so the device keeps winning.
- A mutually-exclusive pair with a member in flight is left alone, or the server's older half of the
  pair would delete the half the user just chose.

The mark lives in `localStorage`, not memory, because **the reload is the whole problem** — a
session-scoped set does not survive the navigation that loses the value, which is why the entry's
third alternative was rejected outright.

`decode` is new and load-bearing: a re-send has to put back the type the schema expects, so
`weightLookback` goes as `30` and not `"30"`, and `mealReminders` as `false` and not `"false"`.

## Verification

- **In a real browser, both.** Edit Profile shows **zero** Weight Units radiogroups and no
  `Kg / Lbs` text. With the PATCH route held open, tapping a Food Region wrote `US` locally and the
  mark `["foodRegion"]`, and **after a reload the value was still `US`** — which is the defect,
  reproduced and fixed on screen rather than argued from code.
- **21 unit tests** in `preferences-sync.test.ts` (13 pre-existing, 8 new), **six mutations, all
  killed**: hydration no longer skipping marked keys, never marking, clearing the mark on a failed
  response, dropping the re-send, letting the exclusive pair ignore an in-flight member, and a
  `decode` that returns the raw string for every encoding.
- `pnpm check:rules` — **Ran 67 of 67**. `tsc`, `pnpm lint`, backlog-pointers and doc-links all exit
  0, each read by exit code.

**Not exercised: the S25.** Neither change is layout, so the device risk is low — but "a setting
survives an app restart" is a device claim, and the web reload is a weaker version of it.

**Not exercised: a real second device.** The cross-device promise the owner chose is verified as
"the device re-sends and the server accepts", not by watching a laptop pick the change up.
