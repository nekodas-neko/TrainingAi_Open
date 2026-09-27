# projectOverview.md 13026 → 13034 — `fix/rv202-label-the-numbers-source`, 2026-09-27

Two Known-Issues rows, eight lines:

- **`RV-202 ③`** — the workout list's new provenance pill is device-unverified, and its
  `Base program` branch is unreachable from the web sandbox entirely (`getLocalStore` returns
  null there), so half of it is source reasoning. Both facts need to survive the session.
- **`LA-160`** — `RV-202 ①`'s rules fallback reaches no screen. This one is the reason the row
  is worth its lines: a shipped item is recorded as working, and the five-link chain that shows
  it is not is exactly what a later session would otherwise re-derive.
