"use client";

import { useEffect, useState, useRef } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Plus, Pencil, Trash2, X, Check, Loader2, Search, Download, Play,
  RefreshCw, Square, Upload, ImageIcon, Sparkles, CheckCircle2, XCircle,
} from "lucide-react";
import { AddExerciseSheet } from "@/components/exercises/add-exercise-sheet";
import { invalidateExerciseLibrary } from "@/lib/cache-groups";
import type { MuscleAssignment, ExerciseType } from "@trainingai/shared/types/program";

interface ExerciseRow {
  id: string;
  name: string;
  equipment: string[];
  muscles: MuscleAssignment[];
  instructions?: string;
  exerciseType: ExerciseType;
  gifUrl: string | null;
  imageUrl: string | null;
}

interface MediaRow {
  gifUrl: string | null;
  generatedAt: string | null;
  modelUsed: string | null;
}

type GifSource = "ai" | "dataset" | "custom" | null;

const EQUIPMENT_OPTIONS = ["barbell", "dumbbell", "cable", "kettlebell", "machine", "bodyweight"];
const MUSCLE_OPTIONS = [
  "Chest", "Shoulders", "Triceps", "Biceps", "Forearms",
  "Upper Back", "Lats", "Lower Back", "Traps", "Core",
  "Quads", "Hamstrings", "Glutes", "Calves", "Adductors",
];

