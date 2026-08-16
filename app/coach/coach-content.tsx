"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import {
  ChevronLeftIcon,
  ClockIcon,
  SendIcon,
  SparklesIcon,
  WifiOffIcon,
} from "lucide-react";
import { CoachMessage } from "@/components/coach/coach-message";
import { CoachHistory } from "@/components/coach/coach-history";
import { invalidateCoachHistory } from "@/lib/cache-groups";
import type { WidgetResult } from "@/lib/coach/widgets";

const STARTERS = [
  "Change my workout",
  "What can I eat instead of rice",
  "What's lagging?",
];

interface CoachContentProps {
  tz: string;
}

export function CoachContent({ tz }: CoachContentProps) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [online, setOnline] = useState(true);
  const [threadId, setThreadId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { messages, sendMessage, addToolResult, setMessages, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/coach" }),
    // A widget's answer must resume the turn, or the conversation stops dead the moment the user
    // taps an option.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  // Coach is the one surface that genuinely cannot work offline, so it says so rather than
  // swallowing a message. A composer that silently eats input is the bug class this app keeps
  // re-fixing.
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Persist once a turn settles. Saving mid-stream would store half a message and, worse, would
  // write on every token.
  useEffect(() => {
    if (status !== "ready" || messages.length === 0) return;
    const body = JSON.stringify({
      threadId,
      messages: messages.map(m => ({ role: m.role, parts: m.parts })),
    });
    fetch("/api/coach/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.threadId) return;
        setThreadId(data.threadId);
        // The saved thread is what the history list paints from its seed.
        invalidateCoachHistory().catch(() => {});
      })
      .catch(() => {
        // History is a convenience; losing a save must never interrupt the conversation.
      });
  }, [status, messages, threadId]);

  const lastAssistantIndex = messages.map(m => m.role).lastIndexOf("assistant");

  const handleWidgetResult = useCallback(
    (toolName: string, toolCallId: string, result: WidgetResult) => {
      addToolResult({ tool: toolName as never, toolCallId, output: result as never });
    },
    [addToolResult],
  );

  /** Tapping a resolved bubble drops it back to its live widget so a choice can be changed. */
  const handleReopen = useCallback(
    (toolCallId: string) => {
      setMessages(prev =>
        prev.map(m => ({
          ...m,
          parts: m.parts.map(p =>
            (p as { toolCallId?: string }).toolCallId === toolCallId
              ? { ...(p as object), state: "input-available", output: undefined }
              : p,
          ),
        })) as UIMessage[],
      );
    },
    [setMessages],
  );

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !online || status === "streaming" || status === "submitted") return;
    sendMessage({ text: trimmed });
    setInput("");
  };

  const openThread = async (id: string) => {
    const res = await fetch(`/api/coach/threads?threadId=${id}`);
    if (!res.ok) return;
    const data = await res.json();
    setMessages((data.messages ?? []) as UIMessage[]);
    setThreadId(id);
    setShowHistory(false);
  };

  const startNew = () => {
    setMessages([]);
    setThreadId(null);
    setShowHistory(false);
  };

  const busy = status === "streaming" || status === "submitted";
  // Typing steps a live widget aside — it is an accelerator, never a gate.
  const typing = input.trim().length > 0;

  return (
    <div className="flex flex-col min-h-[100dvh] bg-page">
      <header className="flex-none flex items-center gap-2 px-3 pb-3 pt-safe-or-4">
        <button
          onClick={() => (showHistory ? setShowHistory(false) : router.back())}
          aria-label={showHistory ? "Back to conversation" : "Back"}
          className="h-12 w-12 rounded-xl grid place-items-center bg-muted/60 min-h-0"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold tracking-tight">AI Coach</h1>
        </div>
        <button
          onClick={() => setShowHistory(v => !v)}
          aria-label="History"
          aria-pressed={showHistory}
          className="h-12 w-12 rounded-xl grid place-items-center bg-muted/60 min-h-0"
        >
          <ClockIcon className="h-5 w-5" />
        </button>
      </header>

      {showHistory ? (
        <CoachHistory tz={tz} onOpenThread={openThread} onNewConversation={startNew} />
      ) : (
        <div className="flex-1 flex flex-col gap-3 px-4 pb-2">
          {messages.length === 0 && (
            <div className="flex flex-col items-center text-center gap-3 pt-14">
              <SparklesIcon className="h-7 w-7" style={{ color: "var(--accent-purple)" }} />
              <p className="text-xl font-bold tracking-tight leading-tight">
                What do you want
                <br />
                to work on?
              </p>
              <p className="text-[12.5px] text-muted-foreground max-w-[265px] leading-relaxed">
                I can look at your data, explain something, or change your program — nothing changes
                without you confirming it.
              </p>
              <div className="flex flex-col gap-2 w-full pt-4">
                {STARTERS.map(s => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-xl border border-border bg-muted/30 px-3.5 py-3 text-[13px] text-left text-muted-foreground min-h-0"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={typing ? "flex flex-col gap-3 opacity-60 transition-opacity" : "flex flex-col gap-3"}>
            {messages.map((m, i) => (
              <CoachMessage
                key={m.id}
                role={m.role}
                parts={m.parts as never[]}
                live={i === lastAssistantIndex && !busy}
                onWidgetResult={handleWidgetResult}
                onReopen={handleReopen}
              />
            ))}
          </div>

          {busy && <p className="text-[13px] text-muted-foreground px-1">Thinking…</p>}

          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5">
              <p className="text-[12.5px] text-destructive">
                Something went wrong. Ask again and I&apos;ll pick up where we left off.
              </p>
            </div>
          )}

          {!online && (
            <div className="flex items-center gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-3">
              <WifiOffIcon className="h-4 w-4 text-destructive shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold">You&apos;re offline</p>
                <p className="text-[11.5px] text-muted-foreground">
                  Coach needs a connection — nothing was sent. Your history is still readable.
                </p>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      )}

      {!showHistory && (
        <div className="flex-none flex items-end gap-2.5 px-4 pt-2 border-t border-border bg-background/60 pb-safe-action-lg">
          <textarea
            aria-label="Message AI Coach"
            ref={inputRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + "px";
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            disabled={!online}
            placeholder={online ? "Message…" : "Offline"}
            className="flex-1 resize-none rounded-xl bg-muted px-3.5 py-3 text-sm min-h-[48px] max-h-32 focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || busy || !online}
            aria-label="Send"
            className="h-12 w-12 rounded-xl grid place-items-center bg-foreground text-background disabled:opacity-40 min-h-0 flex-none"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
