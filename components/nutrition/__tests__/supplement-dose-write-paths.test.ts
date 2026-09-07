import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const src = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const code = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * BF-112 stage 2. Supplements are offline-first, so one save writes through FOUR consumers: the
 * local SQLite row, the outbox payload, the optimistic `Supplement` handed to `onChanged`, and the
 * API body used when there is no local store.
 *
 * **A field present in three of them is this repo's "saves but does not persist".** The sheet derives
 * them once into `doseFields` and spreads it, so the guard is that the single source is used at every
 * site rather than that four literals happen to match today.
 */
describe('a dose written once reaches every write path', () => {
  const sheet = code(src('components/nutrition/manage-supplements-sheet.tsx'));

  it('derives the structured fields exactly once', () => {
    expect(sheet).toMatch(/const doseFields = \{/);
    expect(sheet).toMatch(/defaultAmount:/);
    expect(sheet).toMatch(/dosePrompt,/);
    expect(sheet).toMatch(/startedOn:/);
    expect(sheet).toMatch(/stoppedOn:/);
  });

  it('spreads that one object into all four consumers', () => {
    // local row, outbox payload, optimistic Supplement, API body.
    expect(sheet.match(/\.\.\.doseFields/g) ?? []).toHaveLength(4);
  });

  it('parses a blank amount to null rather than NaN', () => {
    // `Number('')` is 0 and `Number('x')` is NaN; either would be written as a real dose.
    expect(sheet).toMatch(/amount\.trim\(\) === '' \? null : Number\(amount\)/);
    expect(sheet).toMatch(/Number\.isFinite/);
  });

  it('reads the fields back when an existing supplement is opened', () => {
    // Without this an edit blanks whatever was set, which is a silent data loss on every save.
    expect(sheet).toMatch(/setAmount\(s\.defaultAmount == null \? '' : String\(s\.defaultAmount\)\)/);
    expect(sheet).toMatch(/setDosePrompt\(s\.dosePrompt === true\)/);
    expect(sheet).toMatch(/setStartedOn\(s\.startedOn \?\? ''\)/);
    expect(sheet).toMatch(/setStoppedOn\(s\.stoppedOn \?\? ''\)/);
  });

  it('carries the dose fields through the DEVICE read path too', () => {
    // The nutrition tab's local-first branch returns early, so a field it drops is missing on the
    // APK and present in the browser — where there is no local store and the server's mapping wins.
    const page = code(src('lib/hooks/use-supplements.ts'));
    for (const f of ['defaultAmount:', 'unit:', 'startedOn:', 'stoppedOn:', 'dosePrompt:', 'loggedAmount:']) {
      expect(page, `${f} dropped on the local-first branch`).toContain(f);
    }
    expect(page).toMatch(/summariseSupplementDay\(logs\)/);
  });

  it('and the section renders what was logged, through the shared helper', () => {
    const section = code(src('components/nutrition/supplements-section.tsx'));
    expect(section).toMatch(/supplementSubtitle\(s\)/);
    expect(section, 'the raw dose string alone was the old behaviour').not.toMatch(/\{s\.dose && </);
  });
});

/**
 * The titration prompt (a supplement whose dose changes week to week). The hazard here is a *second*
 * write path: a dialog that saves the log itself would duplicate the local/outbox/API fan-out above
 * and drift from it. The prompt therefore only collects a number and re-enters `toggleLog`.
 */
describe('the dose prompt does not become a second write path', () => {
  const section = code(src('components/nutrition/supplements-section.tsx'));

  it('confirming the dialog calls the same toggleLog', () => {
    expect(section).toMatch(/toggleLog\(s, Number\(promptAmount\)\)/);
    // One log-writing function, not two.
    expect(section.match(/await store\.upsertSupplementLog\(/g) ?? []).toHaveLength(1);
    expect(section.match(/queueMutation\(/g) ?? []).toHaveLength(2); // the log and its delete
  });

  it('prompts only when the flag is set, the row is not already logged, and no amount came back', () => {
    expect(section).toMatch(/if \(s\.dosePrompt && !s\.loggedToday && promptedAmount == null\)/);
  });

  it('carries the prompted amount into the local row, the outbox and the API body', () => {
    expect(section).toMatch(/\.\.\.\(dose \? \{ amount: dose\.amount, unit: dose\.unit \} : \{\}\)/);
    expect(section).toMatch(/\.\.\.\(dose \?\? \{\}\)/);
    expect(section).toMatch(/body: JSON\.stringify\(dose\)/);
  });

  it('omits the dose entirely on a plain tick, so the backend stamps the definition', () => {
    // BF-3 gap 1: sending `amount: null` would record "took none of it" instead of "took the usual".
    expect(section).toMatch(/promptedAmount == null \? null : \{ amount: promptedAmount/);
  });
});
