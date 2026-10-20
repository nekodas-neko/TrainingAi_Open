import { readHealthSnapshot as readApple } from '../apple-health/readHealth';
export const readHealthSnapshot = async (timezone?: string) => readApple(timezone);
