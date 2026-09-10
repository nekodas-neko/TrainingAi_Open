"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { invalidateSupplements } from "@/lib/cache-groups";
import { formatDateDisplay } from "@trainingai/shared/date-utils";
import { openedOnBounds, openedOnProblem } from "./vial-date";

/**
 * The stored vial's opened date, shown and correctable (BF-136).
 *
 * **Correcting it is not a nicety, because saving a new vial is not a workaround.**
 * `listSupplementVials` orders by `openedOn DESC`, and the sheet reads `vials[0]` — so a second vial
 * dated *earlier* than the wrong one sorts below it and the card keeps windowing on the wrong date.
 * A vial stamped with today when it was opened five days ago can only be fixed in place.
 *
 * Separate from the "save a new vial" form above it on purpose. The form's date defaults to **today**
 * and must keep doing so: prefilling it from the current vial would make the next vial silently
 * inherit this one's date, which is the same defect one vial along.
 */
export function VialOpenedNote({ supplementId, vialId, openedOn, today }: {
  supplementId: string
  vialId: string
  openedOn: string
  today: string
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(openedOn);
  const [saving, setSaving] = useState(false);
  const { min, max } = openedOnBounds(today);
  const problem = editing ? openedOnProblem(value, today) : null;

  async function save() {
    if (saving || openedOnProblem(value, today)) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/supplements/${supplementId}/vials/${vialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openedOn: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      await invalidateSupplements();
      setEditing(false);
      toast.success("Opened date updated");
    } catch {
      toast.error("Could not update the date");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Measured from <span className="font-semibold text-foreground">{formatDateDisplay(openedOn)}</span>,
          when this vial was opened.
        </p>
        <Button
          variant="outline"
          className="h-9 flex-none px-3 text-xs"
          onClick={() => { setValue(openedOn); setEditing(true) }}
        >
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
      <Label htmlFor="vial-opened-fix" className="text-xs text-muted-foreground">
        This vial was opened on
      </Label>
      <Input
        id="vial-opened-fix"
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={e => setValue(e.target.value)}
        className="h-11 tabular-nums"
      />
      {problem && <p className="text-xs text-destructive">{problem}</p>}
      <div className="flex gap-2">
        <Button
          className="h-10 flex-1 bg-brand hover:opacity-90 text-brand-foreground text-sm font-semibold"
          onClick={save}
          disabled={saving || problem != null || value === openedOn}
        >
          {saving ? "Saving…" : "Save date"}
        </Button>
        <Button variant="outline" className="h-10 flex-1 text-sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
