"use client";

import { useState } from "react";
import { ClipboardListIcon, CopyIcon, CheckIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function ProgramExportCard() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/program-export");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setText((await res.json()).text);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy — select the text manually");
    }
  }

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => {
          setOpen(v => !v);
          if (!open && !text && !loading) load();
        }}
      >
        <span className="flex items-center gap-2 font-semibold">
          <ClipboardListIcon className="h-4 w-4" /> Export active program
        </span>
        <span className="text-xs text-muted-foreground">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Building export…
            </div>
          )}
          {error && !loading && (
            <div className="flex items-center gap-3">
              <p className="text-sm text-destructive">{error}</p>
              <button onClick={load} className="text-xs font-semibold underline">Retry</button>
            </div>
          )}
          {text && !loading && (
            <>
              <div className="flex gap-2">
                <button
                  onClick={copy}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold bg-brand text-brand-foreground hover:opacity-90 transition min-h-[40px]"
                >
                  {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={load}
                  className="rounded-lg px-3 py-2 text-xs font-semibold border border-border hover:bg-muted transition min-h-[40px]"
                >
                  Refresh
                </button>
              </div>
              <textarea
                readOnly
                value={text}
                onFocus={e => e.currentTarget.select()}
                className="w-full h-64 rounded-lg border border-border bg-muted/50 p-3 font-mono text-[11px] leading-relaxed"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
