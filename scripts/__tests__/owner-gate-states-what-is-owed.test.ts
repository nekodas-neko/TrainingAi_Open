import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseEntries, bareOwnerGates } = require('../lib/backlog-entries');

/** A minimal queue: the parser needs the `## Queue` heading and `### ` entry headings. */
function queue(...entries: string[]): string[] {
  return ['## Queue', '', ...entries.flatMap((e) => [...e.split('\n'), ''])];
}

const ids = (src: string[]) => bareOwnerGates(parseEntries(src)).map((e: { id: string }) => e.id);

describe('bareOwnerGates', () => {
  it('flags a bare owner gate', () => {
    expect(ids(queue('### [platform] OR-900 — a thing\n\n- **Gate:** owner'))).toEqual(['OR-900']);
  });

  it('accepts a reason after an em-dash', () => {
    expect(
      ids(queue('### [platform] OR-901 — a thing\n\n- **Gate:** owner — the drop is data-losing')),
    ).toEqual([]);
  });

  it('accepts a reason after a full stop, which several real entries use', () => {
    expect(ids(queue('### [platform] OR-902 — a thing\n\n- **Gate:** owner. The window choice.'))).toEqual([]);
  });

  it('accepts the bold-inside-the-field spelling', () => {
    expect(ids(queue('### [platform] OR-903 — a thing\n\n- **Gate: owner** — a scoring change'))).toEqual([]);
  });

  it('ignores a device gate entirely — this check is about the owner', () => {
    expect(ids(queue('### [platform] OR-904 — a thing\n\n- **Gate:** device'))).toEqual([]);
  });

  it('passes when ANY of several gate lines states the reason', () => {
    const src = queue(
      '### [platform] OR-905 — a thing\n\n- **Gate:** owner\n- **Gate: owner** — restated with the reason here',
    );
    expect(ids(src)).toEqual([]);
  });

  // The floor is 8 characters: enough to reject a bare acknowledgement, short enough that a
  // terse-but-real reason like `— the Z3 mapping.` (a live entry's) still passes.
  it('rejects a reason too short to be one', () => {
    expect(ids(queue('### [platform] OR-906 — a thing\n\n- **Gate:** owner — yes'))).toEqual(['OR-906']);
  });

  it('finds every bare gate across several entries, in queue order', () => {
    const src = queue(
      '### [platform] OR-907 — first\n\n- **Gate:** owner',
      '### [platform] OR-908 — second\n\n- **Gate:** owner — the window choice.',
      '### [platform] OR-909 — third\n\n- **Gate:** owner',
    );
    expect(ids(src)).toEqual(['OR-907', 'OR-909']);
  });

  it('is empty for a queue with no gates at all', () => {
    expect(ids(queue('### [platform] OR-910 — a thing\n\n- **Lane:** A'))).toEqual([]);
  });
});
