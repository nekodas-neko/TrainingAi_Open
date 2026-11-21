import type { Entry, Navigation } from './stack';
import { top } from './stack';

/**
 * How the app moves between what is showing (#3758). No React here, so the rules are tested alone.
 *
 * A "layer" is something that can be on screen: a tab, or an open screen. When the layer on top
 * changes, `advance` says which layers play which part:
 *   slide-in / slide-out  a screen opening over the one below, or Back closing it
 *   fade-in / fade-out    a tab switch, or any change that is not a plain open or Back
 *   under                 the layer a slide moves over: stays drawn, holds still
 * Layers that are not named are at rest. A popped screen stays in `leaving` while it slides out,
 * because the stack no longer holds it. With "Remove animations" on nothing moves at all.
 */
export type Role = 'slide-in' | 'slide-out' | 'fade-in' | 'fade-out' | 'under';
export type Part = { role: Role; seq: number };
export type Motion = {
  parts: Record<string, Part>;
  leaving: Entry[];
  seq: number;
};

export const idle: Motion = { parts: {}, leaving: [], seq: 0 };

/** The Coach is drawn once per scope, so its layer is named by scope, not by visit. */
export function layerOfEntry(entry: Entry): string {
  return entry.screen === 'coach' ? `coach:${entry.scope}` : `entry:${entry.key}`;
}
export const layerOfTab = (tab: string) => `tab:${tab}`;

function topLayer(nav: Navigation): string {
  const entry = top(nav);
  return entry ? layerOfEntry(entry) : layerOfTab(nav.tab);
}

/** Whether the layer on top of `a` is also part of `b`: the layer one of them moves over. */
function stillBeneath(a: Navigation, b: Navigation): boolean {
  const entry = top(a);
  if (entry) return b.stack.some((other) => other.key === entry.key);
  return a.tab === b.tab;
}

export function advance(
  motion: Motion,
  from: Navigation,
  to: Navigation,
  reduced: boolean,
): Motion {
  if (reduced) return motion.leaving.length || Object.keys(motion.parts).length ? idle : motion;
  const was = topLayer(from);
  const now = topLayer(to);
  if (was === now) return motion;
  const seq = motion.seq + 1;
  const leaving = motion.leaving.slice();
  const parts = { ...motion.parts };
  const leave = (entry: Entry | null) => {
    if (entry && !to.stack.some((other) => other.key === entry.key)) {
      const id = layerOfEntry(entry);
      if (!leaving.some((other) => layerOfEntry(other) === id)) leaving.push(entry);
    }
  };
  const gone = top(from);
  const opened = top(to);
  const isOpen =
    !!opened && !from.stack.some((entry) => entry.key === opened.key) && stillBeneath(from, to);
  const isBack =
    !!gone && !to.stack.some((entry) => entry.key === gone.key) && stillBeneath(to, from);
  if (isOpen) {
    parts[now] = { role: 'slide-in', seq };
    // A layer already moving keeps its part; one at rest is held still under the slide.
    parts[was] = parts[was] ?? { role: 'under', seq };
  } else if (isBack) {
    leave(gone);
    parts[was] = { role: 'slide-out', seq };
    parts[now] = parts[now] ?? { role: 'under', seq };
  } else {
    // A cross-fade replaces whatever was held under an earlier slide.
    for (const id of Object.keys(parts)) if (parts[id].role === 'under') delete parts[id];
    leave(gone);
    parts[was] = { role: 'fade-out', seq };
    parts[now] = { role: 'fade-in', seq };
  }
  return { parts, leaving, seq };
}

/** A layer's motion ended. When nothing is moving any more, everything held "under" is released. */
export function finish(motion: Motion, layer: string): Motion {
  if (!motion.parts[layer] && !motion.leaving.some((entry) => layerOfEntry(entry) === layer)) {
    return motion;
  }
  const parts = { ...motion.parts };
  delete parts[layer];
  let leaving = motion.leaving.filter((entry) => layerOfEntry(entry) !== layer);
  if (Object.values(parts).every((part) => part.role === 'under')) {
    for (const id of Object.keys(parts)) delete parts[id];
    leaving = [];
  }
  return { ...motion, parts, leaving };
}

/** Every open screen to draw: the stack, then screens still sliding out. */
export function drawn(nav: Navigation, motion: Motion): Entry[] {
  const open = new Set(nav.stack.map((entry) => entry.key));
  return [...nav.stack, ...motion.leaving.filter((entry) => !open.has(entry.key))];
}

/** Whether a layer must stay drawn although it is not the active one. */
export function held(motion: Motion, layer: string): boolean {
  return !!motion.parts[layer];
}
