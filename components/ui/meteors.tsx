"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

interface Meteor {
  id: number;
  x: number;
  y: number;
  delay: number;
  duration: number;
}

interface MeteorsProps {
  number?: number;
  className?: string;
}

export function Meteors({ number = 20, className }: MeteorsProps) {
  const [meteors, setMeteors] = useState<Meteor[]>([]);

  useEffect(() => {
    const generateMeteors = () => {
      const newMeteors: Meteor[] = [];
      for (let i = 0; i < number; i++) {
        newMeteors.push({
          id: i,
          x: Math.random() * 100,
          y: Math.random() * 100,
          delay: Math.random() * 2,
          duration: Math.random() * 2 + 1,
        });
      }
      setMeteors(newMeteors);
    };

    // Generate once on mount (PERF-8) — the CSS animation already loops per-particle,
    // so a 3s regeneration only reshuffled positions cosmetically while re-rendering
    // every meteor DOM node.
    generateMeteors();
  }, [number]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {meteors.map((meteor) => (
        <div
          key={meteor.id}
          className={clsx(
            "meteor-particle absolute h-0.5 w-0.5 rounded-full bg-slate-500 shadow-[0_0_6px_1px_rgba(0,0,0,0.1)]",
            "before:absolute before:top-1/2 before:h-1 before:w-1 before:-translate-y-1/2 before:transform before:rounded-full before:bg-gradient-to-r before:from-slate-400 before:to-transparent",
            className,
          )}
          style={{
            left: `${meteor.x}%`,
            top: `${meteor.y}%`,
            animationDelay: `${meteor.delay}s`,
            animationDuration: `${meteor.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
