"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

type Tab = "assistant" | "calendar" | "tasks" | "plans" | "upload";
type Cite = { code: string; title: string; sub: string; ans: string; hlTag: string };
type AsstCard = {
  id: string;
  itemType: "event" | "task";
  action: "created" | "updated" | "deleted";
  title: string;
  when: string;
  sub: string;
  kind: string | null;
  visibility: "team" | "private";
};
type Msg =
  | { role: "u"; text: string; att?: string }
  | { role: "a"; src?: string; text: string; raw?: string; cite?: Cite; cards?: AsstCard[]; pending?: boolean };
type Attachment = { kind: "image" | "pdf"; mediaType: string; data: string; name: string };

// ─── Calendar + Tasks ─── (ported/adapted from the Montázs naptar/teendők)
const PROJECT_ID = "1-arthur-road";
// Soterra's project timezone. TODO: per-project tz once projects carry one.
const TZ = "Pacific/Auckland";

type EventKind = "inspection" | "delivery" | "pour" | "meeting" | "reminder" | "other";
type CalEvent = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  kind: EventKind | null; // null = untyped (no tag)
  visibility: "team" | "private";
  creatorName: string | null;
};
type CalTask = {
  id: string;
  title: string;
  dueAt: string | null; // ISO
  endsAt: string | null;
  done: boolean;
  visibility: "team" | "private";
  creatorName: string | null;
};

// Event types for the dropdown. Empty value = no type (optional).
const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: "inspection", label: "Inspection" },
  { value: "delivery", label: "Delivery" },
  { value: "pour", label: "Pour" },
  { value: "meeting", label: "Meeting" },
  { value: "reminder", label: "Reminder" },
  { value: "other", label: "Other" },
];

// TODO: colour by crew member once a crew table exists. For now we colour by
// event kind, reusing the dot/bar classes + CSS vars. null kind → neutral slate.
const KIND_DOT: Record<EventKind, string> = {
  inspection: "bl", delivery: "gr", pour: "nv", meeting: "pu", reminder: "am", other: "sl",
};
const KIND_BAR: Record<EventKind, string> = {
  inspection: "var(--brand)", delivery: "var(--green)", pour: "var(--navy)",
  meeting: "#8B5CF6", reminder: "var(--amber)", other: "#94A6BE",
};
const KIND_TAG: Record<EventKind, { label: string; bg: string; fg: string }> = {
  inspection: { label: "Inspection", bg: "rgba(14,116,189,.1)", fg: "var(--brand-d)" },
  delivery: { label: "Delivery", bg: "rgba(16,185,129,.12)", fg: "var(--green)" },
  pour: { label: "Pour", bg: "rgba(10,37,64,.1)", fg: "var(--navy)" },
  meeting: { label: "Meeting", bg: "rgba(139,92,246,.12)", fg: "#7C3AED" },
  reminder: { label: "Reminder", bg: "rgba(245,158,11,.14)", fg: "var(--amber)" },
  other: { label: "Other", bg: "rgba(146,166,190,.16)", fg: "var(--slate)" },
};
const dotClass = (k: EventKind | null) => (k ? KIND_DOT[k] ?? "sl" : "sl");
const barColor = (k: EventKind | null) => (k ? KIND_BAR[k] ?? "#94A6BE" : "#94A6BE");
const kindTag = (k: EventKind | null) => (k ? KIND_TAG[k] ?? null : null);

