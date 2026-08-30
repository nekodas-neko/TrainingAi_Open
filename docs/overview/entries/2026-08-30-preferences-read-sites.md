# Preferences survive a fresh install now (Q-392)

**Branch:** `feat/preferences-read-sites` · **Lane B**

The owner's report: *"when i do a new install or open on computer - it loses all the saved
preferences. We need to make it persist across installs/etc."*

The engine for this shipped separately — `users.preferences` as a JSONB bag, `GET`/`PATCH
/api/user/preferences` reading and merging it — and **no read site called it**. Nothing
user-visible had changed, so the report was still true in full. This connects them.

## Shape

`lib/user/preferences-sync.ts`, two functions and one rule.

**`hydrateUserPreferences(bag)`** seeds every device key from the server, driven by
`PREFERENCE_STORAGE` rather than transcribed. It is warmed in `sync-provider.tsx`'s `CACHE_TASKS`
beside `hydrateGoalSeeds`, which is the same shape of problem solved the same way (Q-241).

**`savePreference(name, value)`** / **`savePreferences(patch)`** write the device copy and PATCH the
server. `null` clears a key, which is the route's own contract.

**The conflict rule is one-directional: the server wins.** `localStorage` is a seed written *from*
the server, never the reverse, so hydration overwrites without comparing. **But it does not clear a
key the bag lacks** — see below, that took two attempts.

**Seeding rather than reading through** is what keeps first paint synchronous. Every one of these
surfaces reads its `localStorage` key during render; making them await a fetch would trade a fixed
bug for a flash of defaults on every launch.

## The rule that was wrong, and how CI found it

The first version cleared a key the bag did not carry — absent means "never set", and a stale local
value is the "my setting came back" bug. That is right for a **settled** system and wrong in the
window that matters.

`savePreference` writes locally and PATCHes in the background, so between the tap and the
acknowledgement the bag legitimately lacks a key the user has just chosen. **`meal-label.spec.ts`
caught it**: pick a label style, reload, and hydration wiped the choice. It failed and passed on
retry — the signature of a race, not a broken assertion. **Offline it is worse than a race**: the
PATCH never lands, so the setting is reverted on the next launch, every time.

I had already caught the extreme version while writing up `backgroundSettings` — a key whose writes
*never* reach the server, so the clear fires on every launch — and treated it as one key needing an
exclusion. It was the general rule that was wrong, and **the narrow fix would have left the race in
place for every other key.** That is the part worth carrying: an exclusion list is what you reach for
when you have mistaken a rule's failure for a single key's.

Hydration now writes what the bag has and deletes nothing. The server *could* distinguish "cleared"
from "never set" by storing a null, but `mergePreferences` deletes the key, so the GET cannot tell
them apart — and changing that is a server change (Lane A). Not deleting is the right client
behaviour either way.

What that gives up is a key cleared on another device lingering here. The app clears exactly one
thing — the mutually-exclusive brand preset / custom hue pair — and `EXCLUSIVE_GROUPS` resolves it:
when the bag carries one member, the others go locally. Without it a stale hue would override a
preset chosen elsewhere, the same ordering bug `savePreferences` prevents one layer out.

## The second thing CI found: a mirror effect is not a free write any more

`goals-progress-card.tsx` held the shape this whole change walks into:

```ts
useEffect(() => { localStorage.setItem(GOALS_VIEW_KEY, view) }, [view])
```

Converting that line to `savePreference` looks like a one-to-one swap and is not. The old write was
free and idempotent; the new one is **a network PATCH on every mount**, and this card renders inside
Health's launch burst — roughly twenty-five requests in the first seven seconds.

**One extra request there is enough to break the page.** Instrumented on a cold dev server: the
PATCH and a `GET /api/user/preferences` behind it stayed *pending* past sixty seconds while nothing
else was in flight, so `page.goto(…, { waitUntil: 'networkidle' })` never resolved. That failed
**nine e2e specs** — `card-429-error-state` (×4), `health-tabs-instant-paint` (×3),
`tabs-instant-paint` Health, and this branch's own `preferences-survive-reinstall` — none of which
mention preferences. Reverting that single line took `card-429` from a 45 s timeout to a 21.5 s
pass; the same PATCH fired on its own, after the burst settles, answers in **340 ms**.

**Why the requests hang rather than queue is NOT explained here**, and it is the more interesting
half: the app is evidently at a capacity cliff during launch where one more request can strand
several. Filed as its own entry rather than guessed at — it is engine-side (pool, `FOR UPDATE`
transaction, dev-server concurrency), not a preferences bug.

The fix is `usePersistedPreference(name, value)`: write the device copy on mount, PATCH only when
the value *changes*. Every other converted site is already inside a tap handler and needed nothing.

**And the obvious guard for it is wrong, which is worth more than the fix.** A `firstRun` ref does
not work: React StrictMode invokes an effect twice on mount, so the guard is spent by the second
invocation and it PATCHes anyway. Measured — that version failed `card-429` identically to no guard
at all. The test has to be the **value**, not the run count.

## Three decisions worth keeping

**`savePreferences` exists because of the theme picker.** A brand preset and a custom hue are
mutually exclusive — setting one clears the other. As two `savePreference` calls that is two PATCHes
that can land out of order and leave both set, which renders as the hue winning a choice the user
made for the preset. One patch cannot do that.

**The PATCH is fire-and-forget and deliberately not an outbox domain.** Losing one costs a toggle
that reverts on the next device, not data, and every caller is a tap that must feel instant. Queuing
it would add a synced domain, a local table and a push branch for a value the next write replaces
wholesale. The local write happens first and unconditionally, so an offline change still applies
here and is simply not carried onward.

**The encodings are the part that bites**, which is why `PREFERENCE_STORAGE` drives the loop rather
than a hand-written list: `ta_ss_widgets` is JSON, `ta_weight_lookback` a bare number, and the
reminder toggles `String(boolean)` compared at their read sites against the literal `'false'`. A
value seeded in the wrong shape reads as the default — the setting looks lost anyway, which is the
same bug wearing a different hat.

## Verification

**`e2e/preferences-survive-reinstall.spec.ts` is the owner's sentence as a test.** It PATCHes three
preferences of three different encodings, calls `localStorage.clear()` — which *is* a fresh install
from the only angle that matters, since every surface reads its key during render — reloads, and
asserts all three come back in the right shapes: `'30'`, `'arc'`, and the literal `'false'`.

**Proved both ways.** With the hydration replaced by a no-op and nothing else changed, it fails.

Thirteen unit tests cover each encoding, an absent key being **left alone** (the regression above,
pinned), the exclusive partner being cleared, a `null` server response not touching the device, every
key in the map being covered so a new preference cannot be seeded under no name, `null` meaning clear
on a save, a failed PATCH not throwing, the exclusive pair going out as one request, and `writePreferenceLocally` writing the device copy while sending **nothing**.

Full unit suite **5,625 passed** / 670 files. `pnpm check:rules` — Ran 62 of 62. Typecheck and lint
clean. `session-select-content.tsx` is **net zero lines** — it is a baselined hotspot.

## Not exercised

- **A second real device.** The test wipes `localStorage` in one browser, which proves hydration.
  It does not prove two devices converge, and it cannot: the sandbox has one session.
- **`backgroundSettings`' write path.** It is a Zustand `persist` envelope the background store owns
  and no write site sends, so the bag never carries it and hydration leaves it alone. It syncs on
  neither read nor write, exactly as before. Connecting that store's write path is what changes it.
- **The APK.** Nothing here is native, so it reaches the device through a Railway deploy — but no
  preference was toggled on the S25.
