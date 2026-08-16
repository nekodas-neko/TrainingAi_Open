/**
 * The "COMPLETED" rubber stamp laid over the session's muscle diagram (Q-97-followup).
 *
 * Replaces the full-width banner that shipped for Q-97 — that was already an improvement, but the
 * owner asked for a treatment that reads at a glance rather than another strip of card metadata.
 *
 * Drawn in CSS in the app's own theme colour, not a licensed raster: it has to survive both themes
 * and the brand-colour picker, which a flat image cannot. `--accent-green` is the same token the
 * old banner's green came from, so the meaning does not move.
 *
 * Not colour-only state (CLAUDE.md): the stamp's own word is the label.
 */
export function CompletedStamp() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      aria-hidden
    >
      <div
        className="rounded-xl px-5 py-2.5"
        style={{
          transform: 'rotate(-12deg)',
          border: '3px solid var(--accent-green)',
          // The inner rule is what makes it read as a stamp rather than a button. Drawn with a
          // shadow rather than a second element so the whole mark is one box to position.
          boxShadow: 'inset 0 0 0 1.5px transparent, inset 0 0 0 3px var(--accent-green)',
          // A tinted PLATE, not a wash. The backdrop here is the muscle silhouette, which is
          // near-black in both themes — green text straight over it failed contrast in light mode.
          // Mixing toward --card gives the word a consistent ground while the tilt, double rule and
          // letterspacing carry the stamp reading.
          background: 'color-mix(in oklab, var(--accent-green) 18%, var(--card))',
          opacity: 0.88,
        }}
      >
        <span
          className="block text-xl font-black uppercase leading-none"
          style={{ color: 'var(--accent-green)', letterSpacing: '0.18em' }}
        >
          Completed
        </span>
      </div>
    </div>
  )
}
