import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { BleManager as Manager, State } from 'react-native-ble-plx';
import { decodeBase64 } from './base64';
import {
  BATTERY_LEVEL,
  BATTERY_SERVICE,
  DEVICE_INFO_SERVICE,
  FIRMWARE_REVISION,
  HR_MEASUREMENT,
  HR_SERVICE,
  type BleAdapter,
  type BlePermission,
  type BleRadio,
} from './types';

const CONNECT_TIMEOUT_MS = 15_000;
// A build made before the module was added has no BlePlx; constructing BleManager there throws.
const available = !!NativeModules.BlePlx;
let manager: Manager | null = null;
function ble() {
  if (!manager) {
    const { BleManager } = require('react-native-ble-plx') as typeof import('react-native-ble-plx');
    manager = new BleManager();
  }
  return manager;
}

function radioOf(state: State | `${State}`): BleRadio {
  switch (state) {
    case 'PoweredOn':
      return 'on';
    case 'PoweredOff':
      return 'off';
    case 'Unauthorized':
      return 'unauthorized';
    case 'Unsupported':
      return 'unsupported';
    default:
      return 'unknown';
  }
}

async function permission(request: boolean): Promise<BlePermission> {
  if (Platform.OS !== 'android') return 'granted';
  const wanted =
    Number(Platform.Version) >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (!request) {
    const held = await Promise.all(wanted.map((name) => PermissionsAndroid.check(name)));
    return held.every(Boolean) ? 'granted' : 'denied';
  }
  const results = Object.values(await PermissionsAndroid.requestMultiple(wanted));
  if (results.every((result) => result === PermissionsAndroid.RESULTS.GRANTED)) return 'granted';
  return results.includes(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) ? 'blocked' : 'denied';
}

export const bleAdapter: BleAdapter = {
  available,
  async radio() {
    if (!available) return 'unsupported';
    return radioOf(await ble().state());
  },
  onRadioChange(listener) {
    if (!available) return () => {};
    const subscription = ble().onStateChange((state) => listener(radioOf(state)), false);
    return () => subscription.remove();
  },
  permission,
  scan(onFound, onError) {
    if (!available) {
      onError('Update TrainingAi Preview to pair a strap.');
      return () => {};
    }
    let stopped = false;
    void ble()
      .startDeviceScan([HR_SERVICE], { allowDuplicates: false }, (error, device) => {
        if (stopped) return;
        if (error) {
          onError(error.message);
          return;
        }
        if (device)
          onFound({ id: device.id, name: device.name ?? device.localName, rssi: device.rssi });
      })
      .catch((error: unknown) => {
        if (!stopped) onError(error instanceof Error ? error.message : 'Scanning failed.');
      });
    return () => {
      stopped = true;
      void ble()
        .stopDeviceScan()
        .catch(() => {});
    };
  },
  async connect(id, onDisconnected) {
    const manager = ble();
    // Direct connect, no autoConnect: Samsung's stack does not honour it (polar-h10-ble skill §5).
    const device = await manager.connectToDevice(id, { timeout: CONNECT_TIMEOUT_MS });
    let dropped = false;
    const drop = manager.onDeviceDisconnected(id, () => {
      if (dropped) return;
      dropped = true;
      drop.remove();
      onDisconnected();
    });
    try {
      await device.discoverAllServicesAndCharacteristics();
    } catch (error) {
      drop.remove();
      await manager.cancelDeviceConnection(id).catch(() => {});
      throw error;
    }
    async function read(service: string, characteristic: string) {
      try {
        const value = await manager.readCharacteristicForDevice(id, service, characteristic);
        return decodeBase64(value.value);
      } catch {
        return null;
      }
    }
    return {
      onHeartRate(listener, onFailed) {
        // Removing the subscription ourselves reports a cancellation error; that is no failure.
        let stopped = false;
        const subscription = manager.monitorCharacteristicForDevice(
          id,
          HR_SERVICE,
          HR_MEASUREMENT,
          (error, characteristic) => {
            if (stopped) return;
            if (error) {
              stopped = true;
              onFailed();
              return;
            }
            const value = decodeBase64(characteristic?.value);
            if (value) listener(value);
          },
        );
        return () => {
          stopped = true;
          subscription.remove();
        };
      },
      readBattery: () => read(BATTERY_SERVICE, BATTERY_LEVEL),
      readFirmware: () => read(DEVICE_INFO_SERVICE, FIRMWARE_REVISION),
      async disconnect() {
        dropped = true;
        drop.remove();
        await manager.cancelDeviceConnection(id).catch(() => {});
      },
    };
  },
};
