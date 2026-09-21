# 2026-09-21 — RV-81: one exercise catalogue, not one per row

**Lane B** · `fix/rv81-shared-exercise-datalist` · **v1.462.1**

The program editor's `<datalist>` of exercise names sat **inside** `sess.exercises.map(...)` with a
per-row id, so a 25-exercise program against a 156-row library rendered **3,900 `<option>`
elements** where 156 would do — and because the editor's state is lifted to its parent, every
keystroke in any exercise-name input re-rendered the sheet and rebuilt all of them.

One `<datalist id="ex-lib">`, memoised on `[exerciseLibrary]`, every input pointing at it. On the
seeded library that is **145 options** (146 rows, one merged) against 3,900.

**A shared list is exactly equivalent, not a trade.** `datalist` ids are document-global and the
per-row content was byte-identical — the same `filter(l => !l.mergedInto)` every time.

## The gate was right and my first instinct was wrong

I hoisted the memo and the element into `program-editor-sheet.tsx`, which took it from 956 to
**984** lines. `check-component-size.js` failed it against a 963-line baseline on a file it names a
known hotspot, with the instruction *"extract, do not append"*.

Extracting it to `components/config/exercise-library-datalist.tsx` left the sheet at **953** — below
where it started — and gave the shared element a home a second consumer can find, which is the
point of exporting `EXERCISE_LIBRARY_LIST_ID`. A ratchet that only ever blocks is an annoyance; this
one pointed at the better design.

## The control's message was wrong before it was right

The spec waited for `datalist#ex-lib` to have options. Against the pre-fix code that wait failed
with *"the shared datalist never filled — exercise_library did not reach the sheet"* — a true red
for a false reason. There is no `#ex-lib` at all before the fix; the ids were `ex-lib-<si>-<ei>`.

Split into two assertions, the control now says *"no shared datalist — the list is still being
rendered per exercise row"*. **Reading where a control goes red is not enough; read what it claims
while it is there.** A future failure on a genuinely empty library would otherwise have been
diagnosed as the defect this entry fixed.

## Verification

`e2e/rv81-one-exercise-datalist.spec.ts` opens the editor straight from `/program?new=program` (no
navigation through the tab shell), adds three exercise rows — the duplication is invisible with one
— and asserts exactly one `<datalist>`, that every `input[list]` targets it, that no orphaned
options exist anywhere else, and that the input's `list` **property** resolves to a populated
element. That last one is the real risk of sharing an id: the count can be right while the binding
is broken.

Gate: `Ran 75 of 75` Custom Rules · 7855 vitest passed, 0 failed · tsc clean · lint 0 errors ·
tests-typecheck at baseline · `check-component-size` clean.

## Not exercised

**The millisecond cost, which was never claimed.** Nothing in the sandbox drives a Samsung WebView,
so how much input lag 3,900 rebuilt elements were worth is still unknown. The entry filed this as an
element-count finding and it ships as one. **Do not quote it as a latency improvement.**

The device look is unaffected — no visual change, the list is hidden by definition.
