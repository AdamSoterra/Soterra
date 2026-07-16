"use client";

import { useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useIsCapacitor } from "@/lib/use-is-capacitor";

const ASKED_KEY = "soterra:notif-asked";

// Asks for notification permission once, on the first signed-in launch inside
// the native app. Without this, ReminderSync bails at the permission check and
// reminders silently never fire — the exact silent-failure Montázs got bitten
// by. No-op on web.
//
// TODO (Montázs parity): an in-app soft-ask card before the OS prompt, plus a
// visible warning wherever a reminder is set while permission isn't granted —
// a reminder must never be set without the user knowing whether it'll fire.
export function NotificationPermission() {
  const isCapacitor = useIsCapacitor();
  const { isLoaded, isSignedIn } = useUser();

  useEffect(() => {
    if (!isCapacitor || !isLoaded || !isSignedIn) return;
    void (async () => {
      try {
        if (window.localStorage.getItem(ASKED_KEY) === "1") return;
        const { LocalNotifications } = await import("@capacitor/local-notifications");
        const perm = await LocalNotifications.checkPermissions();
        if (perm.display === "prompt" || perm.display === "prompt-with-rationale") {
          await LocalNotifications.requestPermissions();
        }
        window.localStorage.setItem(ASKED_KEY, "1");
      } catch {
        /* best-effort */
      }
    })();
  }, [isCapacitor, isLoaded, isSignedIn]);

  return null;
}
