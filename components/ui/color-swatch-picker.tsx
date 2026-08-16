"use client"

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RARITY_COLORS } from "@trainingai/shared/rarity-colors"
import { cn } from "@trainingai/shared/utils"
import { PaletteIcon } from "lucide-react"

interface ColorSwatchPickerProps {
  value: string
  onChange: (hex: string) => void
  label?: string
  className?: string
}

export function ColorSwatchPicker({ value, onChange, label, className }: ColorSwatchPickerProps) {
  const isCustom = !RARITY_COLORS.some(c => c.hex.toLowerCase() === value.toLowerCase())

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={e => e.stopPropagation()}
          title={label ? `Change ${label} colour` : "Change colour"}
          className={cn("relative flex-none w-5 h-5 rounded-full border-2 border-background shadow-md", className)}
          style={{ background: value }}
        />
      </PopoverTrigger>
      <PopoverContent
        className="w-auto p-3"
        align="start"
        onClick={e => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">Rarity Colours</p>
        <div className="grid grid-cols-3 gap-2">
          {RARITY_COLORS.map(c => (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              onClick={() => onChange(c.hex)}
              className="w-9 h-9 rounded-full border-2 transition-transform active:scale-90 overflow-hidden"
              style={{
                background: c.hex === 'transparent'
                  ? 'repeating-conic-gradient(#888 0% 25%, #444 0% 50%) 0 0 / 10px 10px'
                  : c.hex,
                borderColor: value.toLowerCase() === c.hex.toLowerCase() ? "var(--foreground)" : "transparent",
              }}
            />
          ))}
          <label
            title="Custom colour"
            className="relative w-9 h-9 rounded-full border-2 border-dashed flex items-center justify-center cursor-pointer overflow-hidden"
            style={{ borderColor: isCustom ? "var(--foreground)" : "var(--border)" }}
          >
            <PaletteIcon className="w-4 h-4 text-muted-foreground" />
            <input
              type="color"
              value={value}
              onChange={e => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  )
}
