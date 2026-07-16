"use client";

import { useEffect, useState } from "react";

// True only inside the native Capacitor shell (the Android/iOS app), false in a
// browser. Everything notification-related gates on this: the web has no native
// notification scheduling, so those components no-op there by design.
export function useIsCapacitor(): boolean {
  const [isCap, setIsCap] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setIsCap(Boolean((window as any).Capacitor?.isNativePlatform?.()));
    } catch {
      /* ignore */
    }
  }, []);
  return isCap;
}
