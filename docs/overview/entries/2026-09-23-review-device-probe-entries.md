# 2026-09-23 — a probe checklist for the device agent, and the ten entries behind it

**PRs:** #1418 (checklist + RV-124…RV-133), and this branch (RV-134).
**Docs-only.** No code changed; nothing was run against a device.

## What the owner asked for

A device-verification agent that drives the S25 APK's WebView over DevTools now exists, and he asked
what the Review Agent would want it to check. The answer is
[`docs/device-agent-probe-checklist.md`](../../device-agent-probe-checklist.md) — ten probes, each
naming the open entries it settles.

**It is deliberately not a tap-list.** Two device docs already exist and both are written for a human
holding the phone. An agent with CDP is a different instrument, and asking it to re-run a smoke test
wastes it. So every probe is something only instrumentation can answer: counting requests after a
write, enumerating computed styles across every route, capturing transition frames, reading the local
store that returns null in the sandbox.

## The thing the checklist got wrong within hours of being written

The Device Verification role landed in #1417 **after** the checklist was drafted, and the checklist
contradicted it: it said a probe returns *"never a verdict"*, while the role requires exactly one of
VERIFIED / FAILED / COULD NOT CHECK. The verdict stands; what the checklist adds is that it must
carry the measurement that produced it. Corrected in the same PR, and recorded here because it is a
clean example of two docs drifting inside one night.

Reconciled at the same time: `scripts/device/` already covers part of the spec — `probe.js` is P4's
anchor measurement, `record.js` is P5, `tour.js` is P9 plus a padding digest — so the genuinely new
asks are P1, P2, P3, P7, P8 and P10.

## Two constraints that came from the DV baton, not from reading code

- **The phone is on three-button navigation.** Every clearance measurement is meaningless there — the
  inset is generous and a broken floored utility passes anyway. RV-127's clearance half is COULD NOT
  CHECK until the owner switches to gesture nav, which the DV baton independently names as the single
  owner action unblocking its largest group.
- **The phone is signed into production.** P1 and P3 are built on real writes to the owner's real
  data, so RV-124 and RV-126 say to get his go-ahead per write type and prefer the reversible ones.

## Filing them took three attempts, and that is the durable lesson

These are the first entries whose **only** work is the device check — before the role existed, no
such thing could be filed. Neither field fits cleanly:

| field | why it is wrong here |
|---|---|
| `Gate: device` | parks the entry as unstartable **and** is not selected by `--sittings` — it would hide them from the one agent that can run them |
| `Verify: device` | reads as *shipped*, and the protocol warns against that misuse twice |

`Verify: device` won because it is the only field `--sittings` selects on, and the warning is aimed
at **unbuilt work that still needs implementing**. These have no build half, so nothing is hidden and
nothing is blocked — and each entry says so in its first bullet so no later reader mistakes it for
shipped code.

**Checked rather than assumed**, after a first test gave a false positive (a `grep -A200` spilled past
the READY heading into later sections): 10 of 10 reach `--sittings`, 0 leak into either lane's READY.
Two were parked by their own emphasis glyph — `next-item.js` reads `⛔ …block` within 40 characters as
the legacy blocked marker, and *"⛔ The clearance half is BLOCKED"* matches exactly. Same trap that
parked eight entries in sweep 52. Swapped to `⚠`; LB-121 still owns the systemic half.

## RV-134 — the `.size` conflict tax, with its mechanism named

Three of three merges this session conflicted on
`docs/doc-size/docs/implementation-backlog.md.size`, matching Tuning's independent five-of-seven.
Tuning measured the cost and said it *"needs its own entry"*; this is that entry, and it adds the
mechanism: the ratchet's growth direction has an `inherited` escape and **the slack direction
deliberately does not**, so every implementer PR that completes an entry shrinks the backlog and the
next branch is required to lower a number it did not move. The fix is to give slack the same escape.
Filed as a structural call rather than an owner question, per the 2026-09-22 narrowing.

## Not established

Nothing in the checklist has been run. It is a specification, and the first pass against a real device
is what turns it into findings.

---

# Sweep 54 — reading the instruments (same PR)

Write-up: [`docs/reviews/2026-09-23-sweep-54-reading-the-instruments.md`](../../reviews/2026-09-23-sweep-54-reading-the-instruments.md).

A different angle from 50–53, which all read source: this one reads what the app and its guards have
already **recorded**, and asks whether anyone acted on it. Both findings are the same shape — an
instrument gave its answer and the document directing people still states the question.

- **RV-135.** `lib/resume-repaint.ts` shipped a measurement pass to decide native-vs-JS and wrote the
  criterion into its header. The answer is **25 `recheck stuck`, 0 `resized`, 0 `dom-lost`** — native,
  unambiguously. BF-110's body already records that (sweep 50, 2026-09-18); its **`Keep:` still says
  the reading is what is owed**, and `next-item.js` reads the `Keep:`, so the entry sits in KEEP under
  *"not new work"* while the native fix is unowned. Re-measured: `stuck` at `h=667` has gone 3 → 9 and
  first readings at `h=667` 22 → 28 since sweep 50, so it is growing, not fading.
- **CLAUDE.md corrected in place, not queued.** Its cache-invalidation rule claimed
  `check-fetch-once-effects.js` freezes 36 sites with **19 that can bite**. The script's baseline says
  **11 across 9 files** and `CAN BITE … 0 sites. Emptied 2026-08-19` — wrong for five weeks, in the
  file every session reads first, inside the project's most repeated bug class.
- **It had already propagated.** RV-125, filed earlier in this same session, quoted the stale split
  and called it *"reasoned, never observed"* — itself wrong, since it **was** re-observed and that
  observation is what emptied the group. Amended. Its premise stands: the script skips non-empty dep
  arrays by design, so `useEffect(…, [userId])` inside the persistent shell is still invisible to it.

**Healthy, and recorded so a later change has a baseline:** DB **232 MB**, **1.53 MB/day** over three
days against the ~1.71 expectation; `error_events` 52 MB behind 172 rows, unchanged bloat, already
owner-gated; the other three shrink-only ratchets clean with current baselines; and no fault of the
owner's in seven days that is not `bf110 resume` — phrased that way because `claude_ro` is row-scoped
and cannot support the stronger claim.

**Not established:** nothing was rendered or run on a device. Why a 384×667 resume paints two children
instead of seven is the module's reading of its own data, not an observation — which is what RV-130
asks the device agent for.
