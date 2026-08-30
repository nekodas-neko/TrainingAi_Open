"use client";

import { CoachWidgetSchema, type WidgetResult } from "@/lib/coach/widgets";
import { DOMAIN_TIER } from "@/lib/coach/patch";
import { ChoiceList } from "./choice-list";
import { joinChoiceLabels } from "@/lib/coach/choice-label";
import { ChangePreview } from "./change-preview";
import { Tier3Card } from "./tier3-card";
import { HandoffCard } from "./handoff-card";
import { NumberDial } from "./number-dial";
import { CoachChart } from "./coach-chart";

interface CoachWidgetViewProps {
  /** The tool call's arguments, straight off the stream. Validated here rather than trusted. */
  input: unknown;
  /** Needed to hand a tier-3 proposal to its own confirmation route. */
  toolCallId?: string;
  /** Absent once a newer turn exists, which renders the widget inert. */
  onResult?: (result: WidgetResult) => void;
}

/**
 * Renders one widget from a client-side tool call.
 *
 * The union is validated at this boundary even though the SDK already schema-checks the model's
 * arguments, because this component also renders **rehydrated** widgets from a persisted thread
 * (Phase 2), where the payload has been through a database round-trip and a schema version change.
 * An unrecognised or malformed widget renders a neutral card — never a crash, and never nothing,
 * because a silently missing widget leaves a conversation that asked a question with no way to
 * answer it.
 */
export function CoachWidgetView({ input, toolCallId, onResult }: CoachWidgetViewProps) {
  const parsed = CoachWidgetSchema.safeParse(input);

  if (!parsed.success) {
    return (
      <div className="rounded-2xl border border-border bg-muted/20 px-3.5 py-3">
        <p className="text-[12px] text-muted-foreground">
          This step needs a newer version of the app. Ask again and I&apos;ll answer in text instead.
        </p>
      </div>
    );
  }

  const widget = parsed.data;

  if (widget.kind === "choice_list") {
    return (
      <ChoiceList
        args={widget}
        onChoose={
          onResult
            ? opts =>
                onResult(
                  opts.length === 1
                    ? { status: "chose", id: opts[0].id, label: opts[0].label }
                    // Joined as speech, not as a JSON array: this string goes back into the
                    // model's context as the user's answer. `joinChoiceLabels` is a .ts so the
                    // join can actually be tested — vitest cannot parse JSX here.
                    : {
                        status: "chose",
                        ids: opts.map(o => o.id),
                        label: joinChoiceLabels(opts.map(o => o.label)),
                      },
                )
            : undefined
        }
      />
    );
  }

  if (widget.kind === "handoff") return <HandoffCard args={widget} />;

  // The only widget that answers itself — see ChartSchema. `onResult` is absent on a rehydrated or
  // superseded turn, and there is nothing to resolve then either: the result was sent when it first
  // rendered.
  if (widget.kind === "chart") {
    return (
      <CoachChart args={widget} onShown={onResult ? () => onResult({ status: "shown" }) : undefined} />
    );
  }

  if (widget.kind === "number_dial") {
    return (
      <NumberDial
        args={widget}
        onApplied={onResult ? summary => onResult({ status: "applied", summary }) : undefined}
        onCancel={onResult ? () => onResult({ status: "cancelled" }) : undefined}
      />
    );
  }

  // Tier 3 does not confirm in the thread. It is the only tier whose effects can take something
  // away, so it gets a pushed screen with the full consequence list and hold-to-confirm.
  if (DOMAIN_TIER[widget.patch.domain] === 3) {
    return <Tier3Card args={widget} toolCallId={toolCallId ?? ""} disabled={!onResult} />;
  }

  return (
    <ChangePreview
      args={widget}
      onApplied={onResult ? summary => onResult({ status: "applied", summary }) : undefined}
      onCancel={onResult ? () => onResult({ status: "cancelled" }) : undefined}
      onStale={onResult ? detail => onResult({ status: "stale", detail }) : undefined}
    />
  );
}
