# 2026-09-28 — LA-82: the HR profile degrades on a failed read, and names what it assumed

`resolveHrProfile` guarded one of its three reads. A transient fault in `getUserById` or
`listBodyMetrics` took down every caller: the cardio hub, cardio trends, zone minutes, the HR
profile, both HR server pages, and three shared computations. It also made the hub's own four
`.catch`es on `listBodyMetrics` unreachable. All three reads are guarded now, and so is the hub's own
copy of the user read.

As decided on 2026-09-25, the failure is carried in the existing source fields rather than hidden:

- `maxHrSource: 'estimated-age-unread'` is only set when the estimate actually wins. A corroborated
  observed max above it makes the age irrelevant.
- `restingHrSource: 'unavailable'` is separate from `'default'`, which still means "no readings".

Both are exposed on `/api/cardio-week`'s `heart` block. **Rendering them is Lane B's**, and LA-82
stays in the queue re-laned to B with that as its remaining work. Until then, the Health card shows
an age-unread max as an ordinary estimate.

**Mutation pass:** an unguarded user read, no marker, the marker applied over an observed max, no
`unavailable`, and an unguarded route read were all killed. The control (log wording) survived.
