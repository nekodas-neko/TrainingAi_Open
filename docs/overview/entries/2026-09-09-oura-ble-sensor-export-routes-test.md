# 2026-09-09 — the last Oura-BLE reads, and a two-line route worth two lines (PS-39, 7 → 3)

**Branch:** `test/oura-ble-sensor-export-routes` · **No product change.**

25 cases over `oura-ble/step-counter-export`, `oura-ble/workout-sensors`,
`oura-ble/comparison-harness` and `auth/[...nextauth]`.

## The NextAuth route, plainly

It is two lines: `import { handlers } from "@/auth"` and `export const { GET, POST } = handlers`.
There is nothing to test but that both verbs are exported and reachable, and that is exactly what
the case asserts and all it claims — not that authentication works. It earns its place on the
ratchet because the ratchet asks whether a test imports the handler, and a route that re-exports
someone else's still breaks if the import or the destructuring is wrong. A mutant dropping `POST`
is caught, which is the whole of what the test is for.

Writing more would have been inventing coverage, and a padded case here would be worse than none —
it would read as if the auth path had route-level tests.

## The sort is the point of the step export

The reader returns frames **newest-first** and the pipeline pairs 0x7e/0x7f windows in time order,
so the route's `.sort(byDs)` is load-bearing rather than tidy. The fixture arrives deliberately out
of order — a list already sorted proves nothing about a sort — and both the step and the motion sort
are separately mutated and caught.

Two more that a casual fixture would have missed:

- **The median is the LOWER of an even count**, an actually-observed value rather than one invented
  between two. A four-value fixture is what distinguishes it; an odd-length one cannot.
- **The walking band is inclusive at both ends** (1.5 and 3 are in), and non-finite values are
  dropped before any of it — a NaN from a failed decode would otherwise poison min and max as well
  as the band count.

`hasAnchor: false` is asserted as a normal answer rather than an error: `ring_timestamp_ds` counts
from the ring's own epoch, which resets on a re-key or a dead battery, so before the first sync
there is simply no wall clock to report against.

## Half a range is not a range

The comparison harness takes an explicit window only when **both** `start` and `end` are given. A
fixture supplying both could not tell the `&&` from an `||`, and an `||` would hand the comparison
one real bound and one `undefined`. Each half is now supplied on its own and asserted to fall back
to the minutes window.

`?metric=hrv` matches exactly — `HRV` and `rmssd` both get the HR adapter — because the two adapters
answer different questions and a typo must not silently answer the other one.

## Mutation pass

**29 of 29 caught**, no anchor misses; the thirtieth is an equivalent mutant planted as a control and
survived as designed.

## Gate

`pnpm lint` 0 errors · `npx tsc --noEmit` clean · `tsc -p tsconfig.tests.json` clean · **Custom Rules
70 of 70** · `pnpm build` clean · full suite green · route ratchet **7 → 3**.

**Three routes remain on PS-39**: `admin/battery-recovery-calibration`, `oura/hr-sync` and
`workout/backfill-set-hr-stats`.

**Not exercised:** the ONNX pipeline, the comparison maths and the probe query are all stand-ins, so
nothing here says a step count or a correlation is right — only which frames and which window each
is handed. No SQL, no ring, no device.
