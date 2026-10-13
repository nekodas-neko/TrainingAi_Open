import { readHealthSnapshot as readApple } from '../apple-health/readHealth';
export const readHealthSnapshot = async (_timezone?: string) => readApple();
