import type { FoundDevice, Unsubscribe } from './types.ts';

// The phone has one BLE scanner and two features that scan: pairing a strap and listening for the
// scale. Each asks for its own service, and a second `startDeviceScan` replaces the first while
// `stopDeviceScan` ends every scan, so one feature's scan used to kill the other's. The hub owns
// the scanner: it runs one native scan for the union of what is wanted, hands each device to the
// listeners whose service it advertises, and restarts the scan when a listener comes or goes.
export type NativeScan = {
  start(
    services: string[],
    lowLatency: boolean,
    onDevice: (device: FoundDevice & { services: string[] | null }) => void,
    onError: (message: string) => void,
  ): void;
  stop(): void;
};
type Listener = {
  service: string;
  lowLatency: boolean;
  onFound: (device: FoundDevice) => void;
  onError: (message: string) => void;
};

export class ScanHub {
  private listeners = new Set<Listener>();
  constructor(private native: NativeScan) {}

  /** `lowLatency` for a device that is only reachable for seconds, as the scale is. */
  add(
    service: string,
    onFound: (device: FoundDevice) => void,
    onError: (message: string) => void,
    lowLatency = false,
  ): Unsubscribe {
    const listener: Listener = {
      service: service.toLowerCase(),
      lowLatency,
      onFound,
      onError,
    };
    this.listeners.add(listener);
    this.restart();
    return () => {
      if (!this.listeners.delete(listener)) return;
      this.restart();
    };
  }

  private restart() {
    this.native.stop();
    if (!this.listeners.size) return;
    const wanted = [...this.listeners];
    const services = [...new Set(wanted.map((x) => x.service))];
    this.native.start(
      services,
      wanted.some((x) => x.lowLatency),
      (device) => {
        const advertised = device.services?.map((x) => x.toLowerCase()) ?? null;
        const { services: _unused, ...found } = device;
        for (const listener of [...this.listeners]) {
          // A scan record that names no services is only attributable when one service is wanted.
          const matches = advertised
            ? advertised.includes(listener.service)
            : services.length === 1;
          if (matches) listener.onFound(found);
        }
      },
      (message) => {
        const failed = [...this.listeners];
        this.listeners.clear();
        this.native.stop();
        for (const listener of failed) listener.onError(message);
      },
    );
  }
}
