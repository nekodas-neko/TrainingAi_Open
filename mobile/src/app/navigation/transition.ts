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
 * A slide names the layer it moves over (`over`). Only that layer is drawn under it, and only while
 * the slide is moving: a layer a finished slide has landed on covers whatever was beneath it.
 * Layers that are not named are at rest. A popped screen stays in `leaving` while it slides out,
 * because the stack no longer holds it. With "Remove animations" on nothing moves at all.
 */
export type Role = 'slide-in' | 'slide-out' | 'fade-in' | 'fade-out' | 'under';
export type Part = { role: Role; seq: number; over?: string };
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
    parts[now] = { role: 'slide-in', seq, over: was };
  } else if (isBack) {
    leave(gone);
    parts[was] = { role: 'slide-out', seq, over: now };
  } else {
    leave(gone);
    parts[was] = { role: 'fade-out', seq };
    parts[now] = { role: 'fade-in', seq };
  }
  return { parts: settle(parts), leaving, seq };
}

/**
 * Works out which layers are held "under" a slide that is still moving: the layer each one moves
 * over, unless that layer is moving itself. Anything else that was held is released, so a layer
 * that a slide has landed on stops showing the layer beneath it through its transparent screen.
 */
function settle(parts: Record<string, Part>): Record<string, Part> {
  const next: Record<string, Part> = {};
  for (const [id, part] of Object.entries(parts)) if (part.role !== 'under') next[id] = part;
  for (const part of Object.values(next)) {
    const under = part.role === 'slide-in' || part.role === 'slide-out' ? part.over : undefined;
    if (under && !next[under]) next[under] = parts[under] ?? { role: 'under', seq: part.seq };
  }
  return next;
}

/** A layer's motion ended. A layer a slide is still moving over stays drawn, held under it. */
export function finish(motion: Motion, layer: string): Motion {
  if (!motion.parts[layer] && !motion.leaving.some((entry) => layerOfEntry(entry) === layer)) {
    return motion;
  }
  const rest = { ...motion.parts };
  delete rest[layer];
  const parts = settle(rest);
  const leaving = Object.keys(parts).length
    ? motion.leaving.filter((entry) => layerOfEntry(entry) !== layer)
    : [];
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

/**
 * Draw order. Every layer is absolutely positioned, so sibling order would put the Coach (drawn
 * once per scope) under every screen. A screen's place is its stack key, which only grows, so a
 * screen opened later is above one opened earlier, and one that is leaving keeps its place. The
 * Coach takes the key of that scope's newest entry, open or leaving. Tabs, and anything not
 * named here, are at 0.
 */
export function layerOrder(nav: Navigation, motion: Motion): Record<string, number> {
  const order: Record<string, number> = {};
  for (const entry of drawn(nav, motion)) {
    const id = layerOfEntry(entry);
    order[id] = Math.max(order[id] ?? 0, entry.key);
  }
  return order;
}

/** For each layer a slide is moving over: the slide that covers it. The newest wins. */
export function coverOf(motion: Motion): Record<string, string> {
  const cover: Record<string, string> = {};
  const seqOf: Record<string, number> = {};
  for (const [id, part] of Object.entries(motion.parts)) {
    if ((part.role !== 'slide-in' && part.role !== 'slide-out') || !part.over) continue;
    if (!(part.over in cover) || part.seq > seqOf[part.over]) {
      cover[part.over] = id;
      seqOf[part.over] = part.seq;
    }
  }
  return cover;
}

/**
 * What a layer is drawn with. `slide`: it has its own sideways offset; a layer that fades keeps the
 * one it had, so a tab chosen mid-slide fades the screen out where it is. `fade`: its opacity moves.
 * `clip`: a slide is moving over it, so it shows only what is left of the slide's edge.
 */
export function layerLook(role: Role | undefined, covered: boolean) {
  const moving = !!role && role !== 'under';
  return {
    slide: moving,
    fade: role === 'fade-in' || role === 'fade-out',
    clip: covered,
  };
}

/**
 * Where a layer's slide and fade values start when it is given a part: an entering layer at its
 * first position, a leaving one at rest. Used while rendering, so the first frame is already there.
 * A layer already moving carries on from where it is, so it gets no values.
 */
export function startValues(role: Role, resting: boolean): { slide?: number; fade?: number } {
  if (!resting || role === 'under') return {};
  return {
    slide: role === 'slide-in' ? 0 : 1,
    fade: role === 'fade-in' ? 0 : 1,
  };
}

/**
 * Whether touches reach a layer. The layer a screen is sliding out over is the active one but is
 * still half covered by the screen leaving, so it ignores touches until the slide ends. Worked out
 * from the motion each time, so it cannot outlast it.
 */
export function touchable(active: boolean, part: Part | undefined): boolean {
  return active && part?.role !== 'under';
}
