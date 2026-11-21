import { STOPPED_KMH } from '@trainingai/shared/walking/walk-pacer';

/**
 * Which GPS speed the pacer may read (#3554). A guided walk on a treadmill without the treadmill
 * option ticked has a GPS speed of about 0, which would read "Stopped" on every block while the
 * heart rate still paces the walk.
 *
 * The speed passed in is already the last 20 seconds' (`windowedSpeedKmh`), so a speed under the
 * stopped floor means no fix has moved in that while. Then, with no strap cadence and a live heart
 * rate to pace by, the speed is withheld and the ladder's next rung, heart rate, takes over. With no
 * heart rate the speed stays, so a real stop still reads "Stopped". The moment GPS moves again
 * the speed is returned and the walk is paced by it as before.
 *
 * It lives here and not in the shared ladder, which the current app also reads.
 */
export function gpsSpeedForPacing(input: {
  speedKmh: number | null;
  cadenceSpm: number | null;
  /** Heart rate that can actually pace this walk: live, and with targets to judge it against. */
  bpm: number | null;
}): number | null {
  const { speedKmh, cadenceSpm, bpm } = input;
  if (speedKmh == null || cadenceSpm != null) return speedKmh;
  if (speedKmh < STOPPED_KMH && bpm != null) return null;
  return speedKmh;
}
