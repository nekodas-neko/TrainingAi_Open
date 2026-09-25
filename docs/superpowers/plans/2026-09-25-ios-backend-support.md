# iOS backend support: small PR sequence

Status: proposal for maintainer review. This document adds no runtime behavior.
The Expo interface is separate work and should wait for tested backend contracts.

## Existing behavior and first two independent changes

The current API already has authenticated aggregate imports at `/api/sync-health`,
body metrics and sleep storage, and bearer-session resolution in `auth()`.
`/api/auth/exchange-mobile-token` currently exchanges a one-use PKCE-protected code
for a cookie response; it does not return a native client's bearer credential.
Reuse that identity model rather than add a parallel password-login implementation.

Two separate draft branches cover additive aggregate fields:

- `codex/apple-health-source`: allow Apple Health provenance for daily and sleep
  imports, default omitted source to Health Connect, use the existing priority ladder.
- `codex/health-active-calories`: accept explicit active kcal without conflating them
  with Android's legacy total-energy field or dietary intake. Existing storage suffices.

Neither draft establishes a raw-sample protocol, detailed device provenance or
complete HealthKit support. Both preserve existing Android requests. Their validation
notes travel with their respective code PRs; this plan does not mark either as shipped.

## Follow-up PR boundaries and acceptance criteria

| Backlog | Focused PR | Scope and proof required |
| --- | --- | --- |
| PS-48 | Native token exchange | Specify an opt-in native response while retaining cookie callers. Preserve PKCE, single use, expiry, inactive-account enforcement and no-store responses. Test replay, wrong verifier, expired code, inactive user and ordinary Android/browser login. Document logout and token-expiry behavior; do not imply immediate token revocation unless implemented. |
| PS-49 | Sample storage contract and migration | Specify user-scoped external IDs, metric type, source app/device, original timestamps, units and deletion state. Choose retention and export/account-deletion behavior. Add constraints and repository methods with real PostgreSQL tests. Keep migration review separate from ingestion behavior. |
| PS-50 | Idempotent sample batch ingestion | Authenticated, bounded, validated imports using PS-49 storage. Define batch atomicity and per-record acknowledgments; repeat batches, reordering, concurrent delivery, deletes and cross-user isolation must pass. Client advances its HealthKit anchor only after confirmed acceptance. |
| PS-51 | Historical heart rate | Audit the current HR ingestion limits and source labels, then connect imported HealthKit HR without treating it as live chest-strap capture. Test backfill, gaps, ordering, duplicate replay, units and retention boundaries. Reuse existing read endpoints if suitable. |
| PS-52 | Daily and sleep projections | Derive only supported daily/sleep values from accepted samples. Specify timezone/DST and overnight boundaries, stage overlap, units, source preference and active/total energy semantics. Projections must recompute on corrections/deletions without double counting. Do not replace manually edited values. |
| PS-53 | Mobile read contract and isolated integration | Audit current body, sleep and trend endpoints before adding any new DTO. Provide the smallest missing history/sync-status contract with account-isolation tests. Document a separate test database/deployment and app identity; rehearse login, imports, reads and deletes before connecting the UI. |

Dependency order: PS-48 and PS-49 may be reviewed independently; PS-50 requires the
storage contract; PS-51 and PS-52 require ingestion; PS-53 integrates the accepted
contracts. Each PR includes its own tests, endpoint/schema documentation and rollback
notes. Split further when a migration or security change needs separate review.

## Verification and rollout

Use synthetic fixtures first. Never point migrations or test imports at production.
A second app installation has separate permission grants and private app storage;
sharing a device does not share its Health permissions or automatically isolate server
writes. Any personal-data copy into a test environment needs an explicit decision.

Each implementation must pass relevant unit, type and repository checks, then run the
changed route against a local non-production database. CI and review precede merging.
Security changes and irreversible migrations require the repository's merge approval.

Apple Developer enrollment does not block backend implementation. It does block our
planned signed iPhone verification: compare actual HealthKit samples with stored data,
repeat the sync, test denied permissions, loss of connectivity, corrections and deletion.
Only then connect the Expo screens. Do not promise Zepp HRV, oxygen or respiratory
coverage until actual records are observed; a permission switch is not data evidence.