const NZ_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Auckland-anchored YYYY-MM-DD key — keeps timezones honest so two events on the
// same local day never land on separate cells. (Montázs uses Europe/Budapest.)
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function todayKey(): string {
  return dayKey(new Date());
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}
function hm24(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}
// Time-range label for an event: "1:00 PM", "1:00 PM–3:00 PM", "all day".
function fmtEventRange(e: CalEvent): string {
  if (e.allDay) return "all day";
  const start = fmtTime(e.startsAt);
  if (e.endsAt && dayKey(new Date(e.startsAt)) === dayKey(new Date(e.endsAt))) return `${start}–${fmtTime(e.endsAt)}`;
  return start;
}
// "FRI 12" style agenda stamp in the project timezone.
function fmtAgendaDay(iso: string): string {
  const wd = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short" }).format(new Date(iso)).toUpperCase();
  const day = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, day: "numeric" }).format(new Date(iso));
  return `${wd} ${day}`;
}
// Day header from a YYYY-MM-DD key → "Tue 10 Jun" (robust against tz drift).
function fmtDayHeader(k: string): string {
  const d = new Date(`${k}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-NZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(d);
}
// Short due-date label for task rows, e.g. "Wed 17". Null dueAt → no label.
function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short", day: "numeric" }).format(new Date(iso));
}
// Task time label: "2:00 PM", "2:00 PM–4:00 PM", or null when date-only.
function fmtTaskTime(t: CalTask): string | null {
  if (!t.dueAt || hm24(t.dueAt) === "00:00") return null;
  const start = fmtTime(t.dueAt);
  if (t.endsAt) return `${start}–${fmtTime(t.endsAt)}`;
  return start;
}

// Build a Mon-start grid sized to whatever the month needs (5 weeks usually, 6
// on overflow). Ported verbatim from Montázs buildMonthGrid.
function buildMonthGrid(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1, 12, 0, 0); // noon dodges DST edges
  const dow = (firstOfMonth.getDay() + 6) % 7; // Monday-start: shift so Mon=0
  const gridStart = new Date(year, month, 1 - dow, 12, 0, 0);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    days.push(d);
  }
  let lastInMonthIdx = 0;
  for (let i = 0; i < 42; i++) if (days[i].getMonth() === month) lastInMonthIdx = i;
  const weeksNeeded = Math.ceil((lastInMonthIdx + 1) / 7);
  return days.slice(0, weeksNeeded * 7);
}

const DEMO_SHEET: Cite = {
  code: "A-602",
  title: "Internal Finishes Schedule",
  sub: "95% Detail Design · Sheet 47 of 85",
  ans: 'Unit 43 — living &amp; bedrooms: <b>Resene "Alabaster"</b> (half strength). Wet areas: <b>Resene "Black White"</b>, semi-gloss. Ceilings: <b>Resene "Half White Pointer"</b> throughout.',
  hlTag: "Unit 43 · finishes",
};

const I = {
  chat: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" /></svg>),
  cal: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>),
  plans: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 3 7.5 12 12l9-4.5L12 3z" /><path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" /></svg>),
  up: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16" /></svg>),
  tasks: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>),
};
const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "assistant", label: "Assistant", icon: I.chat },
  { id: "calendar", label: "Calendar", icon: I.cal },
  { id: "tasks", label: "Tasks", icon: I.tasks },
  { id: "plans", label: "Plans", icon: I.plans },
  { id: "upload", label: "Upload", icon: I.up },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Cite | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // ─── saved conversations (threads) ───
  const [threads, setThreads] = useState<{ id: string; title: string | null; updatedAt: string }[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [railOpen, setRailOpen] = useState(false); // mobile drawer
  const [railCollapsed, setRailCollapsed] = useState(false); // desktop collapse

  // ─── voice + file attach (chat composer) ───
  const [isRecording, setIsRecording] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── live Calendar + Tasks state ───
  const now = useMemo(() => new Date(), []);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<CalTask[]>([]);
  const [evLoaded, setEvLoaded] = useState(false);
  const [taskLoaded, setTaskLoaded] = useState(false);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed
  const [calView, setCalView] = useState<"month" | "agenda">("month");
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);

  const loadEvents = async () => {
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      if (Array.isArray(data.events)) setEvents(data.events);
    } catch {
      /* leave list as-is on failure */
    } finally {
      setEvLoaded(true);
    }
  };
  const loadTasks = async () => {
    try {
      const res = await fetch("/api/tasks");
      const data = await res.json();
      if (Array.isArray(data.tasks)) setTasks(data.tasks);
    } catch {
      /* leave list as-is on failure */
    } finally {
      setTaskLoaded(true);
    }
  };

  const loadThreads = async () => {
    try {
      const res = await fetch("/api/threads");
      const data = await res.json();
      if (Array.isArray(data.threads)) setThreads(data.threads);
    } catch {
      /* ignore */
    } finally {
      setThreadsLoaded(true);
    }
  };

  // Start a fresh conversation (clears the chat; next send creates a new thread).
  const newChat = () => {
    setMessages([]);
    setThreadId(null);
    setRailOpen(false);
    setTab("assistant");
  };

  // Open a saved conversation from the sidebar.
  const loadThread = async (id: string) => {
    setRailOpen(false);
    setTab("assistant");
    try {
      const res = await fetch(`/api/threads?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (Array.isArray(data.messages)) {
        setMessages(
          data.messages.map((m: { role: string; content: string }) =>
            m.role === "assistant" ? assistantMsg(m.content) : ({ role: "u", text: m.content } as Msg)
          )
        );
        setThreadId(id);
      }
    } catch {
      /* ignore */
    }
  };

  // Lazy-load each tab's data the first time it's opened.
  useEffect(() => {
    if (tab === "calendar" && !evLoaded) loadEvents();
    if (tab === "tasks" && !taskLoaded) loadTasks();
  }, [tab, evLoaded, taskLoaded]);

  const toggleTask = async (t: CalTask) => {
    const next = !t.done;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: next } : x))); // optimistic
    try {
      const res = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, done: next }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !next } : x))); // revert
    }
  };

  // Flip a confirmation card's visibility (the "who sees this" tick-box) — one
  // click to correct the assistant when it guessed team-vs-just-me wrong, no
  // retyping. Optimistic; reverts on failure; refreshes the calendar/tasks.
  const flipCardVisibility = async (msgIdx: number, cardIdx: number) => {
    const msg = messages[msgIdx];
    if (msg.role !== "a" || !msg.cards) return;
    const card = msg.cards[cardIdx];
    if (!card || card.action === "deleted") return;
    const prev = card.visibility;
    const next = prev === "team" ? "private" : "team";
    const setVis = (v: "team" | "private") =>
      setMessages((ms) =>
        ms.map((m, i) =>
          i === msgIdx && m.role === "a" && m.cards
            ? { ...m, cards: m.cards.map((c, j) => (j === cardIdx ? { ...c, visibility: v } : c)) }
            : m
        )
      );
    setVis(next); // optimistic
    try {
      const url = card.itemType === "event" ? "/api/events" : "/api/tasks";
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: card.id, visibility: next }),
      });
      if (!res.ok) throw new Error();
      loadEvents();
      loadTasks();
    } catch {
      setVis(prev); // revert
    }
  };

  // ─── Create-event form ─── (the full add-form: type dropdown + end date/time)
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState(todayKey());
  const [evTime, setEvTime] = useState("");
  const [evEndDate, setEvEndDate] = useState("");
  const [evEndTime, setEvEndTime] = useState("");
  const [evKind, setEvKind] = useState<EventKind | "">(""); // "" = no type
  const [evLocation, setEvLocation] = useState("");
  const [evVis, setEvVis] = useState<"team" | "private">("team");
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  const resetEventForm = () => {
    setEvTitle(""); setEvDate(todayKey()); setEvTime(""); setEvEndDate(""); setEvEndTime("");
    setEvKind(""); setEvLocation(""); setEvVis("team"); setEvError(null);
  };
  const openEventForm = (date?: string) => {
    resetEventForm();
    if (date) setEvDate(date);
    setOpenDay(null);
    setShowEventForm(true);
  };

  const saveEvent = async () => {
    if (evSaving) return;
    const title = evTitle.trim();
    if (!title || !evDate) { setEvError("Title and date are required."); return; }
    setEvSaving(true);
    setEvError(null);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, date: evDate, time: evTime || null,
          endDate: evEndDate || null, endTime: evEndTime || null,
          kind: evKind || null, location: evLocation.trim() || null, visibility: evVis,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.event) throw new Error(data.error || "Save failed");
      setEvents((es) => [...es, data.event as CalEvent]);
      // Jump the grid to the new event's month so it's visible.
      const d = new Date(data.event.startsAt);
      setCalYear(d.getFullYear());
      setCalMonth(d.getMonth());
      setShowEventForm(false);
      resetEventForm();
    } catch (err) {
      setEvError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setEvSaving(false);
    }
  };

  // ─── Create-task form ─── (full add-form, mirrors events)
  const [tkTitle, setTkTitle] = useState("");
  const [tkDue, setTkDue] = useState("");
  const [tkTime, setTkTime] = useState("");
  const [tkEndDate, setTkEndDate] = useState("");
  const [tkEndTime, setTkEndTime] = useState("");
  const [tkVis, setTkVis] = useState<"team" | "private">("private");
  const [tkSaving, setTkSaving] = useState(false);
  const [tkError, setTkError] = useState<string | null>(null);

  const resetTaskForm = () => {
    setTkTitle(""); setTkDue(""); setTkTime(""); setTkEndDate(""); setTkEndTime("");
    setTkVis("private"); setTkError(null);
  };
  const openTaskForm = (date?: string) => {
    resetTaskForm();
    if (date) setTkDue(date);
    setOpenDay(null);
    setShowTaskForm(true);
  };

  const saveTask = async () => {
    if (tkSaving) return;
    const title = tkTitle.trim();
    if (!title) { setTkError("A title is required."); return; }
    setTkSaving(true);
    setTkError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, dueDate: tkDue || null, dueTime: tkTime || null,
          endDate: tkEndDate || null, endTime: tkEndTime || null, visibility: tkVis,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.task) throw new Error(data.error || "Save failed");
      setTasks((ts) => [...ts, data.task as CalTask]);
      setShowTaskForm(false);
      resetTaskForm();
    } catch (err) {
      setTkError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setTkSaving(false);
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  // Load the saved-conversations list once signed in.
  useEffect(() => {
    if (isSignedIn && !threadsLoaded) loadThreads();
  }, [isSignedIn, threadsLoaded]);

  // Restore the desktop sidebar collapse preference.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("soterra:rail-collapsed") === "true") setRailCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Web Speech API setup (desktop browsers). Native STT (Capacitor) comes later.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    setSttSupported(true);
    const rec = new SR();
    rec.lang = "en-NZ";
    rec.continuous = false;
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => (prev.trim() ? prev + " " : "") + transcript);
    };
    rec.onend = () => setIsRecording(false);
    rec.onerror = () => setIsRecording(false);
    recognitionRef.current = rec;
  }, []);

  const toggleRailCollapsed = () => {
    setRailCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem("soterra:rail-collapsed", String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const toggleRecording = () => {
    const r = recognitionRef.current;
    if (!r) return;
    if (isRecording) {
      try { r.stop(); } catch { /* ignore */ }
      setIsRecording(false);
      return;
    }
    setAttachErr(null);
    try {
      r.start();
      setIsRecording(true);
    } catch {
      /* already started — ignore */
    }
  };

  const clearAttachment = () => setAttachment(null);
  const onFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setAttachErr(null);
    setAttachBusy(true);
    try {
      const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
      if (isPdf) {
        if (file.size > 3 * 1024 * 1024) throw new Error("PDF too big here (max 3 MB) — use the Upload tab for full plan sets.");
        const data = await fileToBase64(file);
        setAttachment({ kind: "pdf", mediaType: "application/pdf", data, name: file.name });
      } else if (file.type.startsWith("image/")) {
        const { mediaType, data } = await fileToResizedJpegBase64(file);
        setAttachment({ kind: "image", mediaType, data, name: file.name });
      } else {
        throw new Error("Attach a photo or a PDF.");
      }
    } catch (err) {
      setAttachErr(err instanceof Error ? err.message : "Couldn't attach that file.");
    } finally {
      setAttachBusy(false);
    }
  };

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    const att = attachment;
    if ((!t && !att) || busy) return;
    const question = t || "Take a look at this attachment and tell me what's relevant.";
    setInput("");
    setAttachment(null);
    setAttachErr(null);
    if (taRef.current) taRef.current.style.height = "auto";
    setBusy(true);
    setTab("assistant");
    setMessages((m) => [...m, { role: "u", text: t, att: att?.name }, { role: "a", text: "…", pending: true }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, threadId, attachment: att }),
      });
      const data = await res.json();
      const ans = String(data.answer || data.error || "Sorry, something went wrong.");
      const cards: AsstCard[] = Array.isArray(data.cards) ? data.cards : [];
      setMessages((prev) => [...prev.slice(0, -1), assistantMsg(ans, cards)]);
      if (data.threadId) setThreadId(data.threadId);
      // Refresh the sidebar (new thread appears, or title/order updates).
      loadThreads();
      // If the assistant changed the calendar/tasks, refresh so the other tabs
      // (and the agenda/day views) reflect it immediately.
      if (cards.length) { loadEvents(); loadTasks(); }
    } catch {
      setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Sorry — couldn't reach the assistant just now. Try again." }]);
    } finally {
      setBusy(false);
    }
  };

  // Group events by Auckland day-key, time-sorted within each day.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.startsAt));
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return map;
  }, [events]);

  // Tasks with a due date, grouped by day-key.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const k = dayKey(new Date(t.dueAt));
      const list = map.get(k) ?? [];
      list.push(t);
      map.set(k, list);
    }
    return map;
  }, [tasks]);

  // Month grid cells: day number, today flag, out-of-month, and the distinct
  // kind-dots present that day (+ a slate dot if any tasks are due).
  const calCells = useMemo(() => {
    const grid = buildMonthGrid(calYear, calMonth);
    const tk = todayKey();
    return grid.map((d) => {
      const k = dayKey(d);
      const dayEvents = eventsByDay.get(k) ?? [];
      const dots: string[] = [];
      for (const e of dayEvents) {
        const dot = dotClass(e.kind);
        if (!dots.includes(dot)) dots.push(dot);
      }
      if ((tasksByDay.get(k)?.length ?? 0) > 0 && !dots.includes("sl")) dots.push("sl");
      return { k, n: d.getDate(), today: k === tk, dots: dots.slice(0, 4), mut: d.getMonth() !== calMonth };
    });
  }, [calYear, calMonth, eventsByDay, tasksByDay]);

  // "This week": events from today through the next 7 days, in the project tz.
  const weekEvents = useMemo(() => {
    const ms = Date.now();
    const weekAhead = ms + 7 * 24 * 60 * 60 * 1000;
    return events
      .filter((e) => {
        const time = new Date(e.startsAt).getTime();
        return time >= ms - 12 * 60 * 60 * 1000 && time <= weekAhead;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events]);

  // Agenda / Napirend: every upcoming event + due-dated task from the start of
  // today onward, grouped by day and time-sorted within each day.
  const agenda = useMemo(() => {
    const cutoff = new Date(`${todayKey()}T00:00:00`).getTime() - 12 * 3600 * 1000;
    type Item = { t: number; ev?: CalEvent; tk?: CalTask };
    const byDay = new Map<string, Item[]>();
    for (const e of events) {
      const t = new Date(e.startsAt).getTime();
      if (t < cutoff) continue;
      const k = dayKey(new Date(e.startsAt));
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t, ev: e });
    }
    for (const tk of tasks) {
      if (!tk.dueAt) continue;
      const t = new Date(tk.dueAt).getTime();
      if (t < cutoff) continue;
      const k = dayKey(new Date(tk.dueAt));
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t, tk });
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, items]) => ({ k, items: items.sort((a, b) => a.t - b.t) }));
  }, [events, tasks]);

  function gotoMonth(delta: number) {
    let m = calMonth + delta;
    let y = calYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setCalMonth(m);
    setCalYear(y);
  }
  function gotoToday() {
    const d = new Date();
    setCalYear(d.getFullYear());
    setCalMonth(d.getMonth());
    setCalView("month");
    setOpenDay(todayKey());
  }

  if (!isLoaded) return <div className="boot" />;

  /* ─── Signed out: login ─── */
  if (!isSignedIn) {
    return (
      <div className="login">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lg-logo" src="/logo-mark.png" alt="Soterra" />
          <div className="lg-pill">Ask your plans</div>
          <h1 className="lg-h">The answer&apos;s in the plans.<br /><b className="grad">Just ask.</b></h1>
          <p className="lg-sub">
            Your whole crew can ask any question about the project&apos;s drawings and specs — and get the answer in
            seconds, with the exact sheet to back it up.
          </p>
          <button className="lg-btn" onClick={() => clerk.openSignIn()}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
            Continue with Google
          </button>
          <button className="lg-btn primary" onClick={() => clerk.openSignIn()}>Continue with email</button>
          <div className="lg-alt">
            New company? <a onClick={() => clerk.openSignUp()}>Set up your project →</a><br />
            Joining your team? <a onClick={() => clerk.openSignUp()}>Enter an invite code →</a>
          </div>
        </div>
      </div>
    );
  }

  const firstName =
    user?.firstName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || user?.username || "there";
  const initials = (firstName[0] || "S").toUpperCase();
  // Collapse only applies on desktop; the mobile drawer (railOpen) always shows full.
  const showCollapsed = railCollapsed && !railOpen;

  const cbox = (
    <div className="cbox">
      {attachment && (
        <div className="att-chip">
          <span>{attachment.kind === "pdf" ? "📄" : "🖼️"}</span>
          <span className="att-name">{attachment.name}</span>
          <button className="att-x" onClick={clearAttachment} aria-label="Remove attachment">✕</button>
        </div>
      )}
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        placeholder="Ask your plans, or book something on site…"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={onFilePick} />
      <div className="crow">
        <span className="hint">
          {attachErr ? <span style={{ color: "var(--red)" }}>{attachErr}</span>
            : isRecording ? "Listening… speak now"
            : attachBusy ? "Attaching…"
            : "Enter to send · Shift+Enter for a new line"}
        </span>
        <div className="ract">
          {sttSupported && (
            <button className={"attach" + (isRecording ? " rec" : "")} title="Voice — dictate your message" onClick={toggleRecording}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
          )}
          <button className="attach" title="Attach a photo or PDF" onClick={() => fileInputRef.current?.click()} disabled={attachBusy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 18.6a1.7 1.7 0 0 1-2.3-2.3l7.8-7.8" /></svg>
          </button>
          <button className="send" disabled={busy || (!input.trim() && !attachment)} onClick={() => send()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="shell">
      {/* ─── top nav ─── */}
      <header className="topnav">
        <div className="brand grad" onClick={() => setTab("assistant")}>Soterra</div>
        <nav className="navtabs">
          {NAV.map((n) => (
            <button key={n.id} className={"navtab" + (tab === n.id ? " act" : "")} onClick={() => setTab(n.id)}>
              {n.icon}<span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="navright">
          <div className="proj-chip"><span className="dot" /> 1 Arthur Road <small>· 6 docs</small></div>
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)}>{initials}</button>
          {menuOpen && (
            <div className="menu">
              <div className="mrow"><span className="mi">🏗️</span><div><b>1 Arthur Road</b><br /><small>Multi-unit housing</small></div></div>
              <div className="mrow"><span className="mi">➕</span> Switch / add project</div>
              <div className="mrow"><span className="mi">👥</span> Crew &amp; invite code</div>
              <div className="mrow sep" onClick={() => clerk.signOut()}><span className="mi">↩️</span> Sign out</div>
            </div>
          )}
        </div>
      </header>

      <div className="content">
        {/* ─── ASSISTANT ─── */}
        {tab === "assistant" && (
          <div className="asst-layout">
            {railOpen && <div className="rail-scrim" onClick={() => setRailOpen(false)} />}
            <aside className={"chat-rail" + (railOpen ? " open" : "") + (showCollapsed ? " collapsed" : "")}>
              {showCollapsed ? (
                <>
                  <button className="rail-icon" onClick={toggleRailCollapsed} title="Expand conversations" aria-label="Expand conversations">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                  </button>
                  <button className="rail-icon" onClick={newChat} title="New chat" aria-label="New chat">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                  </button>
                </>
              ) : (
                <>
                  <div className="rail-head">
                    <button className="newchat" onClick={newChat}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                      New chat
                    </button>
                    <button className="rail-collapse" onClick={toggleRailCollapsed} title="Collapse" aria-label="Collapse conversations">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                    </button>
                  </div>
                  {threads.length > 0 && <div className="rail-k">Recent</div>}
                  <ul className="rail-list">
                    {threads.map((th) => (
                      <li
                        key={th.id}
                        className={"rail-item" + (th.id === threadId ? " act" : "")}
                        onClick={() => loadThread(th.id)}
                        title={th.title || "Conversation"}
                      >
                        {th.title || "Conversation"}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </aside>
            <button className="chat-fab" onClick={() => setRailOpen(true)} aria-label="Past conversations">☰ Chats</button>
          <div className="assistant">
            {messages.length === 0 ? (
              <div className="hero-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="hero-logo" src="/logo-mark.png" alt="Soterra" />
                <h1>Hi <b className="grad">{firstName}</b>, how can I help?</h1>
                <div className="hero-composer">{cbox}</div>
              </div>
            ) : (
              <>
                <div className="asst-scroll" ref={scrollRef}>
                  <div className="asst-inner">
                    <div className="thread">
                      {messages.map((m, i) =>
                        m.role === "u" ? (
                          <div className="msg u" key={i}><div className="bub">{m.att && <span className="bub-att">📎 {m.att}</span>}{m.text}</div></div>
                        ) : (
                          <div className="msg a" key={i}>
                            <div className="bub">
                              {m.src && <div className="src">{m.src}</div>}
                              {m.pending ? (
                                <span className="typing"><i /><i /><i /></span>
                              ) : (
                                <span dangerouslySetInnerHTML={{ __html: m.text }} />
                              )}
                              {m.cite && (
                                <div className="cite" onClick={() => setSheet(m.cite!)}>
                                  <div className="cic">📐</div>
                                  <div className="ct"><b>{m.cite.code} · {m.cite.title}</b><small>{m.cite.sub}</small></div>
                                  <div className="ca">›</div>
                                </div>
                              )}
                              {m.cards?.map((c, j) => (
                                <div className="evcard" key={j}>
                                  <div className="bar" style={{ background: c.itemType === "event" ? barColor((c.kind as EventKind) || null) : "var(--brand)" }} />
                                  <div className="et">
                                    <b>{c.action === "deleted" ? "Removed: " : ""}{c.title}</b>
                                    <small>{c.when}{c.sub ? ` · ${c.sub}` : ""}</small>
                                  </div>
                                  {c.action !== "deleted" && (
                                    <button
                                      className={"vis-toggle " + (c.visibility === "team" ? "team" : "me")}
                                      onClick={() => flipCardVisibility(i, j)}
                                      title="Tap to change who can see this"
                                    >
                                      {c.visibility === "team" ? "👁 Whole crew" : "🔒 Just me"}
                                    </button>
                                  )}
                                  <div className="ec">{c.itemType === "task" ? "✅" : "🗓️"}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="composer-wrap"><div className="composer">{cbox}</div></div>
              </>
            )}
          </div>
          </div>
        )}

        {/* ─── CALENDAR ─── */}
        {tab === "calendar" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Calendar</div>
            <div className="page-sub">1 Arthur Road · site schedule (NZ time)</div>

            <div className="cal-top">
              <div className="seg">
                <button className={calView === "month" ? "on" : ""} onClick={() => setCalView("month")}>Month</button>
                <button className={calView === "agenda" ? "on" : ""} onClick={() => setCalView("agenda")}>Agenda</button>
              </div>
              <div className="cal-controls">
                {calView === "month" && (
                  <div className="cal-monthnav">
                    <button onClick={() => gotoMonth(-1)} aria-label="Previous month">‹</button>
                    <b>{NZ_MONTHS[calMonth]} {calYear}</b>
                    <button onClick={() => gotoMonth(1)} aria-label="Next month">›</button>
                  </div>
                )}
                <button className="cal-today" onClick={gotoToday}>Today</button>
                <button className="cal-new" onClick={() => openEventForm()}>＋ New event</button>
              </div>
            </div>

            {calView === "month" ? (
              <>
                <div className="cal-card">
                  <div className="cal-dow"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>
                  <div className="cal-days">
                    {calCells.map((c, i) => (
                      <div className={"cd" + (c.today ? " today" : "") + (c.mut ? " mut" : "")} key={i} onClick={() => setOpenDay(c.k)}>
                        {c.n}{c.dots.length > 0 && <div className="dots">{c.dots.map((d, j) => <span className={"d " + d} key={j} />)}</div>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="ag-k">This week</div>
                {!evLoaded ? (
                  <div className="page-sub" style={{ marginBottom: 0 }}>Loading…</div>
                ) : weekEvents.length === 0 ? (
                  <div className="page-sub" style={{ marginBottom: 0 }}>Nothing booked in the next 7 days. Add an event to get the crew on the same page.</div>
                ) : (
                  weekEvents.map((e) => <EventRow key={e.id} e={e} />)
                )}
              </>
            ) : (
              /* ─── AGENDA / Napirend ─── */
              !evLoaded ? (
                <div className="page-sub">Loading…</div>
              ) : agenda.length === 0 ? (
                <div className="page-sub">Nothing coming up. Tap “＋ New event” or just ask the assistant to book something.</div>
              ) : (
                <div className="agenda">
                  {agenda.map((g) => (
                    <div className="ag-group" key={g.k}>
                      <div className="ag-day">
                        {g.k === todayKey() ? "Today · " : ""}{fmtDayHeader(g.k)}
                      </div>
                      {g.items.map((it, j) =>
                        it.ev ? <EventRow key={"e" + j} e={it.ev} /> : <TaskRow key={"t" + j} t={it.tk!} onToggle={toggleTask} />
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div></div>
        )}

        {/* ─── TASKS ─── */}
        {tab === "tasks" && (
          <div className="page"><div className="page-inner">
            <div className="cal-top">
              <div>
                <div className="page-h">Tasks</div>
                <div className="page-sub" style={{ marginBottom: 0 }}>1 Arthur Road · your to-dos and the crew&apos;s</div>
              </div>
              <button className="cal-new" onClick={() => openTaskForm()}>＋ New task</button>
            </div>
            <div style={{ height: 18 }} />
            {!taskLoaded ? (
              <div className="page-sub">Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="page-sub">No tasks yet. Add your first one, or just ask the assistant.</div>
            ) : (
              tasks.map((t) => <TaskRow key={t.id} t={t} onToggle={toggleTask} full />)
            )}
          </div></div>
        )}

        {/* ─── PLANS ─── */}
        {tab === "plans" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Plans &amp; specs</div>
            <div className="page-sub">1 Arthur Road · every drawing &amp; spec, searchable in seconds</div>
            <div className="idx">
              <div><div className="big">571</div><small>pages indexed</small></div>
              <div style={{ flex: 1 }}><small>Architectural, structural, services and specs — all read and searchable.</small><span className="grn">● Ready — last updated today</span></div>
            </div>
            <div className="pg-k">Architectural</div>
            <div className="docs">
              <Doc ic="arc" tag="A3" name="95% Detail Design" sub="85 sheets · plans, elevations" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="arc" tag="A1" name="P25-152-FDS-08" sub="78 sheets · detailed design" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
            <div className="pg-k" style={{ marginTop: 18 }}>Services</div>
            <div className="docs">
              <Doc ic="srv" tag="ELEC" name="8084-ELEC-ESET" sub="17 sheets · power, lighting, data" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="srv" tag="MECH" name="8084-MECH-MSET" sub="7 sheets · HVAC, ventilation" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
            <div className="pg-k" style={{ marginTop: 18 }}>Specifications</div>
            <div className="docs">
              <Doc ic="spc" tag="SPEC" name="95% Project Spec" sub="280 pages · materials, finishes" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="spc" tag="STR" name="P25-152-SPC-01 — Structural" sub="104 pages" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
          </div></div>
        )}

        {/* ─── UPLOAD ─── */}
        {tab === "upload" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Upload plans</div>
            <div className="page-sub">Add drawings &amp; specs to this project</div>
            <div className="drop">
              <div className="ic">⬆️</div>
              <b>Drop PDFs here</b>
              <p>Architectural, structural, services, specs — Soterra reads &amp; indexes the lot so your crew can ask it anything.</p>
              <span className="soon">Wiring up next</span>
            </div>
          </div></div>
        )}
      </div>

      {/* ─── sheet modal ─── */}
      {sheet && (
        <div className="scrim" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>{sheet.code}</b><small>{sheet.title}</small></div>
              <button className="sh-x" onClick={() => setSheet(null)}>✕</button>
            </div>
            <div className="sh-canvas">
              <div className="sheetpaper">
                <div className="frame" /><div className="hl" /><div className="hltag">{sheet.hlTag}</div>
                <div className="tb"><b>{sheet.code}</b><span>{sheet.title}</span><br /><span style={{ color: "#9AA7B4" }}>1 Arthur Rd</span></div>
              </div>
            </div>
            <div className="sh-ans"><div className="src">📐 ANSWER FROM THIS SHEET</div><p dangerouslySetInnerHTML={{ __html: sheet.ans }} /></div>
          </div>
        </div>
      )}

      {/* ─── day-detail modal (clickable calendar day) ─── */}
      {openDay && (
        <div className="scrim" onClick={() => setOpenDay(null)}>
          <div className="sheet" style={{ maxWidth: 520, maxHeight: "85vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>{fmtDayHeader(openDay)}</b>
                <small>{daySummary(eventsByDay.get(openDay)?.length ?? 0, tasksByDay.get(openDay)?.length ?? 0)}</small>
              </div>
              <button className="sh-x" onClick={() => setOpenDay(null)}>✕</button>
            </div>
            <div className="dm-body">
              {(eventsByDay.get(openDay)?.length ?? 0) === 0 && (tasksByDay.get(openDay)?.length ?? 0) === 0 && (
                <div className="page-sub" style={{ marginBottom: 0 }}>Nothing on this day yet. Add an event or task below — or just ask the assistant.</div>
              )}
              {(eventsByDay.get(openDay) ?? []).map((e) => <EventRow key={e.id} e={e} />)}
              {(tasksByDay.get(openDay) ?? []).map((t) => <TaskRow key={t.id} t={t} onToggle={toggleTask} />)}
            </div>
            <div className="dm-foot">
              <button className="lg-btn primary" style={{ height: 44, margin: 0, flex: 1 }} onClick={() => openEventForm(openDay!)}>＋ Event</button>
              <button className="lg-btn" style={{ height: 44, margin: 0, flex: 1 }} onClick={() => openTaskForm(openDay!)}>＋ Task</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── create-event modal ─── */}
      {showEventForm && (
        <div className="scrim" onClick={() => { setShowEventForm(false); resetEventForm(); }}>
          <div className="sheet" style={{ maxWidth: 480, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New event</b><small>1 Arthur Road · NZ time</small></div>
              <button className="sh-x" onClick={() => { setShowEventForm(false); resetEventForm(); }}>✕</button>
            </div>
            <div className="form-body">
              <label className="ev-lbl">Event</label>
              <input className="ev-in" value={evTitle} autoFocus onChange={(e) => setEvTitle(e.target.value)} placeholder="e.g. Pre-line inspection — Unit 49" />

              <div className="ev-grid">
                <div>
                  <label className="ev-lbl">Date</label>
                  <input className="ev-in" type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} />
                </div>
                <div>
                  <label className="ev-lbl">Start time <span className="opt">· optional</span></label>
                  <input className="ev-in" type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} />
                </div>
              </div>

              <div className="ev-grid">
                <div>
                  <label className="ev-lbl">End date <span className="opt">· optional</span></label>
                  <input className="ev-in" type="date" value={evEndDate} min={evDate} onChange={(e) => setEvEndDate(e.target.value)} />
                </div>
                <div>
                  <label className="ev-lbl">End time <span className="opt">· optional</span></label>
                  <input className="ev-in" type="time" value={evEndTime} onChange={(e) => setEvEndTime(e.target.value)} />
                </div>
              </div>

              <label className="ev-lbl">Type <span className="opt">· optional</span></label>
              <select className="ev-in" value={evKind} onChange={(e) => setEvKind(e.target.value as EventKind | "")}>
                <option value="">No type</option>
                {EVENT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>

              <label className="ev-lbl">Location <span className="opt">· optional</span></label>
              <input className="ev-in" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} placeholder="e.g. Block C, Level 2" />

              <label className="ev-lbl">Visible to</label>
              <div className="ev-kinds">
                <button type="button" className={"ev-kind" + (evVis === "team" ? " act" : "")} onClick={() => setEvVis("team")}>Whole crew</button>
                <button type="button" className={"ev-kind" + (evVis === "private" ? " act" : "")} onClick={() => setEvVis("private")}>Just me</button>
              </div>

              {evError && <div className="ev-err">{evError}</div>}

              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={evSaving} onClick={saveEvent}>{evSaving ? "Saving…" : "Add event"}</button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={evSaving} onClick={() => { setShowEventForm(false); resetEventForm(); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── create-task modal (full add-form, mirrors events) ─── */}
      {showTaskForm && (
        <div className="scrim" onClick={() => { setShowTaskForm(false); resetTaskForm(); }}>
          <div className="sheet" style={{ maxWidth: 480, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New task</b><small>1 Arthur Road · a to-do</small></div>
              <button className="sh-x" onClick={() => { setShowTaskForm(false); resetTaskForm(); }}>✕</button>
            </div>
            <div className="form-body">
              <label className="ev-lbl">Task</label>
              <input className="ev-in" value={tkTitle} autoFocus onChange={(e) => setTkTitle(e.target.value)} placeholder="e.g. Order more H1.2 framing timber" />

              <div className="ev-grid">
                <div>
                  <label className="ev-lbl">Due date <span className="opt">· optional</span></label>
                  <input className="ev-in" type="date" value={tkDue} onChange={(e) => setTkDue(e.target.value)} />
                </div>
                <div>
                  <label className="ev-lbl">Due time <span className="opt">· optional</span></label>
                  <input className="ev-in" type="time" value={tkTime} disabled={!tkDue} onChange={(e) => setTkTime(e.target.value)} />
                </div>
              </div>

              {tkDue && (
                <div className="ev-grid">
                  <div>
                    <label className="ev-lbl">End date <span className="opt">· optional</span></label>
                    <input className="ev-in" type="date" value={tkEndDate} min={tkDue} onChange={(e) => setTkEndDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="ev-lbl">Finish time <span className="opt">· optional</span></label>
                    <input className="ev-in" type="time" value={tkEndTime} onChange={(e) => setTkEndTime(e.target.value)} />
                  </div>
                </div>
              )}

              <label className="ev-lbl">Visible to</label>
              <div className="ev-kinds">
                <button type="button" className={"ev-kind" + (tkVis === "private" ? " act" : "")} onClick={() => setTkVis("private")}>Just me</button>
                <button type="button" className={"ev-kind" + (tkVis === "team" ? " act" : "")} onClick={() => setTkVis("team")}>Whole crew</button>
              </div>

              {tkError && <div className="ev-err">{tkError}</div>}

              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={tkSaving} onClick={saveTask}>{tkSaving ? "Saving…" : "Add task"}</button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={tkSaving} onClick={() => { setShowTaskForm(false); resetTaskForm(); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── helpers ── */
function fmt(str: string): string {
  return str
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n+/g, "<br/>");
}
// Read a file to a base64 string (no data: prefix).
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Couldn't read the file."));
    r.readAsDataURL(file);
  });
}
// Downscale an image to <=1568px (Claude's sweet spot) and return JPEG base64,
// keeping the request well under the serverless body limit. Canvas-only, no deps.
function fileToResizedJpegBase64(file: File): Promise<{ mediaType: string; data: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const max = 1568;
      const m = Math.max(width, height);
      if (m > max) { const s = max / m; width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Image processing unavailable.")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] || "" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be read.")); };
    img.src = url;
  });
}
// Turn a stored/streamed assistant reply into a renderable message: pull a
// trailing "Source: …" line into a citation card, format the rest. Shared by
// live sends and reloading a saved conversation.
function assistantMsg(content: string, cards?: AsstCard[]): Msg {
  const sm = content.match(/\n*\s*Source:\s*([^\n]+)\s*$/i);
  const body = sm ? content.slice(0, sm.index).trim() : content;
  const cite = sm ? makeCite(sm[1].trim(), body) : undefined;
  return {
    role: "a",
    src: cite ? "📐 FROM YOUR PLANS" : undefined,
    text: fmt(body),
    raw: body,
    cite,
    cards: cards && cards.length ? cards : undefined,
  };
}
function daySummary(ev: number, tk: number): string {
  const parts = [];
  if (ev) parts.push(`${ev} event${ev > 1 ? "s" : ""}`);
  if (tk) parts.push(`${tk} task${tk > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" · ") : "Empty day";
}
function makeCite(sourceLine: string, body: string): Cite {
  const parts = sourceLine.split("·").map((x) => x.trim()).filter(Boolean);
  const doc = parts[0] || "Source";
  const code = parts.find((p, i) => i > 0 && /[A-Z]/.test(p) && /\d/.test(p)) || doc;
  const rest = parts.filter((p) => p !== doc && p !== code).join(" · ");
  return { code, title: rest || doc, sub: doc, ans: fmt(body), hlTag: code };
}

// One event row — used in the week strip, agenda, and day modal.
function EventRow({ e }: { e: CalEvent }) {
  const tag = kindTag(e.kind);
  const sub = [e.location, e.visibility === "team" ? "whole crew" : "just you", e.creatorName].filter(Boolean).join(" · ");
  return (
    <div className="ev">
      <div className="bar" style={{ background: barColor(e.kind) }} />
      <div className="when">{fmtAgendaDay(e.startsAt)}<br /><span className="when-t">{fmtEventRange(e)}</span></div>
      <div className="body"><b>{e.title}</b>{sub && <small>{sub}</small>}</div>
      {tag && <div className="tag" style={{ background: tag.bg, color: tag.fg }}>{tag.label}</div>}
    </div>
  );
}

// One task row. `full` shows the long meta line (Tasks tab); compact otherwise.
function TaskRow({ t, onToggle, full }: { t: CalTask; onToggle: (t: CalTask) => void; full?: boolean }) {
  const due = fmtDue(t.dueAt);
  const time = fmtTaskTime(t);
  const meta = full
    ? [t.creatorName, t.done ? "done" : due ? `due ${due}${time ? ` · ${time}` : ""}` : null].filter(Boolean).join(" · ")
    : [t.done ? "done" : time || (due ? `due ${due}` : null), t.creatorName].filter(Boolean).join(" · ");
  const vis = t.visibility === "team" ? "team" : "me";
  return (
    <div className={"task" + (t.done ? " done" : "")}>
      <div className="cb" onClick={() => onToggle(t)}>{t.done ? "✓" : ""}</div>
      <div className="tk"><b>{t.title}</b>{meta && <small>{meta}</small>}</div>
      <span className={"vis " + vis}>{vis === "team" ? "Team" : "Just me"}</span>
    </div>
  );
}

function Doc(p: { ic: string; tag: string; name: string; sub: string; onClick: () => void }) {
  return (
    <div className="doc" onClick={p.onClick}>
      <div className={"ic " + p.ic}>{p.tag}</div>
      <div className="dt"><b>{p.name}</b><small>{p.sub}</small></div>
      <div className="arr">›</div>
    </div>
  );
}
