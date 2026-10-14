import type { WeatherPlace } from '../../features/weather/data/models';
export async function weatherLocation(requestPermission = false): Promise<WeatherPlace | null> {
  if (requestPermission) throw new Error('Choose a city to preview weather in the browser.');
  return null;
}
