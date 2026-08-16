"use client";

import { RotateCcwIcon, CheckIcon, SearchIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { cn } from "@trainingai/shared/utils";
import { isWidgetToolName, type WidgetResult } from "@/lib/coach/widgets";
import { stripToolCitations } from "@/lib/coach/clean-text";
import { CoachWidgetView } from "./widget-registry";

const Response = dynamic(() => import("@/components/ai/response").then(m => m.Response), { ssr: false });

interface MessagePart {
  type: string;
  text?: string;
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  url?: string;
  title?: string;
}

interface CoachMessageProps {
  role: string;
  parts: MessagePart[];
  /** False once a newer turn exists — widgets render inert rather than acting late. */
  live: boolean;
  onWidgetResult: (toolName: string, toolCallId: string, result: WidgetResult) => void;
  onReopen: (toolCallId: string) => void;
}

/** `tool-renderChoiceList` → `renderChoiceList`. Read-only tools also arrive as parts and must not
 *  render — they are how the model learned what to put in a widget, not something to show. */
function widgetToolName(type: string): string | null {
  if (!type.startsWith("tool-")) return null;
  const name = type.slice(5);
  return isWidgetToolName(name) ? name : null;
}

export function CoachMessage({ role, parts, live, onWidgetResult, onReopen }: CoachMessageProps) {
  if (role === "user") {
    const text = parts.filter(p => p.type === "text").map(p => p.text).join("");
    if (!text) return null;
    return (
      <div className="flex justify-end">
        <div className="max-w-[86%] rounded-2xl rounded-br-sm bg-foreground text-background px-3.5 py-2.5 text-sm">
          {text}
        </div>
      </div>
    );
  }

  const sources = parts.filter(p => p.type === "source-url" && p.url);

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "text" && part.text) {
          const shown = stripToolCitations(part.text);
          if (!shown) return null;
          return (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm">
                <Response className="text-sm">{shown}</Response>
              </div>
            </div>
          );
        }

        const toolName = widgetToolName(part.type);
        if (!toolName || !part.toolCallId) return null;

        // A chart is the answer, not the form that asked for one, so it never collapses — and it
        // answers itself on render, which would otherwise send it straight to the branch below a
        // frame after appearing.
        if (toolName === "renderChart") {
          return (
            <CoachWidgetView
              key={i}
              input={part.input}
              toolCallId={part.toolCallId}
              onResult={
                live && part.state === "input-available" && !part.output
                  ? result => onWidgetResult(toolName, part.toolCallId!, result)
                  : undefined
              }
            />
          );
        }

        // Answered. The widget collapses into a normal user bubble — the picker was scaffolding,
        // and scaffolding comes down. A thread read back a week later should look like a
        // conversation, not a stack of spent forms.
        if (part.state === "output-available" && part.output) {
          return <ResolvedWidget key={i} output={part.output} onReopen={() => onReopen(part.toolCallId!)} />;
        }

        if (part.state === "input-available" || part.state === "input-streaming") {
          return (
            <CoachWidgetView
              key={i}
              input={part.input}
              toolCallId={part.toolCallId}
              onResult={
                live && part.state === "input-available"
                  ? result => onWidgetResult(toolName, part.toolCallId!, result)
                  : undefined
              }
            />
          );
        }

        return null;
      })}

      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-1">
          <SearchIcon className="h-3 w-3 text-muted-foreground shrink-0" />
          {sources.slice(0, 3).map((s, i) => (
            <a
              key={i}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10.5px] text-muted-foreground underline underline-offset-2 truncate max-w-[45%]"
            >
              {hostOf(s.url!)}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

function ResolvedWidget({ output, onReopen }: { output: unknown; onReopen: () => void }) {
  const o = output as WidgetResult;

  if (o?.status === "chose") {
    return (
      <div className="flex justify-end">
        <button
          onClick={onReopen}
          className="inline-flex items-center gap-2 rounded-2xl rounded-br-sm bg-foreground text-background px-3.5 py-2.5 text-sm min-h-0"
        >
          {o.label}
          <RotateCcwIcon className="h-3 w-3 opacity-50" />
        </button>
      </div>
    );
  }

  if (o?.status === "applied") {
    return (
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-2xl border px-3.5 py-3",
          "border-[color-mix(in_oklch,var(--accent-green)_30%,transparent)]",
          "bg-[color-mix(in_oklch,var(--accent-green)_8%,transparent)]",
        )}
      >
        <CheckIcon className="h-4 w-4 shrink-0" style={{ color: "var(--accent-green)" }} />
        <span className="text-[13px] font-medium flex-1 min-w-0">{o.summary}</span>
      </div>
    );
  }

  if (o?.status === "stale") {
    return <p className="text-[11.5px] text-muted-foreground px-1">{o.detail}</p>;
  }

  return <p className="text-[11.5px] text-muted-foreground px-1">Dismissed.</p>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
