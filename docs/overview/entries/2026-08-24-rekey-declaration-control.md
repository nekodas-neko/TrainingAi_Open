# Declaring a ring re-key has a button (Q-317)

**Branch:** `feat/rekey-declaration-control` · **Lane B** · v1.363.2

## What shipped

`components/oura-ble/rekey-declaration-card.tsx`, on `/admin/oura-ble`. It drives the three verbs
`POST /api/oura-ble/rekey` already exposed (Q-314, Lane A): declare with an optional note, show the
pending declaration with the time it was made, cancel one made by mistake.

## Why an affordance is the point

A re-key restarts the ring's own clock, and the server cannot tell that apart from a history
re-drain by counter shape alone — inferring it re-timed the owner's entire sleep history **twice**.
Q-314's answer was to make it a declaration rather than an inference. A declaration nobody can make
in the app is one that gets forgotten at exactly the moment it is needed: right after a re-key, on a
laptop, mid-`open_oura`.

## Two decisions worth stating

**It sits outside `OuraBleDebug`, as a sibling section on the page.** That component returns the
native-unavailable banner and renders nothing after it whenever the plugin is absent — which is
precisely the situation the laptop doing the re-key is in. Putting the control inside it would have
made it reachable only from the APK, i.e. only from the device that is not being used at that
moment. The declaration needs no ring present; it only needs the server.

**The deferred effect is stated before the button, not after the press.** Nothing happens when you
press it — the new clock value is not knowable until the ring reports, so the next drain consumes
the declaration. A control that looked like it acted immediately would invite a second press, and
the entry's own warning is that a second declaration is a second epoch. The pending state shows the
declaration and its timestamp so the waiting is visible rather than inferred.

Cancel is offered only while `GET` reports something pending. A **consumed** declaration is not
cancellable — the API refuses, correctly, because the epoch it opened already exists and every
timestamp derived from it depends on that row as the audit trail.

## Verification

Driven end to end in a browser against `pnpm dev` + local Postgres, as an admin user:

- **idle → declare** — with a note typed in, the confirm dialog fires the POST; the card flips to
  the pending state and `oura_ble_rekey_declarations` carries the row with `note` persisted.
- **idempotency** — a second POST in the same session returned
  `alreadyPending: true` with *"A declaration was already waiting; this did not queue a second one."*
  and the pending row count stayed at **1**.
- **cancel** — the card returns to idle, reports *"Pending declaration removed."*, pending rows **0**.
- **consumed** — with a row carrying `consumed_at`, the card offers **no** cancel button.
- Zero page errors throughout.

`tsc --noEmit` clean · `eslint` zero new warnings · `pnpm check:rules` **Ran 55 of 55**.

## Not exercised

The **effect** of a declaration was not driven — that needs the next ingest batch from a real ring
to consume it and open the epoch, which no sandbox can produce. This item is the affordance; the
route's own behaviour was already proven end to end by Lane A under Q-314.

Nothing checked on the S25. The card is plain web UI on an admin page, so the APK risk is layout
rather than behaviour, but it is still unchecked there.
