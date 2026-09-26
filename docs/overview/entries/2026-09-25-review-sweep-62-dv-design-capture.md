
**Follow-up (2026-09-26, `review/sweep-62b-dv-design-start-here`):** the owner asked whether DV had
been given enough to produce effective results. The honest answer was "not quite". Part D was right
about *what* to measure, but it left four things for DV to work out mid-sitting:
- whether the image channel works at all;
- which screens come first, for a pass bigger than one sitting;
- the harness calls. A script `focus()` does not raise the Android keyboard, and
  `synthesizeScrollGesture` is unproven there. `rawTap`/`rawSwipe` are what work.
- what counts as design-token "drift".

A "Start here" section now covers all four: prove the channel with one image, work tiers of the
daily screens first, keep to about 60 labelled images, and measure drift against the `@theme`
tokens.
