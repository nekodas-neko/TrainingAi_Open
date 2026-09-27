# Review sweep 62: a design and feel pass for the device agent

**Date:** 2026-09-25 · **Agent:** Review · **Docs only.**
**Owner request:** *"keep looking at reviewable actions for UI/performance/design that can be tested
through DV — get it to write up a report or screenshots so you can work on them."*

## What was already queued, so this does not duplicate it

DV's lane held 21 READY entries. Most of the obvious UI and performance probes were already among
them:
- RV-186: the performance baseline;
- RV-127: computed styles (clearance, overflow, tap targets);
- RV-152: accessibility and broken images;
- RV-150: fault injection;
- RV-125: fetch-once effects;
- RV-149 and RV-154: timezone and midnight;
- RV-153: per-tap `localStorage` writes;
- OR-162: chart re-measure.

**Two things were missing:**
1. **A way for Review to see the screens.** Every earlier probe returns numbers. That catches a
   broken clearance, but not a screen that is cramped, inconsistent or hard to read. A design
   review needs the picture.
2. **The feel metrics.** Nothing measured the time from a tap to its first visible response,
   scroll smoothness on long lists, the soft keyboard covering inputs, how consistent the type,
   colour, radius and spacing tokens are, or which animations re-layout every frame.

## What this files

- **Part D of `docs/device-agent-probe-checklist.md`, P23 to P28:**
  - P23: the screen gallery, full-length, across warm, cold, offline and error states, with
    sheets open, including gesture-navigation captures;
  - P24: tap-to-feedback latency, flagged above 100 ms;
  - P25: scroll frame times;
  - P26: keyboard occlusion;
  - P27: the design-token census, including contrast and sub-12 px text;
  - P28: the motion inventory.
- **RV-205**, a `Lane: DV` entry after RV-186, which runs Part D in one read-only sitting.

## The one structural call

DV's baton rule is *"captures never leave this machine as images"*. The reason it gives is that
the repo is public. **The screenshots go to a private Artifact on the owner's account** instead:
one per sitting, every image labelled, and the URL recorded on RV-205. Images are still never
committed. The owner's request is what changes the rule, and only for this channel. **Reversal
cost:** none. Delete the Artifact and go back to text-only reports.

## What happens next

When the gallery lands, Review reads it and writes the critique as sweep 63. Each fault goes to
Lane B as its own entry, citing its image by label. Changes that rearrange a screen still go
through the mockup-first rule before any code.
