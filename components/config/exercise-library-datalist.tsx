"use client";

import { useMemo } from "react";
import type { ExerciseLibraryEntry } from "@trainingai/shared/types/program";

/**
 * The document-global id of the one exercise-name `<datalist>` (RV-81).
 *
 * Exported so a second autocomplete over this library points **here** rather than rendering a rival
 * copy — which is the shape this entry existed to remove.
 */
export const EXERCISE_LIBRARY_LIST_ID = "ex-lib";

/**
 * One `<datalist>` of exercise names for the whole document.
 *
 * It used to be rendered **inside** the program editor's `sess.exercises.map(...)` with a per-row
 * id, so an editor holding 25 exercises against a 156-row library built **3,900 `<option>`
 * elements** where 156 would do. The multiplier is that the editor's state is lifted to its parent:
 * every keystroke in any exercise-name input re-renders the sheet and recreated all of them.
 *
 * **A shared list is exactly equivalent, not a trade.** `datalist` ids are document-global and the
 * per-row content was byte-identical — the same `filter(l => !l.mergedInto)` every time.
 *
 * Its own component rather than a block in the sheet because that file is a size-ratcheted hotspot,
 * and because a shared element with a document-global id should be somewhere a second consumer can
 * find it.
 *
 * **What is NOT claimed: a latency figure.** Nothing in the sandbox drives a Samsung WebView, so
 * this is an element-count fix (3,900 → 156). The entry says so and so does this.
 */
export function ExerciseLibraryDatalist({ exerciseLibrary }: { exerciseLibrary: ExerciseLibraryEntry[] }) {
  const options = useMemo(
    () => exerciseLibrary.filter(l => !l.mergedInto),
    [exerciseLibrary],
  );
  return (
    <datalist id={EXERCISE_LIBRARY_LIST_ID}>
      {options.map(l => (
        <option key={l.id} value={l.name} />
      ))}
    </datalist>
  );
}
