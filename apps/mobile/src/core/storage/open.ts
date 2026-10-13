import { createLocalStorage, type LocalStorage } from './LocalStorage';

let opening: Promise<LocalStorage> | null = null;

export function openLocalStorage() {
  if (!opening) {
    opening = open().catch((error: unknown) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

async function open() {
  const { openDatabaseAsync } = require('expo-sqlite') as typeof import('expo-sqlite');
  const database = await openDatabaseAsync('fitnessai.sqlite');
  try {
    return await createLocalStorage(database);
  } catch (error) {
    await database.closeAsync();
    throw error;
  }
}
