'use client'

import { useMemo } from 'react'

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

export function Stars({ count = 18 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        top: rand(0, 55),
        size: rand(1, 2.5),
        duration: rand(2, 5),
        delay: rand(0, 5),
      })),
    [count],
  )

  // The phase's star opacity lives on a static wrapper, and the star itself
  // animates a plain 1 → 0.3.
  //
  // It used to be one element whose keyframes read `var(--bg-star-opacity)`
  // through a calc(). An opacity animation whose value derives from a custom
  // property cannot be handed to the compositor, so the browser recalculated
  // style for every star on every frame — forever, on every screen, since this
  // background is mounted in the root layout. A device profile put "Recalculate
  // style" at 19.8% of main-thread time, the single largest cost in the app.
  //
  // Nesting keeps the rendered result identical (wrapper opacity multiplies the
  // animated child opacity) while letting the animation composite.
  return (
    <>
      {stars.map((star, i) => (
        <div
          key={i}
          className="absolute"
          style={{
            left: `${star.left}%`,
            top: `${star.top}%`,
            width: `${star.size}px`,
            height: `${star.size}px`,
            opacity: 'var(--bg-star-opacity)',
          }}
        >
          <div
            className="w-full h-full rounded-full bg-white bg-particle-star motion-reduce:animate-none"
            style={{
              animationDuration: `${star.duration}s`,
              animationDelay: `${star.delay}s`,
            }}
          />
        </div>
      ))}
    </>
  )
}

export function Clouds({ count }: { count: number }) {
  const clouds = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(-20, 80),
        top: rand(5, 35),
        width: rand(160, 320),
        height: rand(50, 90),
        opacity: rand(0.25, 0.5),
        duration: rand(120, 240),
        delay: rand(-120, 0),
      })),
    [count],
  )

  return (
    <>
      {clouds.map((cloud, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-particle-cloud motion-reduce:animate-none"
          style={{
            left: `${cloud.left}%`,
            top: `${cloud.top}%`,
            width: `${cloud.width}px`,
            height: `${cloud.height}px`,
            opacity: cloud.opacity,
            background: 'radial-gradient(closest-side, rgba(255,255,255,0.9), transparent)',
            filter: 'blur(20px)',
            animationDuration: `${cloud.duration}s`,
            animationDelay: `${cloud.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function RainStreaks({ count = 30 }: { count?: number }) {
  const drops = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        height: rand(40, 80),
        duration: rand(0.5, 1),
        delay: rand(0, 1),
      })),
    [count],
  )

  return (
    <>
      {drops.map((drop, i) => (
        <div
          key={i}
          className="absolute w-px bg-particle-rain motion-reduce:animate-none"
          style={{
            left: `${drop.left}%`,
            top: '-10%',
            height: `${drop.height}px`,
            background: 'linear-gradient(to bottom, transparent, rgba(200,220,255,0.5))',
            animationDuration: `${drop.duration}s`,
            animationDelay: `${drop.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function SnowParticles({ count = 25 }: { count?: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        left: rand(0, 100),
        size: rand(2, 5),
        duration: rand(8, 15),
        delay: rand(0, 15),
      })),
    [count],
  )

  return (
    <>
      {flakes.map((flake, i) => (
        <div
          key={i}
          className="absolute rounded-full bg-white/80 bg-particle-snow motion-reduce:animate-none"
          style={{
            left: `${flake.left}%`,
            top: '-5%',
            width: `${flake.size}px`,
            height: `${flake.size}px`,
            animationDuration: `${flake.duration}s`,
            animationDelay: `${flake.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function FogBands({ count = 2 }: { count?: number }) {
  const bands = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        top: 60 + i * 15 + rand(-5, 5),
        height: rand(60, 120),
        duration: rand(60, 100),
        delay: rand(-60, 0),
      })),
    [count],
  )

  return (
    <>
      {bands.map((band, i) => (
        <div
          key={i}
          className="absolute inset-x-[-10%] bg-fog-band motion-reduce:animate-none"
          style={{
            top: `${band.top}%`,
            height: `${band.height}px`,
            background: 'linear-gradient(to right, transparent, rgba(220,225,235,0.35), transparent)',
            animationDuration: `${band.duration}s`,
            animationDelay: `${band.delay}s`,
          }}
        />
      ))}
    </>
  )
}

export function LightningFlashes({ count = 3 }: { count?: number }) {
  const flashes = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        duration: rand(10, 18),
        delay: rand(0, 15),
      })),
    [count],
  )

  return (
    <>
      {flashes.map((flash, i) => (
        <div
          key={i}
          className="absolute inset-0 bg-white bg-lightning-flash motion-reduce:hidden"
          style={{
            animationDuration: `${flash.duration}s`,
            animationDelay: `${flash.delay}s`,
          }}
        />
      ))}
    </>
  )
}
