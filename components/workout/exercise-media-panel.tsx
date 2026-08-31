"use client";

import { memo, useState } from "react";
import Image from "next/image";
import { DumbbellIcon } from "lucide-react";
import { useExerciseMediaFor } from "@/lib/hooks/use-exercise-media";

/**
 * The exercise name with its clip, for the per-exercise ready screen (BF-65).
 *
 * The owner asked for this so the screen "shows you what movement you will be doing", which rules
 * out hiding it behind a tap. It also cannot cost the fold: the screenshot that prompted the entry
 * already had `SET TARGETS` cut off behind the action row, and the number being read on this screen
 * is the bar load below. So the clip plays at 64 px beside the name, and tapping it opens a
 * full-width strip for anyone who wants a proper look.
 *
 * Takes the name and fetches its own media rather than being handed URLs — one scalar prop is a
 * prop no call site can destabilise, and the media arriving re-renders this and nothing else.
 */
export const ExerciseMediaPanel = memo(function ExerciseMediaPanel({ name }: { name: string }) {
  const [expanded, setExpanded] = useState(false);
  const { media } = useExerciseMediaFor(name);

  // Prefer the animation; the still start frame is the fallback for an exercise the generator only
  // produced a frame for. Null for anything the route could not match — including every bodyweight
  // movement with no library entry — which is why the dumbbell below is a defined state and not a
  // gap where the layout expects a picture.
  const src = media.gifUrl ?? media.imageUrl;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {src ? (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            aria-expanded={expanded}
            aria-label={expanded ? `Hide the ${name} animation` : `Show the ${name} animation larger`}
            className="relative h-16 w-16 flex-none rounded-xl overflow-hidden bg-white active:scale-95 transition-transform"
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="64px"
              // Mandatory on a GIF, and silent when forgotten: the optimizer returns a static image,
              // so the picture appears, looks right, and never moves.
              unoptimized={src.endsWith(".gif")}
              className="object-cover"
            />
          </button>
        ) : (
          <div
            className="h-16 w-16 flex-none rounded-xl flex items-center justify-center"
            style={{ background: "color-mix(in oklch, var(--color-muted) 80%, transparent)" }}
          >
            <DumbbellIcon className="h-6 w-6 text-muted-foreground" />
          </div>
        )}
        <h2 className="flex-1 min-w-0 text-3xl font-bold leading-tight">{name}</h2>
      </div>

      {expanded && src && (
        <div className="relative w-full h-52 rounded-2xl overflow-hidden bg-white">
          <Image
            src={src}
            alt={`${name} demonstration`}
            fill
            sizes="100vw"
            unoptimized={src.endsWith(".gif")}
            className="object-contain"
          />
        </div>
      )}
    </div>
  );
});
