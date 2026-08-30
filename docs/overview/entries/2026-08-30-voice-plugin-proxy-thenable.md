# 2026-08-30 — The Voice button was not broken on the APK, it was absent

**Lane A · branch `fix/voice-plugin-proxy-thenable` · LA-37 · found in `error_events`**

The session-start `error_events` read returned one fault from 02:06 that morning, source `client`,
on the workout screen:

    "SpeechRecognition.then()" is not implemented on android

## The cause, and the part that makes it nasty

`components/workout/voice-log-button.tsx`:

```ts
async function getNativeSpeech() {
  try {
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition')
    return SpeechRecognition          // the raw registerPlugin() Proxy
  } catch { return null }
}
```

`registerPlugin()` returns a Proxy whose `get` trap (`node_modules/@capacitor/core`) special-cases
`$$typeof`, `toJSON`, `addListener` and `removeListener` and sends **every other key — `then`
included** — to `createPluginMethodWrapper`. So resolving this async function's promise with the
proxy makes the promise-resolution algorithm read `.then`, find a function, and call it across the
bridge as a plugin method that does not exist.

**It does not reject. It hangs.** Capacitor's wrapper ignores the `resolve`/`reject` the algorithm
handed it and returns a rejected promise instead, so nothing ever settles the outer promise and the
bridge error escapes as an unhandled rejection — which is exactly how it reached `error_events`
while the code that was awaiting simply never continued. `available` therefore stayed `null` and
`if (available === null) return null` meant **the Voice button did not render on the APK at all**.
The owner would have seen no button rather than a broken one, which is why it was never reported.

The function's own `try/catch` cannot help either way: the body has already returned.

**I got this wrong first and the test caught me.** The first draft of
`lib/__tests__/capacitor-plugin-thenable.test.ts` asserted `rejects.toThrow(...)`; it failed, with an
unhandled rejection beside it. `lib/oura-ble/plugin.ts` had said *"permanently hanging this promise
instead of resolving"* all along — the comment was right and my paraphrase of it was not. The
comments in the fix and in the check now say hang.

## The convention already existed and could not see this file

`lib/oura-ble/plugin.ts:125` describes this footgun in full, and all four **locally registered**
plugins return `{ plugin }` because of it — `oura-ble`, `scale-ble`, `polar-ble`,
`media/save-to-gallery`. It did not protect the voice button because that plugin comes from a
**community package**, so the file never contains the word `registerPlugin` and no grep for the
convention reaches it.

That is the argument for a check rather than another paragraph, and for keying it on the **shape**
(an async function resolving to a binding from a `@capacitor*` import) rather than on the call.

## What shipped

- `getNativeSpeech` returns `{ plugin } | null`, matching `getOuraBle`. `runNative` destructures it,
  and its `await` moves inside the `try` — **defensive, not load-bearing**: once the wrapper is in,
  the function's own catch covers both dynamic imports and it can no longer reject at all.
- `scripts/check-plugin-proxy-thenable.js`, wired into Custom Rules (now **62** steps). The scanner
  is pure, in `scripts/lib/plugin-proxy-scan.js`, so the rule is testable against fixtures instead
  of only against whatever the tree happens to contain.
- `lib/__tests__/capacitor-plugin-thenable.test.ts` — the invariant, executable: a faithful
  reproduction of Capacitor's `get` trap, asserting that the bare return **never settles** and leaks
  the bridge error, and that the wrapped form resolves and touches `then` not at all.

## The precision that matters: the hazard is the proxy, not the plugin

A sweep found three `return <plugin>` sites. Two are **correct** and a careless rule would have
broken them: `lib/colmi-ble/ble.ts` and `lib/live-hr/chest-strap-source.ts` both `return BleClient`,
and `@capacitor-community/bluetooth-le` exports `BleClient = new BleClientClass()` — a plain
instance whose `.then` is `undefined`. That is why the Colmi connector works while voice logging did
not, despite identical-looking code. The check exempts `BleClient` **by name with the reason
recorded**, and a test asserts the reason is there.

## Verification

- Full suite green; `pnpm check:rules` **Ran 62 of 62**; `tsc` clean; lint 0 errors (120
  pre-existing warnings, unchanged).
- **5 mutations, every anchor asserted, all 5 caught**: reinstating the shipped bug (caught by the
  new check), removing `BleClient`'s exemption (the two safe sites get flagged), the off-by-one line
  number, dropping the "imported binding only" guard, and making the fake bridge special-case `then`
  so the hazard disappears.
- **The off-by-one was real and the test found it**, not the other way round: the scanner anchored on
  the newline *before* `return`, so it reported the import line — sending a reader to the line where
  the fix does not go.

**Not exercised: the S25.** This is a WebView-only failure with no sandbox analogue —
`Capacitor.isNativePlatform()` is false in `pnpm dev` and in Playwright, so the native branch never
runs there and the bug was invisible to every green check this repo has. The fix is JS, so it
reaches the device on the next Railway deploy with **no APK rebuild**; what is owed is pressing the
button on the phone.

## What this says about the other `error_events` reads

This fault was **one row**, on one day, from one tap. It had been shipping a completely dead feature
on the canonical runtime, and no test, no lint rule and no local run could have seen it. That table
prunes at 30 days.
