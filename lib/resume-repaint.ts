// BF-110 — the blank resume survives a scroll, so the renderer never died.
//
// The owner: *"this screen still happens when tabbing back. I noticed it fixes itself if you just
// scroll on it."* That detail overturns BF-80's diagnosis rather than supporting it. A dead WebView
// renderer has no document left to scroll — the process is gone and the layer tree with it, and the
// only recovery is `recreate()` plus a reload. Content that reappears when you drag it was there all
// along and simply was not painted: a compositor failure, not a process death.
//
// BF-80's handler stays and is still correct; the two are separate causes of one appearance.
//
// Two halves, in the order the entry insists on. MEASURE — record whether the shell root still has
// a real box and real children on resume, because "the DOM is intact" is an inference the scroll
// implies and nothing has recorded. Then REPAINT — the cheap fix and the wrong fix look identical
// until that measurement exists.

import { reportClientError } from './client-error';

export interface ShellSample {
  width: number;
  height: number;
  childCount: number;
}

/** The subset of an element this module needs, so the logic is reachable from a node-env test. */
export interface MeasurableEl {
  getBoundingClientRect(): { width: number; height: number };
  childElementCount: number;
}

export function readShellSample(el: MeasurableEl): ShellSample {
  const r = el.getBoundingClientRect();
  return { width: r.width, height: r.height, childCount: el.childElementCount };
}

/**
 * A real box and at least one child. False means the document genuinely lost its content, which
 * would put BF-80's renderer death back in play and make a repaint nudge the wrong fix.
 */
export function isDomIntact(s: ShellSample): boolean {
  return s.width > 0 && s.height > 0 && s.childCount > 0;
}

/**
 * Whether this resume is worth a row.
 *
 * **A row per resume would flood the table.** `error_events` prunes at 30 days and is already the
 * second-largest object in the database; the owner resumes the app many times a day, and — this is
 * the part that decides it — **JS cannot tell whether the screen was actually blank.** The DOM is
 * intact either way, so a row on every resume records nothing about the failure.
 *
 * So: a degenerate sample every time, because that is the one that would DISPROVE the compositor
 * theory and it should never be lost; and an intact sample once per launch, which is all that is
 * needed to establish the positive case the entry asks for.
 */
export function shouldReportResume(s: ShellSample, reportedThisLaunch: boolean): boolean {
  if (!isDomIntact(s)) return true;
  return !reportedThisLaunch;
}

/** Prefixed so the row is greppable beside BF-80's, which searches for `renderer`. */
export function resumeReportMessage(s: ShellSample): string {
  const verdict = isDomIntact(s) ? 'dom-intact' : 'dom-lost';
  return `bf110 resume ${verdict} w=${Math.round(s.width)} h=${Math.round(s.height)} children=${s.childCount}`;
}

/**
 * How long after the resume to look again.
 *
 * The entry's number, and the reasoning is that it has to be long enough for a WebView that is going
 * to resize to have done it, and short enough to still be the same resume. Not tuned — if the
 * readings come back ambiguous, that is a finding about the window, not a licence to keep raising it.
 */
export const RESUME_RECHECK_MS = 500;

/**
 * The second reading, which is the whole point of this pass.
 *
 * Sixteen samples separated perfectly by viewport height: every blank resume reported **667**, every
 * rendered one **826**, and 826 is the S25's real CSS viewport. 384×667 is the classic *default* a
 * WebView falls back to before it has been told the real size — so the shape is not "the renderer
 * died", it is "the WebView resumed at a fallback viewport and the app rendered almost nothing into
 * it".
 *
 * **But the data cannot yet separate that from a measurement taken too early.** If the height reads
 * 826 half a second later, the viewport was always going to resize and the bug is in when the app
 * decides to render — a JS fix. If it still reads 667, the viewport is genuinely stuck and the fix
 * is in the native layer. **Those are different files, which is why this ships before any fix.**
 *
 * `stuck` / `resized` is the verdict spelled out rather than left for a reader to diff two numbers,
 * because the person reading `error_events` at that point will be looking for one word.
 */
export function resumeRecheckMessage(first: ShellSample, second: ShellSample): string {
  const h1 = Math.round(first.height);
  const h2 = Math.round(second.height);
  const verdict = h1 === h2 ? 'stuck' : 'resized';
  return `bf110 resume recheck ${verdict} h1=${h1} h2=${h2} w2=${Math.round(second.width)} children2=${second.childCount}`;
}

/** The subset of an element the nudge writes to. */
export interface NudgeableEl {
  style: { transform: string };
  readonly offsetHeight: number;
}

/**
 * Force the compositor to re-raster, for one frame only.
 *
 * The scroll works because it makes the compositor rebuild the layer; creating and dropping a
 * promoted layer is the same instruction without touching scroll state. **Not a scroll nudge:**
 * BF-100's restoration hook lives on this same container and listens for scroll, and a programmatic
 * scroll there is a needless interaction with a fix that took six traps to get right.
 *
 * **Not a permanent `will-change`.** That buys a memory cost on every screen forever to fix a moment
 * that lasts one frame — and the repo's own compositor note warns that promotion is a tool to reach
 * for deliberately, not to leave on.
 */
export function nudgeRepaint(el: NudgeableEl, schedule: (cb: () => void) => void): void {
  el.style.transform = 'translateZ(0)';
  // Read to flush layout, so the promotion actually happens before it is undone in the next frame.
  void el.offsetHeight;
  schedule(() => { el.style.transform = ''; });
}

let reportedThisLaunch = false;

/** Exported for the test — module state would otherwise leak between cases. */
export function resetResumeReportingForTest(): void {
  reportedThisLaunch = false;
}

/**
 * Measure, file if it is worth filing, then repaint. Returns the sample so the caller can be tested
 * without reaching into module state.
 *
 * @param defer schedules the second reading. Optional so the existing single-argument call and every
 *   test of the first half keep working unchanged; when it is absent there is simply no recheck.
 */
export function handleResume(
  el: MeasurableEl & NudgeableEl,
  schedule: (cb: () => void) => void,
  defer?: (cb: () => void, ms: number) => void,
): ShellSample {
  const sample = readShellSample(el);
  if (shouldReportResume(sample, reportedThisLaunch)) {
    reportedThisLaunch = true;
    reportClientError({ message: resumeReportMessage(sample) });
    // **The recheck rides the first row's budget deliberately.** It fires only when the first sample
    // was worth filing, so a reported resume costs two rows and an unreported one costs none — the
    // table prunes at 30 days and is the second-largest object in the database, and a row on every
    // resume would record nothing, since the DOM is intact either way.
    defer?.(() => {
      reportClientError({ message: resumeRecheckMessage(sample, readShellSample(el)) });
    }, RESUME_RECHECK_MS);
  }
  nudgeRepaint(el, schedule);
  return sample;
}
