"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WeightDial } from "@/components/ui/weight-dial";
import { Button } from "@/components/ui/button";

interface WeightDialModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (weight: number) => void;
  initialWeight?: number;
}

export const WeightDialModal = ({
  open,
  onOpenChange,
  onConfirm,
  initialWeight = 60,
}: WeightDialModalProps) => {
  const [selectedWeight, setSelectedWeight] = useState(initialWeight);

  const handleConfirm = () => {
    onConfirm(selectedWeight);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Select Weight</DialogTitle>
        </DialogHeader>

        <WeightDial value={selectedWeight} onChange={setSelectedWeight} />

        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button className="flex-1 bg-brand hover:opacity-90 text-brand-foreground" onClick={handleConfirm}>
            Use {selectedWeight} kg
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
