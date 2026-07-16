"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useIsCapacitor } from "@/lib/use-is-capacitor";

// Any client-side mutation that touches reminders can force an immediate
// re-sync with `window.dispatchEvent(new Event("soterra:remindersChanged"))`
// instead of waiting for a route change.
const REMINDERS_CHANGED_EVENT = "soterra:remindersChanged";
const CHANNEL_ID = "soterra-default";

// ReminderSync — schedules native LocalNotifications for every event/task
// assigned to the current user that has a future reminder_at.
//
// Ported from the Montázs reminder engine (2026-07-16), which is the part of
// that app that genuinely works. Why phone-side rather than server push:
//   - sub-minute precision, and it fires with no connection
//   - no paid sub-hourly cron needed
//   - each device only schedules its OWN member's items, so a reminder for the
//     site manager never pops on the foreman's phone
//
// Triggers (any one re-runs a full sync): mount (cold launch), pathname change,
// the custom event above, and app foreground (visibilitychange).
//
// Strategy: GET the authoritative server list, cancel ALL pending, reschedule
// fresh. Idempotent — edits/deletes/completions are handled for free.
//
// Renders nothing. No-ops entirely on web (no native scheduling in a browser).
export function ReminderSync() {
  const isCapacitor = useIsCapacitor();
  const { isLoaded, isSignedIn } = useUser();
  const pathname = usePathname();
  const inFlightRef = useRef(false);

  const sync = useCallback(async () => {
    if (!isCapacitor || !isLoaded || !isSignedIn) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      const { LocalNotifications } = await import("@capacitor/local-notifications");

      // Android 8+ requires every notification to belong to a registered
      // channel. Without one, schedule() SUCCEEDS but the notification is
      // silently dropped at fire time — this exact bug cost Montázs a debug
      // cycle. Idempotent, so re-running each sync is cheap. No-op on iOS.
      try {
        await LocalNotifications.createChannel({
          id: CHANNEL_ID,
          name: "Site reminders",
          description: "Reminders for inspections, deliveries, pours and tasks on your site.",
          importance: 4, // HIGH — wakes screen, sound, peeks
          visibility: 1, // PUBLIC on lockscreen
          sound: "default",
          vibration: true,
        });
      } catch {
        /* throws on iOS/web — ignore */
      }

      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== "granted") return;

      const res = await fetch("/api/reminders/upcoming", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as {
        ok: boolean;
        items?: Array<{
          kind: "event" | "task";
          id: string;
          title: string;
          reminderAt: string;
          body: string;
          notificationId: number;
        }>;
      };
      if (!json.ok || !json.items) return;

      // The server list is authoritative for what should be pending right now,
      // so wipe first. Anything no longer listed (deleted, rescheduled, ticked
      // off) simply doesn't get re-scheduled.
      const pending = await LocalNotifications.getPending();
      if (pending.notifications.length > 0) {
        await LocalNotifications.cancel({
          notifications: pending.notifications.map((n) => ({ id: n.id })),
        });
      }

      if (json.items.length === 0) return;

      await LocalNotifications.schedule({
        notifications: json.items.map((item) => ({
          id: item.notificationId,
          title: item.kind === "event" ? `📅 ${item.title}` : `✅ ${item.title}`,
          body: item.body,
          schedule: { at: new Date(item.reminderAt) },
          channelId: CHANNEL_ID, // must match a registered channel on Android; iOS ignores it
          extra: { kind: item.kind, id: item.id }, // for a future tap → deep-link handler
        })),
      });
    } catch (err) {
      // Best-effort: never block the UI, never throw at the user. The console
      // line keeps visibility under `chrome://inspect`.
      // eslint-disable-next-line no-console
      console.error("[ReminderSync] sync failed", err);
    } finally {
      inFlightRef.current = false;
    }
  }, [isCapacitor, isLoaded, isSignedIn]);

  useEffect(() => {
    void sync();
  }, [sync, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void sync();
    window.addEventListener(REMINDERS_CHANGED_EVENT, handler);
    return () => window.removeEventListener(REMINDERS_CHANGED_EVENT, handler);
  }, [sync]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [sync]);

  return null;
}
