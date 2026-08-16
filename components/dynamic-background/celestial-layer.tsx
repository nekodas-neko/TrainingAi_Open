export type CelestialVisibility = 'full' | 'dimmed' | 'hidden'

export function CelestialLayer({ visibility }: { visibility: CelestialVisibility }) {
  if (visibility === 'hidden') return null

  return (
    <div
      className="absolute h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{
        left: 'var(--bg-celestial-x)',
        top: 'var(--bg-celestial-y)',
        background:
          'radial-gradient(circle, rgba(var(--bg-celestial-glow), 0.55) 0%, rgba(var(--bg-celestial-color), 0.3) 35%, transparent 70%)',
        opacity: visibility === 'dimmed' ? 0.15 : 0.55,
      }}
    />
  )
}
