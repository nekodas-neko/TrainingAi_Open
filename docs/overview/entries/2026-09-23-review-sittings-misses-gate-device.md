# 2026-09-23 — the device agent could not see the work that is blocked on it

**PR:** this branch. **Docs-only.** Nothing was run on a device.

## The question, and the honest answer

The owner asked whether everything the Device Verification agent needs had been backlogged. **It had
not.** Checking rather than asserting found a gap that is structural rather than an oversight in any
one entry.

`next-item.js --sittings` is the device agent's work list. Its filter:

```js
if (e.verify?.value === 'device') return true;
return /\bdevice\b|\bS25\b|\bAPK\b|on-device/i.test(e.keep?.text ?? '');
```

**`Gate:` is never consulted.** Measured on `main`: 29 entries carry a `Gate: device` field and
**24 of them do not appear in `--sittings`**.

## Why that is worse than "missing"

A `Gate:` **parks** an entry. So those 24 are skipped by both implementer lanes *because* they need
the device, and are invisible to the one agent that has the device. Nothing surfaces them to anybody
— they are in a dead zone, and they include **Q-51**, the perf entry this session built six probes
around, and **BF-22**, the owner's own *"a lot better after a force restart"* report.

## The cause is a role that changed the meaning of a field

`--sittings` was built around *shipped work owing a look* — BF-90 found eleven entries writing the
same debt in both `Verify:` and `Keep:`, which is what the filter reads. Before 2026-09-23 a
`Gate: device` meant **wait for the owner to pick up the phone**, so leaving it out of a "what could
one sitting clear" view was correct.

The Device Verification role changes what that gate means: it now reads **the DV agent can unblock
this**. And a gated entry is *more* urgent for that agent than a `Verify:` one — one blocks work, the
other is a look owed on work already shipped. The field's meaning moved; the selector did not follow.

## What RV-143 asks for

Select `Gate: device` in `sittingsOnly` too, and print which field each row came from so a reader can
tell *blocked-on-this* from *look-owed-on-this*. About three lines.

The entry carries a triage of all 24 so the fix does not simply dump them on the device agent:
roughly **13 runnable now**, **5 needing the Colmi R09 in hand**, **2 needing a production write or
the owner physically present**, and **4 that look mis-gated** and are really design specs.

**⚠ The entry states one thing not to do:** bulk-converting `Gate: device` → `Verify: device` to make
them visible. `Verify:` means shipped, the protocol warns against that misuse twice, and applying it
to 24 unbuilt entries would file them under *"done; a look is owed, nothing is blocked"* — worse than
the present silence, because then a reader in either place stops looking. The selector is the defect.

## Not established

The triage was read from entry headings and each entry's own gate reasoning, **not** from re-verifying
against the code. Whoever takes RV-143 should re-read each of the 24 rather than trusting the split —
that caveat is in the entry.
