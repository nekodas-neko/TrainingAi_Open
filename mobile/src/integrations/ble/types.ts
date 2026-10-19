// The chest-strap BLE adapter. Platform code stays behind this so the strap session and its tests
// never import the native library.
export type BleRadio = 'on' | 'off' | 'unauthorized' | 'unsupported' | 'unknown';
export type BlePermission = 'granted' | 'denied' | 'blocked';
export type FoundDevice = { id: string; name: string | null; rssi: number | null };
export type Unsubscribe = () => void;

export type StrapLink = {
  /**
   * Heart Rate Measurement (0x2A37) notifications, raw bytes. `onFailed` fires once if the
   * subscription itself fails, which leaves a link that will never deliver a beat.
   */
  onHeartRate(listener: (value: Uint8Array) => void, onFailed: () => void): Unsubscribe;
  /** Battery Level (0x2A19), raw bytes; null when the strap has no Battery Service. */
  readBattery(): Promise<Uint8Array | null>;
  /** Firmware Revision (0x2A26), raw bytes; null when the strap does not expose it. */
  readFirmware(): Promise<Uint8Array | null>;
  disconnect(): Promise<void>;
};

export type BleAdapter = {
  /** False when this build has no BLE module (web, or an APK built before it was added). */
  available: boolean;
  radio(): Promise<BleRadio>;
  onRadioChange(listener: (radio: BleRadio) => void): Unsubscribe;
  /** Android's Nearby devices permission. `request` shows the system prompt when allowed. */
  permission(request: boolean): Promise<BlePermission>;
  /** Scans for Heart Rate Service advertisers until unsubscribed. */
  scan(onFound: (device: FoundDevice) => void, onError: (message: string) => void): Unsubscribe;
  /** Direct connect, never a system bond. `onDisconnected` fires once when the link drops. */
  connect(id: string, onDisconnected: () => void): Promise<StrapLink>;
};

export const HR_SERVICE = '0000180d-0000-1000-8000-00805f9b34fb';
export const HR_MEASUREMENT = '00002a37-0000-1000-8000-00805f9b34fb';
export const BATTERY_SERVICE = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL = '00002a19-0000-1000-8000-00805f9b34fb';
export const DEVICE_INFO_SERVICE = '0000180a-0000-1000-8000-00805f9b34fb';
export const FIRMWARE_REVISION = '00002a26-0000-1000-8000-00805f9b34fb';
