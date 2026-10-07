# Public Launch Checklist — read this before sharing the app beyond personal use

**Purpose.** This app currently runs as a personal-use-only tool, which makes some shortcuts and
deferred compliance items acceptable that would NOT be acceptable for a public release. When the
owner asks "what violations do we need to fix" (or similar) before opening the app up more broadly,
this is the list to check.

---

## 1. Map tile attribution is hidden (license violation if left this way for public use)

- **What:** The activity route map's Leaflet attribution control (`"Leaflet | Maps © Thunderforest,
  Data © OpenStreetMap contributors"`) is hidden via `attributionControl={false}` on the
  `MapContainer` in `components/activity/activity-route-map.tsx`.
- **Why it's fine for now:** Personal-use-only, single user, no public distribution.
- **Why it's a real problem for public use:** OpenStreetMap's data license (ODbL) and
  Thunderforest's Terms of Service (both apply even on the free Hobby tier this app uses) require
  visible on-map attribution. Shipping this to other users without it is a license violation, not
  just a style preference.
- **Fix before public launch:** Remove `attributionControl={false}` (restores the default control),
  or — for a less obtrusive look — build a compliant custom treatment (e.g. a small collapsed
  info-icon that expands to show the same required text) rather than removing it outright. See the
  note in `docs/module-map.md` §12 (Activity/GPS/weather) for the full context and prior debugging
  history (the CSP `connect-src` fix that made tiles render at all, `docs/overview/entries/2026-07-28-*`).

## 2. Health Connect declared-use-case review (the long pole)

- **What:** Google reviews every app that asks for Health Connect permissions, and the review is a
  declaration of the use case, not a form that clears the same day. It has an external lead time the
  other items on this list do not.
- **Why it matters:** it gates tier 2, which is every user who is not the owner
  (`docs/device-agnostic-source-architecture.md` §7 question 1). Without it the app can read Health
  Connect for the owner's own sideloaded build and for nobody else.
- **Who starts it:** the owner. It is an account action in the Play Console, so no session can do it
  for them. **Start it first**, before the code items below, because its lead time is what sets the
  earliest possible launch date.

## 3. Privacy policy and data-safety declarations

- **What:** a published privacy policy, and the Play Console's data-safety declarations, covering
  the health data the app reads (Health Connect, the ring, the scale), what leaves the device, and
  how an account and its data are deleted.
- **Where the decisions are:** #2102 (the three privacy decisions, answered 2026-09-24, with the
  clinical baseline document removed from the tree). The declarations must match what the app
  actually does, so write them from the code and not from this list.

## 4. The BLE pipeline assumes one owner

- **What:** the Tier-1 ring pipeline assumes a single user: the foreground service, `WEBHOOK_USER_ID`
  (the one account the Health Connect and snapshot endpoints resolve to) and an admin-only console.
- **Why it is fine now:** the app has one user.
- **Why it blocks sharing the ring path:** a friend with a ring would need this made multi-user. That
  is real work and is not scoped (`docs/device-agnostic-source-architecture.md` §7 question 2). If
  launch means "other people's phones with Health Connect" and not "other people's rings", this item
  can stay deferred; decide that when the launch scope is decided.

## 5. Done: `006_admin_flag.sql` hardcoded the owner's email

- **Fixed.** The migration no longer carries an email address. Admin is granted at boot from the
  `ADMIN_EMAIL` environment variable (`bootstrapAdmin` in `instrumentation-node.ts`), which re-runs on
  every deploy. Kept here so the item is not re-found as open: it was listed in the native
  convergence review (`docs/reviews/2026-08-02-native-convergence-roadmap-review.md` F3) as gating the
  public repository and is closed.

---

*(Add further items here as they come up — anything deferred specifically because the app is
personal-use-only belongs on this list, not silently left for someone to rediscover later.)*
