export interface SequenceInput { supersetGroup: number | null; setCount: number }
export interface SetStep { exerciseIndex: number; setIndex: number }

// Walks exercises in position order; ungrouped exercises emit their sets
// sequentially, grouped exercises round-robin across the group's members
// until every member's sets are exhausted.
export function buildSetSequence(exercises: SequenceInput[]): SetStep[] {
  const steps: SetStep[] = [];
  let i = 0;
  while (i < exercises.length) {
    const g = exercises[i].supersetGroup;
    if (g === null) {
      for (let s = 0; s < exercises[i].setCount; s++) steps.push({ exerciseIndex: i, setIndex: s });
      i++;
      continue;
    }
    const members: number[] = [];
    let j = i;
    while (j < exercises.length && exercises[j].supersetGroup === g) members.push(j++);
    const emitted = members.map(() => 0);
    let remaining = members.reduce((a, m) => a + exercises[m].setCount, 0);
    while (remaining > 0) {
      for (let k = 0; k < members.length; k++) {
        const m = members[k];
        if (emitted[k] < exercises[m].setCount) {
          steps.push({ exerciseIndex: m, setIndex: emitted[k]++ });
          remaining--;
        }
      }
    }
    i = j;
  }
  return steps;
}

// Given the step that was just completed, returns whatever comes next in the
// sequence — the same exercise's next set for an ungrouped run, or the next
// group member's set when alternating a superset. Null once the sequence is done.
export function nextStep(sequence: SetStep[], completed: SetStep): SetStep | null {
  const i = sequence.findIndex(
    (s) => s.exerciseIndex === completed.exerciseIndex && s.setIndex === completed.setIndex,
  );
  if (i === -1 || i === sequence.length - 1) return null;
  return sequence[i + 1];
}
