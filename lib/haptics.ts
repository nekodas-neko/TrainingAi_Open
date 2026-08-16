// Fires on every scroll-snap tick (weight dial, session carousel swipe).
// Uses impact() rather than selectionChanged(), which on Android is a no-op
// unless selectionStart() was called first.
export async function hapticTick(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {}
}

// Light tap for minor confirmations (e.g. a set logged successfully).
export async function hapticLight(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {}
}

// Stronger feedback for completion events (rest timer done, workout complete).
export async function hapticSuccess(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, NotificationType } = await import('@capacitor/haptics');
    await Haptics.notification({ type: NotificationType.Success });
  } catch {}
}