function ToggleChips({ label, options, selected, onChange }: {
  label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const active = selected.includes(o);
          return (
            <button
              key={o} type="button"
              onClick={() => onChange(active ? selected.filter(s => s !== o) : [...selected, o])}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}
              style={active ? { borderColor: "var(--color-brand)", color: "var(--color-brand)" } : undefined}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MuscleChips({ muscles, onChange }: { muscles: MuscleAssignment[]; onChange: (v: MuscleAssignment[]) => void; }) {
  function toggle(muscle: string, role: "main" | "secondary") {
    const existing = muscles.find(m => m.muscle === muscle);
    if (existing) {
      if (existing.role === role) onChange(muscles.filter(m => m.muscle !== muscle));
      else onChange(muscles.map(m => m.muscle === muscle ? { ...m, role } : m));
    } else {
      onChange([...muscles, { muscle, role }]);
    }
  }
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">Muscles</p>
      <div className="flex flex-wrap gap-1.5">
        {MUSCLE_OPTIONS.map(m => {
          const a = muscles.find(x => x.muscle === m);
          return (
            <div key={m} className="flex rounded-lg overflow-hidden border border-border text-xs">
              <button type="button" onClick={() => toggle(m, "main")}
                className={`px-2 py-1 transition-colors ${a?.role === "main" ? "bg-brand text-brand-foreground font-semibold" : "text-muted-foreground hover:text-foreground"}`}
                style={a?.role === "main" ? { background: "var(--color-brand)" } : undefined}
              >{m}</button>
              <button type="button" onClick={() => toggle(m, "secondary")}
                className={`px-1.5 py-1 border-l border-border transition-colors ${a?.role === "secondary" ? "bg-amber-500/20 text-amber-400" : "text-muted-foreground hover:text-foreground"}`}
              >2°</button>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-muted-foreground mt-1">Tap name = primary · 2° = secondary · tap again to remove</p>
    </div>
  );
}

function ExerciseForm({ initial, onSave, onCancel, saving }: {
  initial?: ExerciseRow; onSave: (data: Omit<ExerciseRow, "id">) => void; onCancel: () => void; saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [equipment, setEquipment] = useState<string[]>(initial?.equipment ?? []);
  const [exerciseType, setExerciseType] = useState<ExerciseType>(initial?.exerciseType ?? "weighted");
  const [muscles, setMuscles] = useState<MuscleAssignment[]>(initial?.muscles ?? []);
  const [instructions, setInstructions] = useState(initial?.instructions ?? "");
  const [gifUrl, setGifUrl] = useState(initial?.gifUrl ?? "");
  const [imageUrl, setImageUrl] = useState(initial?.imageUrl ?? "");
  const [generating, setGenerating] = useState(false);

  async function handleGenerate() {
    if (!name.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/exercises/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) { toast.error("Generation failed"); return; }
      const data = await res.json();
      if (data.normalizedName) setName(data.normalizedName);
      if (data.muscles?.length) setMuscles(data.muscles);
      if (data.equipment?.length) setEquipment(data.equipment);
      if (data.instructions) setInstructions(data.instructions);
    } catch { toast.error("Generation failed"); }
    finally { setGenerating(false); }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Exercise name</p>
        <div className="flex gap-2">
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Barbell Squat" className="h-9 flex-1" />
          <Button size="sm" variant="outline" onClick={handleGenerate} disabled={generating || !name.trim()} className="shrink-0">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          </Button>
        </div>
        {initial && name !== initial.name && (
          <p className="text-[10px] text-muted-foreground mt-1">Renaming updates this exercise everywhere it&apos;s used.</p>
        )}
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Type</p>
        <div className="flex gap-1.5">
          {(["weighted", "bodyweight"] as const).map(t => (
            <button key={t} type="button" onClick={() => setExerciseType(t)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize ${exerciseType === t ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground"}`}
              style={exerciseType === t ? { borderColor: "var(--color-brand)", color: "var(--color-brand)" } : undefined}
            >{t}</button>
          ))}
        </div>
      </div>
      <ToggleChips label="Equipment" options={EQUIPMENT_OPTIONS} selected={equipment} onChange={setEquipment} />
      <MuscleChips muscles={muscles} onChange={setMuscles} />
      <div>
        <p className="text-xs text-muted-foreground mb-1">How-to instructions (optional)</p>
        <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
          placeholder="Step-by-step description…" rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Custom GIF URL (optional — overrides S3 media)</p>
        <Input value={gifUrl} onChange={e => setGifUrl(e.target.value)} placeholder="https://…/exercise.gif" className="h-9 font-mono text-xs" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground mb-1">Static thumbnail URL (optional)</p>
        <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…/exercise.jpg" className="h-9 font-mono text-xs" />
      </div>
      {gifUrl && (
        <div className="rounded-xl overflow-hidden bg-white" style={{ maxHeight: 160 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={gifUrl} alt="GIF preview" className="w-full object-contain max-h-40" />
        </div>
      )}
      <div className="flex gap-2 pt-1">
        <Button size="sm" className="flex-1"
          onClick={() => onSave({ name, equipment, muscles, instructions: instructions || undefined, exerciseType, gifUrl: gifUrl || null, imageUrl: imageUrl || null })}
          disabled={saving || !name.trim()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving} aria-label="Cancel"><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

function SourceBadge({ source }: { source: GifSource }) {
  if (!source) return null;
  const styles: Record<NonNullable<GifSource>, string> = {
    ai: "bg-violet-500/15 text-violet-400 border-violet-500/20",
    dataset: "bg-muted text-muted-foreground border-border",
    custom: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  };
  const labels: Record<NonNullable<GifSource>, string> = { ai: "AI", dataset: "dataset", custom: "custom" };
  return (
    <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${styles[source]}`}>
      {labels[source]}
    </span>
  );
}

export default function ExerciseManager() {
  const [exercises, setExercises] = useState<ExerciseRow[]>([]);
  const [media, setMedia] = useState<Record<string, MediaRow>>({});
  const [storageConfigured, setStorageConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [generating, setGenerating] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [uploadingRef, setUploadingRef] = useState(false);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const abortRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [exRes, mediaRes] = await Promise.all([
        fetch("/api/admin/exercises"),
        fetch("/api/admin/generate-exercise-media"),
      ]);
      const exData = await exRes.json();
      const mediaData = await mediaRes.json();
      setExercises(exData.exercises ?? []);
      setStorageConfigured(mediaData.storageConfigured ?? true);
      const map: Record<string, MediaRow> = {};
      for (const ex of (mediaData.exercises ?? [])) {
        if (ex.male) map[ex.name.toLowerCase()] = ex.male;
      }
      setMedia(map);
    } catch {
      toast.error("Failed to load exercises");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    fetch("/api/admin/reference-figure")
      .then(r => r.json())
      .then(j => setReferenceUrl(j.url ?? null))
      .catch(() => null);
  }, []);

  async function handleSave(data: Omit<ExerciseRow, "id">, id?: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/exercises", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(id ? { id } : {}), ...data }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Save failed");
      }
      toast.success(id ? "Exercise updated" : "Exercise added");
      setAdding(false);
      setEditingId(null);
      await Promise.all([load(), invalidateExerciseLibrary()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name: string) {
    setDeleting(name);
    try {
      const res = await fetch(`/api/admin/exercises?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setExercises(prev => prev.filter(e => e.name !== name));
      toast.success("Exercise deleted");
      await invalidateExerciseLibrary();
    } catch {
      toast.error("Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  async function mirrorOne(name: string, force = false) {
    setGenerating(prev => new Set(prev).add(name));
    try {
      const res = await fetch("/api/admin/mirror-dataset-gifs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseName: name, force }),
      });
      const json = await res.json();
      if (json.status === "no_match") toast.info(`${name}: no dataset match`);
      else if (!res.ok) toast.error(`${name}: ${json.error ?? "failed"}`);
    } catch {
      toast.error(`Mirror failed for ${name}`);
    } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(name); return n; });
      await load();
    }
  }

  async function generateOne(name: string, force = false) {
    setGenerating(prev => new Set(prev).add(name));
    try {
      const res = await fetch("/api/admin/generate-exercise-media", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseName: name, gender: "male", force }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Unknown error");
    } catch (err) {
      toast.error(`AI generate failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setGenerating(prev => { const n = new Set(prev); n.delete(name); return n; });
      await load();
    }
  }

  async function mirrorAll() {
    // Include exercises with no GIF, or those with an old absolute S3 URL (broken in browser)
    const pending = exercises.filter(ex => {
      const m = media[ex.name.toLowerCase()];
      if (!m?.gifUrl) return true;
      if (m.modelUsed === 'dataset-mirror' && !m.gifUrl.startsWith('/')) return true;
      return false;
    });
    if (!pending.length) { toast.info("All exercises already have GIFs"); return; }
    abortRef.current = false;
    let noMatch = 0;
    setProgress({ done: 0, total: pending.length, label: "Mirroring from dataset" });
    for (let i = 0; i < pending.length; i++) {
      if (abortRef.current) break;
      try {
        const res = await fetch("/api/admin/mirror-dataset-gifs", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exerciseName: pending[i].name }),
        });
        const json = await res.json();
        if (json.status === "no_match") noMatch++;
        else if (!res.ok) toast.error(`${pending[i].name}: ${json.error ?? "failed"}`);
      } catch { /* continue */ }
      setProgress({ done: i + 1, total: pending.length, label: "Mirroring from dataset" });
      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    setProgress(null);
    await load();
    const matched = pending.length - noMatch;
    toast.success(`Mirrored ${matched}/${pending.length}${noMatch ? ` (${noMatch} no match)` : ""}`);
  }

  async function generateAll() {
    const pending = exercises.filter(ex => !media[ex.name.toLowerCase()]?.gifUrl);
    if (!pending.length) { toast.info("All exercises already have GIFs"); return; }
    abortRef.current = false;
    setProgress({ done: 0, total: pending.length, label: "AI generating" });
    for (let i = 0; i < pending.length; i++) {
      if (abortRef.current) break;
      await generateOne(pending[i].name);
      setProgress({ done: i + 1, total: pending.length, label: "AI generating" });
      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 1500));
    }
    setProgress(null);
    toast.success("Done generating exercise media");
  }

  async function uploadReference(file: File) {
    setUploadingRef(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/reference-figure", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      setReferenceUrl(json.url);
      toast.success("Reference figure updated");
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setUploadingRef(false);
    }
  }

  function getSource(name: string, libGifUrl: string | null): GifSource {
    const m = media[name.toLowerCase()];
    if (m?.gifUrl) return m.modelUsed === "dataset-mirror" ? "dataset" : "ai";
    if (libGifUrl) return "custom";
    return null;
  }

  function gifProxyUrl(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return `/exercise-media/gifs/male/${slug}.gif`;
  }

  function getThumbnail(name: string, hasS3Gif: boolean, libImageUrl: string | null, libGifUrl: string | null): string | null {
    // Always derive proxy URL from name — never use the stored URL directly,
    // since old records may have non-public absolute S3 URLs.
    if (hasS3Gif) return gifProxyUrl(name);
    return libImageUrl ?? libGifUrl ?? null;
  }

  const busy = generating.size > 0 || !!progress;
  const filtered = exercises.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
  const withGif = exercises.filter(ex => !!media[ex.name.toLowerCase()]?.gifUrl).length;
  const pct = exercises.length > 0 ? Math.round((withGif / exercises.length) * 100) : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Storage warning */}
      {!storageConfigured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          <b>S3 not configured</b> — GIFs stored as data URLs in Postgres. Add{" "}
          <code>AWS_ENDPOINT_URL</code>, <code>AWS_ACCESS_KEY_ID</code>, <code>AWS_SECRET_ACCESS_KEY</code> to enable bucket storage.
        </div>
      )}

      {/* GIF coverage + bulk actions */}
      <div className="rounded-xl border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="font-semibold text-sm">Exercise GIFs</p>
            <p className="text-xs text-muted-foreground">{withGif} / {exercises.length} covered</p>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={busy} onClick={mirrorAll}>
              <Download className="w-3 h-3" /> Mirror all
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs gap-1" disabled={busy} onClick={generateAll}>
              <Play className="w-3 h-3" /> AI all
            </Button>
          </div>
        </div>
        <div className="w-full bg-muted rounded-full h-1">
          <div className="bg-primary rounded-full h-1 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-violet-400/60" />AI generated</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-muted-foreground/40" />Dataset mirror</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded bg-amber-400/60" />Custom URL</span>
        </div>
      </div>

      {/* AI style reference */}
      <div className="rounded-xl border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">AI style reference</p>
            <p className="text-xs text-muted-foreground">Anchor visual style for AI generations</p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0 gap-1.5 text-xs h-8"
            disabled={uploadingRef || !storageConfigured} onClick={() => fileInputRef.current?.click()}
          >
            {uploadingRef ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
            {referenceUrl ? "Replace" : "Upload"}
          </Button>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/gif" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) uploadReference(f); }}
          />
        </div>
        {referenceUrl ? (
          <Image src={referenceUrl} alt="Reference figure" width={80} height={80}
            unoptimized={referenceUrl.endsWith('.gif')} className="w-20 h-20 object-contain rounded-lg border bg-muted/30" />
        ) : (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ImageIcon className="w-4 h-4" />No reference — AI uses text prompts only
          </div>
        )}
      </div>

      {/* Progress banner */}
      {progress && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 dark:bg-blue-950/30 p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm min-w-0">
            <Loader2 className="w-4 h-4 animate-spin text-blue-500 shrink-0" />
            <span className="truncate">{progress.label} — {progress.done} / {progress.total}</span>
          </div>
          <Button size="sm" variant="ghost" className="shrink-0 h-7 px-2 gap-1 text-xs" onClick={() => { abortRef.current = true; }}>
            <Square className="w-3 h-3" /> Stop
          </Button>
        </div>
      )}

      {/* Search + Add */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search exercises…" className="pl-8 h-9" />
        </div>
        <Button size="sm" onClick={() => setAddSheetOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {adding && (
        <ExerciseForm onSave={data => handleSave(data)} onCancel={() => setAdding(false)} saving={saving} />
      )}

      {/* Exercise list */}
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{filtered.length} exercises</p>
        {filtered.map(ex => {
          const source = getSource(ex.name, ex.gifUrl);
          const isGenerating = generating.has(ex.name);
          const hasS3Gif = !!media[ex.name.toLowerCase()]?.gifUrl;
          const thumb = getThumbnail(ex.name, hasS3Gif, ex.imageUrl, ex.gifUrl);

          return (
            <div key={ex.id}>
              {editingId === ex.id ? (
                <ExerciseForm initial={ex} onSave={data => handleSave(data, ex.id)} onCancel={() => setEditingId(null)} saving={saving} />
              ) : (
                <div className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/30 px-3 py-2.5">
                  {/* Thumbnail */}
                  <div className="relative h-10 w-10 flex-none rounded-lg overflow-hidden bg-white flex items-center justify-center">
                    {thumb ? (
                      <Image src={thumb} alt="" fill sizes="40px"
                        unoptimized={thumb.endsWith('.gif')} className="object-cover" />
                    ) : (
                      <XCircle className="w-4 h-4 text-muted-foreground/30" />
                    )}
                  </div>

                  {/* Name + info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-sm font-medium truncate">{ex.name}</p>
                      <SourceBadge source={source} />
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {ex.equipment.join(", ") || "No equipment"}
                      {ex.muscles.length > 0 && ` · ${ex.muscles.filter(m => m.role === "main").map(m => m.muscle).join(", ")}`}
                    </p>
                  </div>

                  {/* GIF status icon */}
                  <div className="flex-none">
                    {isGenerating
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                      : hasS3Gif
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                        : <XCircle className="w-3.5 h-3.5 text-muted-foreground/30" />
                    }
                  </div>

                  {/* Actions */}
                  <div className="flex gap-1 flex-none">
                    {/* Mirror from dataset */}
                    <button
                      title={hasS3Gif ? "Re-mirror from dataset" : "Mirror from dataset"}
                      disabled={isGenerating || busy}
                      onClick={() => mirrorOne(ex.name, hasS3Gif)}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors p-1.5 rounded-lg hover:bg-muted"
                    >
                      {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    </button>
                    {/* AI generate */}
                    <button
                      title={hasS3Gif ? "Regenerate (AI)" : "Generate (AI)"}
                      disabled={isGenerating || busy}
                      onClick={() => generateOne(ex.name, hasS3Gif)}
                      className="text-muted-foreground hover:text-violet-400 disabled:opacity-30 transition-colors p-1.5 rounded-lg hover:bg-muted"
                    >
                      {hasS3Gif ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                    </button>
                    {/* Edit */}
                    <button
                      onClick={() => { setEditingId(ex.id); setAdding(false); }}
                      className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-muted"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {/* Delete */}
                    <button
                      disabled={deleting === ex.name}
                      onClick={() => handleDelete(ex.name)}
                      className="text-muted-foreground hover:text-destructive disabled:opacity-30 transition-colors p-1.5 rounded-lg hover:bg-muted"
                    >
                      {deleting === ex.name ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <AddExerciseSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        onAdded={() => { setAddSheetOpen(false); load(); }}
      />
    </div>
  );
}
