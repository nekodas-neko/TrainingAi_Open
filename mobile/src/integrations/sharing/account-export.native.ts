import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { AccountConnection } from '../../features/account/session';
export async function shareAccountExport(connection: AccountConnection) {
  if (!connection.streamExport) {
    throw new Error('Sign in again to export your account.');
  }
  const file = new File(Paths.cache, `trainingai-export-${Date.now()}.ndjson`);
  file.create();
  const handle = file.open();
  let tail = '';
  try {
    await connection.streamExport(async (bytes) => {
      handle.writeBytes(bytes);
      tail = (tail + String.fromCharCode(...bytes.slice(-2048))).slice(-2048);
    });
    handle.close();
    const last = tail.trim().split('\n').at(-1);
    if (!last || JSON.parse(last)._complete !== true) {
      throw new Error('The export did not complete. Retry when connected.');
    }
    if (!(await Sharing.isAvailableAsync())) {
      throw new Error('Sharing is unavailable on this device.');
    }
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/x-ndjson',
      ...(Platform.OS === 'ios' ? { UTI: 'public.json' } : {}),
      dialogTitle: 'Export my data',
    });
  } catch (error) {
    try {
      handle.close();
    } catch {}
    if (file.exists) {
      file.delete();
    }
    throw error;
  }
}
