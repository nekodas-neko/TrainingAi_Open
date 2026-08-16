import type { WeatherCondition } from '@/lib/weather/types'
import { Stars, Clouds, RainStreaks, SnowParticles, FogBands, LightningFlashes } from './particles'

export function WeatherOverlay({
  condition,
  isDay,
}: {
  condition: WeatherCondition
  isDay: boolean
}) {
  switch (condition) {
    case 'clear':
      return isDay ? null : <Stars />
    case 'cloudy':
      return <Clouds count={4} />
    case 'rain':
      return (
        <>
          <Clouds count={5} />
          <RainStreaks />
        </>
      )
    case 'fog':
      return <FogBands />
    case 'snow':
      return (
        <>
          <Clouds count={3} />
          <SnowParticles />
        </>
      )
    case 'thunderstorm':
      return (
        <>
          <Clouds count={6} />
          <RainStreaks count={36} />
          <LightningFlashes />
        </>
      )
    default:
      return null
  }
}
