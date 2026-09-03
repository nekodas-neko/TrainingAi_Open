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
 */
export function handleResume(
  el: MeasurableEl & NudgeableEl,
  schedule: (cb: () => void) => void,
): ShellSample {
  const sample = readShellSample(el);
  if (shouldReportResume(sample, reportedThisLaunch)) {
    reportedThisLaunch = true;
    reportClientError({ message: resumeReportMessage(sample) });
  }
  nudgeRepaint(el, schedule);
  return sample;
}
