import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from '../../../scripts/lib/strip-comments.js';

describe('RV-218 — "deficit" already says which way', () => {
  const src = stripComments(
    readFileSync(path.join(process.cwd(), 'components/health/energy-timeline-chart.tsx'), 'utf8'),
  );

  // `net` is negative on that branch, so printing it raw gave "−1,694 deficit": the sign and the
  // word both mean "under", which reads as a NEGATIVE deficit — a surplus.
  it('prints the magnitude, not the signed value', () => {
    expect(src).toMatch(/Math\.abs\(net\)\.toLocaleString\(\)\} deficit/);
  });

  // The surplus branch keeps its "+", where sign and word agree; the asymmetry is the point, so
  // pin it rather than let someone "tidy" it into a second double negative.
  it('leaves the surplus branch signed', () => {
    expect(src).toMatch(/\+\$\{net\.toLocaleString\(\)\} surplus/);
  });
});
