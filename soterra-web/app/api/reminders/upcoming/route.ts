import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, tasks } from "@/lib/schema";

// GET /api/reminders/upcoming
//
// Returns every event + task that:
//   - is assigned to the CALLER (assigneeId is the Clerk user id, so each
//     device only ever schedules its own items — a reminder set for the site
//     manager never pops on the foreman's phone)
//   - has reminder_at set, and in the future (no point scheduling the past)
//   - (tasks) isn't already ticked off — finished work shouldn't ping you
//
// Consumer: the ReminderSync client component, which feeds these straight into
// Capacitor LocalNotifications.schedule(). Scheduling happens on the phone, so
// reminders fire offline and need no server cron.
//
// Ported from the Montázs reminder engine (2026-07-16), adapted: Soterra's
// assigneeId is the Clerk user id directly, so there's no member-row join.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "Pacific/Auckland";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const [myEvents, myTasks] = await Promise.all([
    db
      .select()
      .from(events)
      .where(and(eq(events.assigneeId, userId), gt(events.reminderAt, now))),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.assigneeId, userId), gt(tasks.reminderAt, now), eq(tasks.done, false))),
  ]);

  const items = [
    ...myEvents.map((e) => ({
      kind: "event" as const,
      id: e.id,
      title: e.title,
      reminderAt: e.reminderAt!.toISOString(),
      body: eventBody(e.title, e.startsAt, e.allDay, e.location),
      notificationId: hashToInt(e.id),
    })),
    ...myTasks.map((t) => ({
      kind: "task" as const,
      id: t.id,
      title: t.title,
      reminderAt: t.reminderAt!.toISOString(),
      body: taskBody(t.title, t.dueAt),
      notificationId: hashToInt(t.id),
    })),
  ];

  return NextResponse.json({ ok: true, items });
}

// Body shown under the title on the phone — enough context to act on.
function eventBody(title: string, startsAt: Date, allDay: boolean, location: string | null): string {
  if (allDay) return location ? `${title} @ ${location}` : title;
  const time = new Intl.DateTimeFormat("en-NZ", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(startsAt);
  return `${time}${location ? ` @ ${location}` : ""} — ${title}`;
}

function taskBody(title: string, dueAt: Date | null): string {
  if (!dueAt) return title;
  const due = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(dueAt);
  return `Due ${due} — ${title}`;
}

// FNV-1a 32-bit, masked to 31 bits so it stays positive — Capacitor needs an
// integer notification id, and some notification systems treat negative ids as
// "any" and clobber unrelated notifications.
function hashToInt(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h & 0x7fffffff;
}
