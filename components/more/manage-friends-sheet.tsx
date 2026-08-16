"use client";

import { useState } from "react";
import Image from "next/image";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import type { Friendship } from "@trainingai/shared/types/friends";
import { UserCircle, Check, X, UserMinus } from "lucide-react";
import { invalidateFriends } from "@/lib/cache-groups";

interface ManageFriendsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  friendships: Friendship[]
  onRefresh: () => void
}

export function ManageFriendsSheet({ open, onOpenChange, friendships, onRefresh }: ManageFriendsSheetProps) {
  const [addValue, setAddValue] = useState("");
  const [sending, setSending] = useState(false);

  const pending = friendships.filter(f => f.status === 'pending' && f.addresseeId !== f.requesterId);
  const accepted = friendships.filter(f => f.status === 'accepted');

  const handleAdd = async () => {
    if (!addValue.trim()) return;
    setSending(true);
    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOrCode: addValue.trim() }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error ?? 'Failed to send request');
      }
      toast.success('Friend request sent');
      setAddValue("");
      await invalidateFriends();
      onRefresh();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Failed to send request');
    } finally {
      setSending(false);
    }
  };

  const handleAccept = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'accept' }),
    });
    await invalidateFriends();
    onRefresh();
  };

  const handleDecline = async (id: string) => {
    await fetch(`/api/friends/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'decline' }),
    });
    await invalidateFriends();
    onRefresh();
  };

  const handleRemove = async (id: string) => {
    await fetch(`/api/friends/${id}`, { method: 'DELETE' });
    toast.success('Friend removed');
    await invalidateFriends();
    onRefresh();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Manage Friends</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto space-y-5 pt-4">
          {/* Add friend */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Add Friend</p>
            <div className="flex gap-2">
              <Input
                placeholder="Email or friend code (TAI-XXXX)"
                value={addValue}
                onChange={e => setAddValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                className="flex-1"
              />
              <Button onClick={handleAdd} disabled={sending || !addValue.trim()}>
                {sending ? "…" : "Add"}
              </Button>
            </div>
          </div>

          {/* Pending requests */}
          {pending.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Pending Requests</p>
              <div className="space-y-2">
                {pending.map(f => (
                  <div key={f.id} className="flex items-center gap-3 rounded-xl bg-muted/30 p-3">
                    <UserCircle className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{f.otherUser.displayName ?? f.otherUser.name ?? 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground font-mono">{f.otherUser.friendCode}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="default" onClick={() => handleAccept(f.id)}>
                        <Check className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDecline(f.id)}>
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Friends list */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Friends ({accepted.length})
            </p>
            {accepted.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No friends yet</p>
            ) : (
              <div className="space-y-2">
                {accepted.map(f => (
                  <div key={f.id} className="flex items-center gap-3 rounded-xl bg-muted/30 p-3">
                    {f.otherUser.avatar ? (
                      <Image src={f.otherUser.avatar} alt="" width={32} height={32}
                        unoptimized={f.otherUser.avatar.startsWith('data:')} className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <UserCircle className="w-8 h-8 text-muted-foreground flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{f.otherUser.displayName ?? f.otherUser.name ?? 'Unknown'}</p>
                      <p className="text-xs text-muted-foreground font-mono">{f.otherUser.friendCode}</p>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => handleRemove(f.id)}>
                      <UserMinus className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
