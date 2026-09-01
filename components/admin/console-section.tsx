/** A titled group of admin consoles.
 *
 *  Q-531: `/admin/oura-ble` was fourteen consoles stacked in the order they were written, which is
 *  the owner's *"everything is spread out sporadically"* one page down. The headings put the page in
 *  the order §4 of `docs/oura-ble-operations.md` actually uses — drain, then verify what landed,
 *  then validate it against a reference — so the runbook can be followed top to bottom.
 *
 *  `when` is the one-line answer to "why would I be on this section", because a console's own title
 *  says what it reads and never says when to read it. */
export function ConsoleSection({ step, title, when, children }: {
  /** The runbook position. Numbering the sections is what makes the page an order rather than a list. */
  step: number
  title: string
  when: string
  children: React.ReactNode
}) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-2">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {step}. {title}
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{when}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}
