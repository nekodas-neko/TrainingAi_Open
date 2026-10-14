"use client";

import { useRef } from 'react';
import { Button } from '@/components/ui/button';

export function SessionTimeLimit({ value, onChange }: {
  value: number;
  onChange: (minutes: number) => void;
}) {
  const previous = useRef(value > 0 ? value : 60);
  return (
    <div className="flex items-center gap-2 pl-6">
      <span className="text-xs text-muted-foreground flex-1">Time limit</span>
      <Button variant="ghost" size="sm" aria-label="Time limit" aria-pressed={value > 0}
        onClick={() => {
          if (value > 0) { previous.current = value; onChange(0); }
          else onChange(previous.current);
        }}>
        {value === 0 ? 'Off' : 'On'}
      </Button>
      {value > 0 && <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" aria-label="Decrease time limit"
          onClick={() => onChange(Math.max(20, value - 5))}>−</Button>
        <span className="text-xs tabular-nums w-16 text-center font-medium">{value} min</span>
        <Button variant="ghost" size="sm" aria-label="Increase time limit"
          onClick={() => onChange(Math.min(180, value + 5))}>+</Button>
      </div>}
    </div>
  );
}
