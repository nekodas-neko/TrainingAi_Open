# 2026-09-01 — Q-531: the device consoles have one home, and the page is a runbook

**Branch:** `fix/device-console-ia` · **Domain:** `app-shell` / `devices` · **Lane:** B · **Version:** v1.421.0

## The correction that changed the work

The entry's **hard half was already satisfied and nobody had checked.** It reads as though the three
device consoles needed moving back behind `/admin` with a `requireAdmin` guard. They were already
there: `/admin/oura-ble`, `/admin/cadence` and `/admin/data-capture` are routed under `/admin` and
every one calls `isAdminUser` and redirects. **Q-234 moved the LINKS, not the routes.**

Which reframes the owner's report. *"It was moved away from the admin section = bad"* was literally
true of the navigation and literally false of the routing — they went to `/admin`, and the consoles
were not listed there, so they concluded the consoles had left. That is a reachability defect, not an
access-control one, and it needed the opposite fix from the one the entry proposed.

This is the "re-verify the plan against current `main`" rule paying off. Implementing the entry as
written would have been a no-op dressed as a security fix.

## What shipped

- **`/admin` grew a `Devices` tab** listing the three consoles. The owner's instinct about where to
  look was right; the app was wrong.
- **`/admin/oura-ble` is in runbook order.** It was fourteen consoles stacked in the order they were
  written — *"everything is spread out sporadically"*, one page down. Six numbered sections now
  follow §4 of [`oura-ble-operations.md`](../../oura-ble-operations.md): **1 Before you start** ·
  **2 Drain & re-sync** · **3 Verify what landed** · **4 Validate against a reference** ·
  **5 Feasibility probes** · **6 Maintenance & corrections**. Each carries a one-line *when you'd be
  here*, because a console's title says what it reads and never says when to read it.
- **Settings → Developer lost its device rows.** Diagnostics — error log, AI usage, day review —
  stay, because those are about the app rather than a device. Two homes was the grievance.
- `components/admin/console-section.tsx` is the heading, since six of them is a pattern.

**Nothing moved routes, so this is Lane B alone** — which is what the entry's own lane rule says.

## What the guard pins

`app/admin/__tests__/device-console-access.test.ts`, and it pins the owner's requirement rather than
my layout: *"it should be behind the admin portal — as regular users should not be able to touch
it."* Nothing asserted that, and the shape that had already decayed once — links in one place, guard
in another — is exactly the shape that decays silently.

1. Each console page calls `isAdminUser` and redirects. **Hiding a page is not gating it.**
2. `/admin` lists all three (reachability, the actual defect).
3. Settings → Developer lists none of them (one home).
4. **Q-544 survives the re-ordering:** `DbFootprintCard` and `DeviceMetricsPanel` stay above
   `OuraBleDebug`. They read the server only, so they answer on a desktop — and inside `OuraBleDebug`
   they were reachable only from the APK, the one client a `VACUUM FULL` blocks, and unreachable at
   all while the APK is broken, which is when a full volume is most likely. Introducing sections made
   this newly easy to break by tidying.
5. The section numbers are ascending and unique.

**Five mutations, five failures.** Removing the gate from `/admin/cadence`, un-listing a console from
`/admin`, re-adding a device row to Developer, moving `DbFootprintCard` below `OuraBleDebug`, and
renumbering a section out of order each turn it red. Assertions read stripped source: these files
quote the route paths in comments while explaining the history, so a raw-source match would pass on
prose.

## Verified on `pnpm dev`

Signed in with `is_admin` flipped on, then off, against the local database.

- `/admin` shows the `Devices` tab; all three rows navigate to `/admin/oura-ble`, `/admin/cadence`
  and `/admin/data-capture`.
- `/admin/oura-ble` renders the six sections in order.
- Settings → Developer shows `DIAGNOSTICS` and no device row.
- **As a non-admin, all three consoles and `/admin` itself redirect to `/`** — the owner's stated
  requirement, checked rather than assumed.

## Not exercised

- **The S25, and here that is most of the value.** The entry says so outright: *"Verification:
  device-only."* Every console below step 2 needs the native plugin, so what was checked is the
  page's structure and its gating, not one drain. **The flow itself is unverified**, and whether the
  runbook order matches what the owner actually does is a question only walking it can answer.
- Safe-area clearance on the re-sectioned page; insets render as 0 in the sandbox.
