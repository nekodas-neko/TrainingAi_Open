export function calculateSteps(distanceKm: number, heightCm: number): number {
  if (distanceKm === 0) return 0
  const strideLengthM = (heightCm / 100) * 0.415
  return Math.round((distanceKm * 1000) / strideLengthM)
}
