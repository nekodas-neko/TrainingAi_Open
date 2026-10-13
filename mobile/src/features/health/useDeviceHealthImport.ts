import { useAppleHealthImport } from './useAppleHealthImport';
import type { DeviceImportState } from './data/device-import';
export function useDeviceHealthImport(): DeviceImportState {
  return useAppleHealthImport();
}
