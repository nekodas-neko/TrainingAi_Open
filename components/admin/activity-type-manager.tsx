"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Check, Loader2 } from "lucide-react";
import { getActivityIcon, ACTIVITY_ICON_OPTIONS } from "@trainingai/shared/constants/activity-icons";
import { ActivityIconPickerSheet } from "./activity-icon-picker-sheet";
import type { ActivityType } from "@trainingai/shared/types";
import { invalidateActivityTypes } from "@/lib/cache-groups";

function ActivityTypeForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: ActivityType;
  onSave: (data: Omit<ActivityType, 'id'>) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [icon, setIcon] = useState(initial?.icon ?? "DotsThreeCircle");
  const [isDistanceBased, setIsDistanceBased] = useState(initial?.isDistanceBased ?? false);
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [manualIconEntry, setManualIconEntry] = useState(false);

  const PreviewIcon = getActivityIcon(icon);
  const iconLabel = ACTIVITY_ICON_OPTIONS.find(o => o.name === icon)?.label;

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/40 p-4">
      <div>
        <p className="text-xs text-muted-foreground mb-1">Label</p>
        <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Rowing" className="h-9" />
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Icon</p>
        <button
          type="button"
          onClick={() => setIconPickerOpen(true)}
          className="w-full flex items-center gap-3 rounded-xl border border-border bg-background h-11 px-3 text-left hover:bg-muted/40 transition-colors"
        >
          <PreviewIcon size={24} className="flex-none" />
          <span className="text-sm flex-1 truncate">{iconLabel ?? icon}</span>
          <span className="text-xs text-muted-foreground">Change</span>
        </button>
        {manualIconEntry ? (
          <Input
            value={icon}
            onChange={e => setIcon(e.target.value)}
            placeholder="Phosphor icon name, e.g. PersonSimpleRun"
            className="h-9 font-mono text-xs mt-2"
          />
        ) : (
          <button
            type="button"
            onClick={() => setManualIconEntry(true)}
            className="text-xs text-muted-foreground underline mt-1.5"
          >
            Enter icon name manually
          </button>
        )}
        <ActivityIconPickerSheet open={iconPickerOpen} onOpenChange={setIconPickerOpen} value={icon} onSelect={setIcon} />
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Distance-based</p>
        <Switch checked={isDistanceBased} onCheckedChange={setIsDistanceBased} />
      </div>

      <div>
        <p className="text-xs text-muted-foreground mb-1">Sort order</p>
        <Input type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} className="h-9 w-24" />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          className="flex-1"
          onClick={() => onSave({ label, icon, isDistanceBased, sortOrder: parseInt(sortOrder, 10) || 0 })}
          disabled={saving || !label.trim() || !icon.trim()}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4 mr-1" />}
          Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ActivityTypeManager() {
  const [types, setTypes] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/activity-types");
      const data = await res.json();
      setTypes(data.activityTypes ?? []);
    } catch {
      toast.error("Failed to load activity types");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(data: Omit<ActivityType, 'id'>, id?: string) {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/activity-types", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(id ? { id } : {}), ...data }),
      });
      if (!res.ok) throw new Error();
      toast.success(id ? "Activity type updated" : "Activity type added");
      setAdding(false);
      setEditingId(null);
      await Promise.all([load(), invalidateActivityTypes()]);
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(`/api/admin/activity-types?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Delete failed");
      }
      setTypes(prev => prev.filter(t => t.id !== id));
      toast.success("Activity type deleted");
      await invalidateActivityTypes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => { setAdding(true); setEditingId(null); }}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {adding && (
        <ActivityTypeForm
          onSave={data => handleSave(data)}
          onCancel={() => setAdding(false)}
          saving={saving}
        />
      )}

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-14 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {types.map(t => {
            const Icon = getActivityIcon(t.icon);
            return (
              <div key={t.id}>
                {editingId === t.id ? (
                  <ActivityTypeForm
                    initial={t}
                    onSave={data => handleSave(data, t.id)}
                    onCancel={() => setEditingId(null)}
                    saving={saving}
                  />
                ) : (
                  <div className="flex items-center gap-3 rounded-2xl border border-border bg-muted/30 px-4 py-3">
                    <Icon size={24} className="flex-none" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{t.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {t.id} · {t.isDistanceBased ? "distance-based" : "non-distance"} · order {t.sortOrder}
                      </p>
                    </div>
                    <div className="flex gap-1.5 flex-none">
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => { setEditingId(t.id); setAdding(false); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-destructive"
                        disabled={deleting === t.id || t.id === 'other'}
                        onClick={() => handleDelete(t.id)}
                      >
                        {deleting === t.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
