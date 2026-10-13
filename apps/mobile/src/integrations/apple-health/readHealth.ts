import type { HealthSnapshot } from '../../features/health/types';
export async function readHealthSnapshot(): Promise<HealthSnapshot> {
  throw new Error('Apple Health needs an iPhone development build. You can explore sample data here.');
}
