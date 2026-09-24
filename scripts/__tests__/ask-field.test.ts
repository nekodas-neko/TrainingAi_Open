import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { askFromLines } = require('../lib/ask');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { bucketFor } = require('../lib/queue-buckets');

describe('askFromLines', () => {
  it('reads the colon form', () => {
    expect(askFromLines(['- **Ask:** owner — delete the route?'])).toBe('owner — delete the route?');
  });

  it('reads the closing-bold dash form, which referenceFromLines misses', () => {
    expect(askFromLines(['- **Ask** — owner: retire the card?'])).toBe('owner: retire the card?');
  });

  it('ignores a sentence that merely uses the word', () => {
    expect(askFromLines(['- we should ask the owner about the anchor'])).toBeNull();
  });

  it('ignores a longer word starting with Ask', () => {
    expect(askFromLines(['- **Asking:** owner'])).toBeNull();
  });

  it('treats an empty note as no field, so a blank line cannot promote an entry', () => {
    expect(askFromLines(['- **Ask:**   '])).toBeNull();
  });

  it('takes the first of several', () => {
    expect(askFromLines(['- **Ask:** owner — first', '- **Ask:** owner — second'])).toBe('owner — first');
  });
});

describe('bucketFor with an Ask', () => {
  const base = { lane: 'O', verify: null, keep: null, reference: null, ask: null };

  it('sends an Ask entry to its own bucket', () => {
    expect(bucketFor({ ...base, ask: 'owner — a question' }, [])).toBe('ask');
  });

  it('OUTRANKS parked — a gated owner question must still be seen', () => {
    expect(bucketFor({ ...base, ask: 'owner — a question' }, ['Gate: owner'])).toBe('ask');
  });

  it('outranks verify, keep and reference', () => {
    const e = { ...base, ask: 'owner — a question', verify: { value: 'device' }, keep: { text: 'x' }, reference: 'y' };
    expect(bucketFor(e, [])).toBe('ask');
  });

  it('changes nothing when absent — parked still wins over ready', () => {
    expect(bucketFor(base, ['Gate: owner'])).toBe('parked');
    expect(bucketFor(base, [])).toBe('ready');
  });
});
