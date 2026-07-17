"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import Landing from "./landing";

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
  assigneeName?: string | null;
};
type Msg =
  | { role: "u"; text: string; att?: string }
  | { role: "a"; src?: string; text: string; raw?: string; cite?: Cite; cards?: AsstCard[]; pending?: boolean };
type Attachment = { kind: "image" | "pdf"; mediaType: string; data: string; name: string };

// ─── Sites (projects) + crew ───
type Project = { id: string; name: string; code: string; role: string; timezone?: string };
type Member = { userId: string; name: string; title: string | null; role: string; colorIndex: number; isMe: boolean };
type PlanDoc = { doc: string; npages: number; indexed: number; file: string | null; uploadedAt: string };

// Soterra's project timezone. TODO: per-project tz once projects carry one.
const TZ = "Pacific/Auckland";
const DEMO_ID = "1-arthur-road";

// Crew colour palette (matches colorIndex 0–7). Used to colour events by whoever
// they're assigned to, plus the crew legend + invite panel.
const CREW_COLORS = ["#0E74BD", "#10B981", "#8B5CF6", "#F59E0B", "#EF4444", "#06B6D4", "#EC4899", "#0A2540"];
const crewColor = (i: number) => CREW_COLORS[(((i ?? 0) % 8) + 8) % 8];

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
  assigneeId: string | null;
  assigneeName: string | null;
};
type CalTask = {
  id: string;
  title: string;
  dueAt: string | null; // ISO
  endsAt: string | null;
  done: boolean;
  visibility: "team" | "private";
  creatorName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
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

// Event colours: an event assigned to a crew member takes THAT member's colour
// (colour-by-crew); otherwise it falls back to a colour for its type.
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

// Login-first screen shown when the app runs in app-mode (installed PWA / ?app=1),
// instead of the marketing landing. Uses the SAME light/blue palette as the
// website and the assistant so the app doesn't feel like a different product.
function AppLogin({ onLogin, onGetStarted }: { onLogin: () => void; onGetStarted: () => void }) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 28px",
        textAlign: "center",
        color: "#0C2A47",
        background:
          "radial-gradient(760px 420px at 82% -6%, rgba(65,195,255,.14), transparent 62%), radial-gradient(680px 420px at 0% 0%, rgba(10,141,237,.06), transparent 55%), #F6FAFF",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo-mark.png" alt="Soterra" style={{ height: 66, width: "auto", marginBottom: 18 }} />
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 12 }}>Soterra</h1>
      <p style={{ fontSize: 16, lineHeight: 1.5, color: "#52698A", maxWidth: 310, marginBottom: 32 }}>
        Turning construction data into{" "}
        <span
          style={{
            background: "linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
            fontWeight: 700,
          }}
        >
          company intelligence.
        </span>
      </p>
      <button onClick={onLogin} style={{ width: "100%", maxWidth: 320, padding: "15px", borderRadius: 14, border: "none", cursor: "pointer", fontSize: 16, fontWeight: 700, color: "#fff", background: "linear-gradient(135deg,#41C3FF,#0A8DED)", boxShadow: "0 12px 30px rgba(10,141,237,.3)", marginBottom: 12 }}>
        Log in
      </button>
      <button onClick={onGetStarted} style={{ width: "100%", maxWidth: 320, padding: "14px", borderRadius: 14, border: "1px solid #E7EFF9", cursor: "pointer", fontSize: 15, fontWeight: 600, color: "#0C2A47", background: "#fff" }}>
        Create an account
      </button>
      <p style={{ fontSize: 12.5, color: "#94A6BE", marginTop: 22, maxWidth: 300, lineHeight: 1.5 }}>
        Got a site code from your PM? Log in, then enter it to join your site.
      </p>
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Cite | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // App-mode: installed PWA / launched with ?app=1 → login-first instead of marketing.
  const [appMode, setAppMode] = useState(false);

  // ─── sites (projects) + crew ───
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [siteCode, setSiteCode] = useState<string | null>(null);
  const projRef = useRef<string | null>(null); // always-current site id for fetch headers
  // site create/join overlay + crew panel
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupMode, setSetupMode] = useState<"create" | "join">("create");
  const [setupName, setSetupName] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupPersonName, setSetupPersonName] = useState("");
  const [setupTitle, setSetupTitle] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // ─── saved conversations (threads) ───
  const [threads, setThreads] = useState<{ id: string; title: string | null; updatedAt: string }[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
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
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ─── plan upload (Upload tab) + indexed docs (Plans tab) ───
  const [docs, setDocs] = useState<PlanDoc[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  // Bulk upload: a live "current file" progress + a log of finished ones, so a PM
  // can drop the whole plan set (many PDFs) at once.
  const [upCurrent, setUpCurrent] = useState<{ name: string; phase: string; pct: number } | null>(null);
  const [upItems, setUpItems] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const planFileRef = useRef<HTMLInputElement>(null);

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

  // fetch() wrapper that tags every request with the current site so the server
  // can scope + authorise it. All per-site routes go through this.
  const apiFetch = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    const pid = projRef.current;
    if (pid) headers.set("x-soterra-project", pid);
    return fetch(path, { ...init, headers });
  };

  const loadEvents = async () => {
    try {
      const res = await apiFetch("/api/events");
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
      const res = await apiFetch("/api/tasks");
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
      const res = await apiFetch("/api/threads");
      const data = await res.json();
      if (Array.isArray(data.threads)) setThreads(data.threads);
    } catch {
      /* ignore */
    }
  };
  const loadMembers = async () => {
    try {
      const res = await apiFetch("/api/members");
      const data = await res.json();
      if (Array.isArray(data.members)) setMembers(data.members);
      if (data.code) setSiteCode(data.code);
    } catch {
      /* ignore */
    }
  };
  const loadPlans = async () => {
    try {
      const res = await apiFetch("/api/plans");
      const data = await res.json();
      if (Array.isArray(data.docs)) setDocs(data.docs);
    } catch {
      /* ignore */
    } finally {
      setDocsLoaded(true);
    }
  };

  // Switch to a site: point the fetch header at it, reset per-site data, reload.
  const selectProject = (id: string) => {
    projRef.current = id;
    setProjectId(id);
    try { window.localStorage.setItem("soterra:project", id); } catch { /* ignore */ }
    setEvents([]); setTasks([]); setThreads([]); setMessages([]); setThreadId(null); setDocs([]);
    setEvLoaded(false); setTaskLoaded(false); setDocsLoaded(false);
    setMembers([]); setSiteCode(null);
    loadThreads();
    loadMembers();
  };

  const loadProjects = async () => {
    try {
      const res = await fetch("/api/projects");
      const data = await res.json();
      const list: Project[] = Array.isArray(data.projects) ? data.projects : [];
      setProjects(list);
      if (list.length) {
        let saved: string | null = null;
        try { saved = window.localStorage.getItem("soterra:project"); } catch { /* ignore */ }
        const pick = list.find((p) => p.id === saved) || list[0];
        selectProject(pick.id);
      }
    } catch {
      /* ignore */
    } finally {
      setProjectsLoaded(true);
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
      const res = await apiFetch(`/api/threads?id=${encodeURIComponent(id)}`);
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

  // Lazy-load each tab's data the first time it's opened (after a site is picked).
  useEffect(() => {
    if (!projectId) return;
    if (tab === "calendar" && !evLoaded) loadEvents();
    if (tab === "tasks" && !taskLoaded) loadTasks();
    if ((tab === "plans" || tab === "upload") && !docsLoaded) loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, evLoaded, taskLoaded, docsLoaded, projectId]);

  const toggleTask = async (t: CalTask) => {
    const next = !t.done;
    setTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: next } : x))); // optimistic
    try {
      const res = await apiFetch("/api/tasks", {
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
      const res = await apiFetch(url, {
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

  // ─── Create-event form ─── (the full add-form: type dropdown + assignee + end date/time)
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState(todayKey());
  const [evTime, setEvTime] = useState("");
  const [evEndDate, setEvEndDate] = useState("");
  const [evEndTime, setEvEndTime] = useState("");
  const [evKind, setEvKind] = useState<EventKind | "">(""); // "" = no type
  const [evLocation, setEvLocation] = useState("");
  const [evAssignee, setEvAssignee] = useState(""); // "" = nobody
  const [evVis, setEvVis] = useState<"team" | "private">("team");
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  const resetEventForm = () => {
    setEvTitle(""); setEvDate(todayKey()); setEvTime(""); setEvEndDate(""); setEvEndTime("");
    setEvKind(""); setEvLocation(""); setEvAssignee(""); setEvVis("team"); setEvError(null);
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
      const res = await apiFetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, date: evDate, time: evTime || null,
          endDate: evEndDate || null, endTime: evEndTime || null,
          kind: evKind || null, location: evLocation.trim() || null,
          assigneeId: evAssignee || null,
          assigneeName: evAssignee ? (members.find((m) => m.userId === evAssignee)?.name ?? null) : null,
          visibility: evAssignee ? "team" : evVis,
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
  const [tkAssignee, setTkAssignee] = useState("");
  const [tkVis, setTkVis] = useState<"team" | "private">("private");
  const [tkSaving, setTkSaving] = useState(false);
  const [tkError, setTkError] = useState<string | null>(null);

  const resetTaskForm = () => {
    setTkTitle(""); setTkDue(""); setTkTime(""); setTkEndDate(""); setTkEndTime("");
    setTkAssignee(""); setTkVis("private"); setTkError(null);
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
      const res = await apiFetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, dueDate: tkDue || null, dueTime: tkTime || null,
          endDate: tkEndDate || null, endTime: tkEndTime || null,
          assigneeId: tkAssignee || null,
          assigneeName: tkAssignee ? (members.find((m) => m.userId === tkAssignee)?.name ?? null) : null,
          visibility: tkAssignee ? "team" : tkVis,
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

  // Load the user's sites once signed in.
  useEffect(() => {
    if (isSignedIn && !projectsLoaded) loadProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, projectsLoaded]);

  // Prefill the setup "your name" field with the Clerk first name (still editable).
  useEffect(() => {
    if (isSignedIn && user) setSetupPersonName((v) => v || user.firstName || "");
  }, [isSignedIn, user]);

  // Restore the desktop sidebar collapse preference.
  useEffect(() => {
    try {
      if (window.localStorage.getItem("soterra:rail-collapsed") === "true") setRailCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  // Detect app-mode: installed PWA (standalone) or launched with ?app=1. Persist it
  // so Clerk redirects don't drop us back to the marketing site.
  useEffect(() => {
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).standalone === true;
      const flagged =
        new URLSearchParams(window.location.search).has("app") ||
        window.localStorage.getItem("soterra:appmode") === "1";
      if (standalone || flagged) {
        setAppMode(true);
        window.localStorage.setItem("soterra:appmode", "1");
        setSetupMode("join"); // app users join a PM's site by code; PMs create on the web
      }
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
        if (file.size > 2.5 * 1024 * 1024) throw new Error("PDF too big here (max 2.5 MB) — use the Upload tab for full plan sets.");
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
      const res = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, threadId, attachment: att }),
      });
      if (res.status === 413) {
        setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "That attachment's too big to send here — try a smaller file, or add full plan sets via the Upload tab." }]);
        return;
      }
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

  // ─── site create / join ───
  const resetSetup = () => { setSetupName(""); setSetupCode(""); setSetupErr(null); setCreatedCode(null); setSetupMode("create"); setSetupPersonName(user?.firstName || ""); setSetupTitle(""); };
  const closeSetup = () => { setSetupOpen(false); resetSetup(); };
  const createSite = async () => {
    const name = setupName.trim();
    if (!name) { setSetupErr("Give your site a name."); return; }
    setSetupBusy(true); setSetupErr(null);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name, personName: setupPersonName.trim() || null, title: setupTitle.trim() || null }) });
      const data = await res.json();
      if (!res.ok || !data.project) throw new Error(data.error || "Couldn't create the site.");
      setProjects((ps) => [...ps, data.project]);
      selectProject(data.project.id);
      setCreatedCode(data.project.code); // keep overlay open to show the code
    } catch (e) {
      setSetupErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSetupBusy(false);
    }
  };
  const joinSite = async () => {
    const code = setupCode.trim().toUpperCase();
    if (!code) { setSetupErr("Enter the join code."); return; }
    setSetupBusy(true); setSetupErr(null);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "join", code, personName: setupPersonName.trim() || null, title: setupTitle.trim() || null }) });
      const data = await res.json();
      if (!res.ok || !data.project) throw new Error(data.error || "That code didn't match a site.");
      setProjects((ps) => (ps.some((p) => p.id === data.project.id) ? ps : [...ps, data.project]));
      selectProject(data.project.id);
      closeSetup();
      setTab("assistant");
    } catch (e) {
      setSetupErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setSetupBusy(false);
    }
  };
  const copyCode = async (code: string) => {
    if (!code) return;
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* ignore */ }
  };

  // ─── plan upload (private, per-site) — handles a WHOLE set at once ───
  const onPlanFiles = async (fileList: FileList | File[]) => {
    const pid = projRef.current;
    if (!pid || upCurrent) return; // ignore drops while a batch is running
    const all = Array.from(fileList);
    const pdfs = all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const notPdf = all.length - pdfs.length;
    if (notPdf > 0) setUpItems((prev) => [{ name: `${notPdf} skipped`, ok: false, note: "not a PDF" }, ...prev]);
    for (const f of pdfs) {
      if (f.size > 100 * 1024 * 1024) { setUpItems((prev) => [{ name: f.name, ok: false, note: "over 100 MB — split it" }, ...prev]); continue; }
      setUpCurrent({ name: f.name, phase: "Uploading", pct: 0 });
      try {
        const blob = await upload(`${pid}/${f.name}`, f, {
          access: "private",
          handleUploadUrl: "/api/upload/token",
          clientPayload: JSON.stringify({ projectId: pid }),
          contentType: "application/pdf",
          onUploadProgress: (p) => setUpCurrent({ name: f.name, phase: "Uploading", pct: Math.round(p.percentage) }),
        });
        setUpCurrent({ name: f.name, phase: "Reading & indexing", pct: 100 });
        const res = await apiFetch("/api/upload/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: blob.pathname, filename: f.name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "indexing failed");
        setUpItems((prev) => [{ name: f.name, ok: true, note: `${data.indexed} page${data.indexed === 1 ? "" : "s"} indexed` }, ...prev]);
      } catch (e) {
        setUpItems((prev) => [{ name: f.name, ok: false, note: e instanceof Error ? e.message : "upload failed" }, ...prev]);
      }
    }
    setUpCurrent(null);
    loadPlans();
  };
  const deletePlan = async (doc: string) => {
    if (!window.confirm(`Remove "${doc}" from this site's index? The assistant will stop using it.`)) return;
    setDocs((ds) => ds.filter((d) => d.doc !== doc)); // optimistic
    try {
      await apiFetch("/api/plans", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc }) });
    } catch {
      loadPlans(); // resync on failure
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

  // Crew colour lookup for colour-by-crew across rows + the grid.
  const memberById = useMemo(() => new Map(members.map((m) => [m.userId, m])), [members]);
  const colorFor = (id: string | null): string | null => {
    if (!id) return null;
    const m = memberById.get(id);
    return m ? crewColor(m.colorIndex) : null;
  };

  // Month grid cells: day number, today flag, out-of-month, and the distinct
  // dots present that day — crew colour when an event is assigned, else its type.
  const calCells = useMemo(() => {
    const grid = buildMonthGrid(calYear, calMonth);
    const tk = todayKey();
    return grid.map((d) => {
      const k = dayKey(d);
      const dayEvents = eventsByDay.get(k) ?? [];
      const dots: { cls?: string; color?: string }[] = [];
      const seen = new Set<string>();
      for (const e of dayEvents) {
        const crew = e.assigneeId ? colorFor(e.assigneeId) : null;
        const key = crew ? `c:${crew}` : `k:${dotClass(e.kind)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        dots.push(crew ? { color: crew } : { cls: dotClass(e.kind) });
      }
      if ((tasksByDay.get(k)?.length ?? 0) > 0 && !seen.has("k:sl")) { seen.add("k:sl"); dots.push({ cls: "sl" }); }
      return { k, n: d.getDate(), today: k === tk, dots: dots.slice(0, 4), mut: d.getMonth() !== calMonth };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calYear, calMonth, eventsByDay, tasksByDay, memberById]);

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
    const tk0 = todayKey();
    type Item = { t: number; ev?: CalEvent; tk?: CalTask };
    const byDay = new Map<string, Item[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.startsAt));
      if (k < tk0) continue;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t: new Date(e.startsAt).getTime(), ev: e });
    }
    for (const tk of tasks) {
      if (!tk.dueAt) continue;
      const k = dayKey(new Date(tk.dueAt));
      if (k < tk0) continue;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t: new Date(tk.dueAt).getTime(), tk });
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

  /* ─── Signed out: marketing landing (web) or login screen (app-mode) ─── */
  if (!isSignedIn) {
    return appMode ? (
      <AppLogin onLogin={() => clerk.openSignIn()} onGetStarted={() => clerk.openSignUp()} />
    ) : (
      <Landing onLogin={() => clerk.openSignIn()} onGetStarted={() => clerk.openSignUp()} />
    );
  }
  if (!projectsLoaded) return <div className="boot" />;

  const firstName =
    user?.firstName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || user?.username || "there";
  const initials = (firstName[0] || "S").toUpperCase();
  const curProject = projects.find((p) => p.id === projectId) || null;
  const projName = curProject?.name || "Your site";
  const isDemo = projectId === DEMO_ID;
  const activeCode = siteCode || curProject?.code || "";
  // Once a site has plans, the Upload tab is for UPDATES (small, revised sheets)
  // rather than the big one-time set — the big bulk load belongs at site setup.
  const hasPlans = docsLoaded && docs.length > 0;

  /* ─── First run (or explicit switch): create / join a site ─── */
  // Also stay open while `createdCode` is set — that's the "here's your invite
  // code" screen shown right after creating (projectId is already set by then).
  const mustSetUp = !projectId;
  if (mustSetUp || setupOpen || createdCode) {
    return (
      <SiteSetup
        mandatory={mustSetUp}
        mode={setupMode}
        setMode={setSetupMode}
        name={setupName}
        setName={setSetupName}
        code={setupCode}
        setCode={setSetupCode}
        personName={setupPersonName}
        setPersonName={setSetupPersonName}
        title={setupTitle}
        setTitle={setSetupTitle}
        busy={setupBusy}
        err={setupErr}
        createdCode={createdCode}
        createdName={projName}
        onCreate={createSite}
        onJoin={joinSite}
        onClose={mustSetUp ? undefined : closeSetup}
        onEnter={() => { closeSetup(); setTab("assistant"); }}
        onUploadPlans={() => { closeSetup(); setTab("upload"); }}
        onCopy={() => copyCode(createdCode || "")}
        copied={copied}
        onSignOut={() => clerk.signOut()}
      />
    );
  }

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
        placeholder="Ask about your plans, the building code, or organise your site calendar…"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={onFilePick} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFilePick} />
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
          <button className="attach" title="Take a photo" onClick={() => cameraInputRef.current?.click()} disabled={attachBusy}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
          </button>
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
          <div className="proj-chip" onClick={() => setMenuOpen((o) => !o)} style={{ cursor: "pointer" }}>
            <span className="dot" /> {projName}
            {isDemo && <small>· demo</small>}
          </div>
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)}>{initials}</button>
          {menuOpen && (
            <div className="menu">
              <div className="mrow"><span className="mi">🏗️</span><div><b>{projName}</b><br /><small>{curProject?.role === "admin" ? "You're the admin" : (members.find((m) => m.isMe)?.title || "Crew member")}</small></div></div>
              <div className="mrow" onClick={() => { setCrewOpen(true); setMenuOpen(false); loadMembers(); }}><span className="mi">👥</span> Crew &amp; invite code</div>
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
            <div className="page-sub">{projName} · site schedule (NZ time)</div>
            {members.length > 1 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, margin: "0 0 16px" }}>
                {members.map((m) => (
                  <span key={m.userId} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--slate)" }}>
                    <i style={{ width: 10, height: 10, borderRadius: 99, background: crewColor(m.colorIndex), display: "inline-block" }} />
                    {m.name}{m.isMe ? " (you)" : ""}
                  </span>
                ))}
              </div>
            )}

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
                        {c.n}{c.dots.length > 0 && <div className="dots">{c.dots.map((d, j) => <span className={"d " + (d.cls || "")} style={d.color ? { background: d.color } : undefined} key={j} />)}</div>}
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
                  weekEvents.map((e) => <EventRow key={e.id} e={e} colorFor={colorFor} />)
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
                        it.ev ? <EventRow key={"e" + j} e={it.ev} colorFor={colorFor} /> : <TaskRow key={"t" + j} t={it.tk!} onToggle={toggleTask} />
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
                <div className="page-sub" style={{ marginBottom: 0 }}>{projName} · your to-dos and the crew&apos;s</div>
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
          isDemo ? (
            <div className="page"><div className="page-inner">
              <div className="page-h">Plans &amp; specs</div>
              <div className="page-sub">{projName} · every drawing &amp; spec, searchable in seconds</div>
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
          ) : (
            <div className="page"><div className="page-inner">
              <div className="page-h">Plans &amp; specs</div>
              <div className="page-sub">{projName} · every drawing &amp; spec, searchable in seconds</div>
              {!docsLoaded ? (
                <div className="page-sub">Loading…</div>
              ) : docs.length === 0 ? (
                <div className="drop" onClick={() => setTab("upload")} style={{ cursor: "pointer" }}>
                  <div className="ic">📄</div>
                  <b>No plans yet</b>
                  <p>Upload your drawing set and specs — Soterra reads every page so you can ask the assistant anything about this site.</p>
                  <span className="soon">Go to Upload →</span>
                </div>
              ) : (
                <>
                  <div className="idx">
                    <div><div className="big">{docs.reduce((n, d) => n + d.indexed, 0)}</div><small>pages indexed</small></div>
                    <div style={{ flex: 1 }}><small>{docs.length} document{docs.length > 1 ? "s" : ""} read and searchable by the assistant.</small><span className="grn">● Ready</span></div>
                  </div>
                  <div className="docs" style={{ marginTop: 14 }}>
                    {docs.map((d) => (
                      <div className="doc" key={d.doc}>
                        <div className="ic spc">PDF</div>
                        <div className="dt"><b>{d.doc}</b><small>{d.indexed} page{d.indexed === 1 ? "" : "s"} indexed</small></div>
                        <button className="sh-x" title="Remove from index" onClick={() => deletePlan(d.doc)} style={{ position: "static" }}>✕</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div></div>
          )
        )}

        {/* ─── UPLOAD ─── */}
        {tab === "upload" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">{hasPlans ? "Update plans" : "Upload plans"}</div>
            <div className="page-sub">
              {hasPlans
                ? `Add or update a sheet on ${projName} — drop the revised version and the assistant answers from the latest, treating the old one as superseded.`
                : `Load ${projName}'s plans — drop the whole set at once. Soterra reads & indexes every page (private to your site).`}
            </div>
            <input ref={planFileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
              onChange={(e) => { const fs = e.target.files; if (planFileRef.current) planFileRef.current.value = ""; if (fs && fs.length) onPlanFiles(fs); }} />
            <div
              className="drop"
              onClick={() => { if (!upCurrent) planFileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); if (!upCurrent) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); if (upCurrent) return; const fs = e.dataTransfer.files; if (fs && fs.length) onPlanFiles(fs); }}
              style={{ cursor: upCurrent ? "default" : "pointer", outline: dragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
            >
              <div className="ic">⬆️</div>
              <b>{upCurrent ? `${upCurrent.phase}…` : hasPlans ? "Add or update a sheet" : "Upload your full plan set"}</b>
              <p>{upCurrent ? upCurrent.name : hasPlans ? "Drop a revised or new sheet (PDF). It becomes the current version — the assistant uses the latest and treats the old as superseded. Keep the whole-set load to site setup." : "Drop your whole drawing set & specs here, or click to choose. As many PDFs as you like — up to 100 MB each. This is the big one-time upload."}</p>
              {upCurrent && (
                <div style={{ width: "80%", maxWidth: 360, height: 6, borderRadius: 99, background: "rgba(148,166,190,.25)", overflow: "hidden", marginTop: 6 }}>
                  <div style={{ width: `${upCurrent.phase === "Uploading" ? (upCurrent.pct || 4) : 100}%`, height: "100%", background: "var(--brand)", transition: "width .2s" }} />
                </div>
              )}
              {!upCurrent && <span className="soon" style={{ cursor: "pointer" }}>Choose files</span>}
            </div>

            {upItems.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {upItems.map((it, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", fontSize: 14, borderBottom: "1px solid rgba(148,166,190,.14)" }}>
                    <span>{it.ok ? "✅" : "⚠️"}</span>
                    <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</b>
                    <small style={{ marginLeft: "auto", flex: "0 0 auto", color: it.ok ? "var(--green)" : "var(--red)" }}>{it.note}</small>
                  </div>
                ))}
              </div>
            )}

            <div className="pg-k" style={{ marginTop: 24 }}>Indexed for this site {docsLoaded && docs.length > 0 ? `(${docs.length})` : ""}</div>
            {!docsLoaded ? (
              <div className="page-sub">Loading…</div>
            ) : docs.length === 0 ? (
              <div className="page-sub">{isDemo ? "This demo site already has 1 Arthur Road's plans loaded — try the assistant." : "Nothing indexed yet. Upload your plans above."}</div>
            ) : (
              <div className="docs">
                {docs.map((d) => (
                  <div className="doc" key={d.doc}>
                    <div className="ic spc">PDF</div>
                    <div className="dt"><b>{d.doc}</b><small>{d.indexed} page{d.indexed === 1 ? "" : "s"} indexed</small></div>
                    <button className="sh-x" title="Remove from index" onClick={() => deletePlan(d.doc)} style={{ position: "static" }}>✕</button>
                  </div>
                ))}
              </div>
            )}
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

      {/* ─── crew & invite code ─── */}
      {crewOpen && (
        <div className="scrim" onClick={() => setCrewOpen(false)}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>Crew &amp; invite code</b><small>{projName}</small></div>
              <button className="sh-x" onClick={() => setCrewOpen(false)}>✕</button>
            </div>
            <div className="form-body">
              <label className="ev-lbl">Invite code</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 22, fontWeight: 700, letterSpacing: 2, padding: "12px 14px", borderRadius: 12, background: "rgba(14,116,189,.08)", color: "var(--navy)", textAlign: "center" }}>
                  {activeCode || "—"}
                </div>
                <button className="lg-btn" style={{ height: 48, margin: 0, width: "auto", padding: "0 16px" }} onClick={() => copyCode(activeCode)}>{copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <p className="page-sub" style={{ margin: "10px 0 18px" }}>Share this code — anyone who enters it joins <b>{projName}</b> and sees the shared calendar, tasks and plans. {curProject?.role === "admin" ? "" : "(Only the admin should hand this out.)"}</p>
              <label className="ev-lbl">On this site ({members.length})</label>
              <div>
                {members.map((m) => (
                  <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid rgba(148,166,190,.15)" }}>
                    <span style={{ width: 12, height: 12, borderRadius: 99, background: crewColor(m.colorIndex), flex: "0 0 auto" }} />
                    <b style={{ fontSize: 15 }}>{m.name}{m.isMe ? " (you)" : ""}</b>
                    {m.title && <small style={{ color: "var(--slate)" }}>· {m.title}</small>}
                    <small style={{ marginLeft: "auto", color: "var(--slate)" }}>{m.role === "admin" ? "Admin" : "Crew"}</small>
                  </div>
                ))}
              </div>
            </div>
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
              {(eventsByDay.get(openDay) ?? []).map((e) => <EventRow key={e.id} e={e} colorFor={colorFor} />)}
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
              <div className="ti"><b>New event</b><small>{projName} · NZ time</small></div>
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

              <label className="ev-lbl">Assign to <span className="opt">· optional</span></label>
              <select className="ev-in" value={evAssignee} onChange={(e) => setEvAssignee(e.target.value)}>
                <option value="">Nobody — just on the calendar</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.title ? ` — ${m.title}` : ""}{m.isMe ? " (me)" : ""}</option>)}
              </select>

              <label className="ev-lbl">Visible to</label>
              {evAssignee ? (
                <div className="page-sub" style={{ margin: "2px 0 6px" }}>Assigned to <b>{members.find((m) => m.userId === evAssignee)?.name}</b> — visible to the whole crew.</div>
              ) : (
                <div className="ev-kinds">
                  <button type="button" className={"ev-kind" + (evVis === "team" ? " act" : "")} onClick={() => setEvVis("team")}>Whole crew</button>
                  <button type="button" className={"ev-kind" + (evVis === "private" ? " act" : "")} onClick={() => setEvVis("private")}>Just me</button>
                </div>
              )}

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
              <div className="ti"><b>New task</b><small>{projName} · a to-do</small></div>
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

              <label className="ev-lbl">Assign to <span className="opt">· optional</span></label>
              <select className="ev-in" value={tkAssignee} onChange={(e) => setTkAssignee(e.target.value)}>
                <option value="">Nobody — just a to-do</option>
                {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.title ? ` — ${m.title}` : ""}{m.isMe ? " (me)" : ""}</option>)}
              </select>

              <label className="ev-lbl">Visible to</label>
              {tkAssignee ? (
                <div className="page-sub" style={{ margin: "2px 0 6px" }}>Assigned to <b>{members.find((m) => m.userId === tkAssignee)?.name}</b> — visible to the whole crew.</div>
              ) : (
                <div className="ev-kinds">
                  <button type="button" className={"ev-kind" + (tkVis === "private" ? " act" : "")} onClick={() => setTkVis("private")}>Just me</button>
                  <button type="button" className={"ev-kind" + (tkVis === "team" ? " act" : "")} onClick={() => setTkVis("team")}>Whole crew</button>
                </div>
              )}

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

/* ── site create / join screen (first-run mandatory, or switcher overlay) ── */
function SiteSetup(props: {
  mandatory: boolean;
  mode: "create" | "join";
  setMode: (m: "create" | "join") => void;
  name: string; setName: (v: string) => void;
  code: string; setCode: (v: string) => void;
  personName: string; setPersonName: (v: string) => void;
  title: string; setTitle: (v: string) => void;
  busy: boolean; err: string | null;
  createdCode: string | null; createdName: string;
  onCreate: () => void; onJoin: () => void;
  onClose?: () => void; onEnter: () => void; onUploadPlans: () => void;
  onCopy: () => void; copied: boolean;
  onSignOut: () => void;
}) {
  const p = props;
  // Your name + job title — collected on BOTH create and join so assigning by
  // name ("Jon") or by title ("the site manager") both work.
  const who = (submit: () => void, titlePlaceholder: string) => (
    <div className="ev-grid" style={{ marginTop: 10 }}>
      <div>
        <label className="ev-lbl">Your name</label>
        <input className="ev-in" value={p.personName} onChange={(e) => p.setPersonName(e.target.value)} placeholder="e.g. Jon Smith"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
      <div>
        <label className="ev-lbl">Your title</label>
        <input className="ev-in" value={p.title} onChange={(e) => p.setTitle(e.target.value)} placeholder={titlePlaceholder}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      </div>
    </div>
  );
  return (
    <div className="scrim" onClick={() => p.onClose?.()} style={{ background: p.mandatory ? "var(--bg, #F4F7FB)" : undefined }}>
      <div className="sheet" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        {p.createdCode ? (
          <>
            <div className="sh-top"><div className="ti"><b>Your site is live 🎉</b><small>{p.createdName}</small></div></div>
            <div className="form-body">
              <p className="page-sub" style={{ marginTop: 0 }}>Share this join code with your crew — they enter it when they sign up and land straight on this site.</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 26, fontWeight: 700, letterSpacing: 3, padding: "16px", borderRadius: 12, background: "rgba(14,116,189,.08)", color: "var(--navy)", textAlign: "center" }}>{p.createdCode}</div>
                <button className="lg-btn" style={{ height: 56, margin: 0, width: "auto", padding: "0 18px" }} onClick={p.onCopy}>{p.copied ? "Copied ✓" : "Copy"}</button>
              </div>
              <p className="page-sub" style={{ margin: "18px 0 8px" }}>Next: load this site&apos;s plans. Drop the whole drawing set &amp; specs — Soterra reads every page so you and the crew can ask it anything.</p>
              <div className="form-actions" style={{ marginTop: 6 }}>
                <button className="lg-btn primary" style={{ height: 48, margin: 0, flex: 1 }} onClick={p.onUploadPlans}>⬆ Upload site plans</button>
              </div>
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button onClick={p.onEnter} style={{ background: "none", border: "none", color: "var(--slate)", fontSize: 14, cursor: "pointer", textDecoration: "underline" }}>Skip for now — enter {p.createdName}</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="sh-top">
              <div className="ti"><b>{p.mandatory ? "Welcome to Soterra" : "Create or join a site"}</b><small>{p.mandatory ? "Set up your site to get going" : "Start a new site or join your crew's"}</small></div>
              {p.onClose && <button className="sh-x" onClick={p.onClose}>✕</button>}
            </div>
            <div className="form-body">
              <div className="ev-kinds" style={{ marginBottom: 16 }}>
                <button type="button" className={"ev-kind" + (p.mode === "create" ? " act" : "")} onClick={() => p.setMode("create")}>Create a site</button>
                <button type="button" className={"ev-kind" + (p.mode === "join" ? " act" : "")} onClick={() => p.setMode("join")}>Join with a code</button>
              </div>

              {p.mode === "create" ? (
                <>
                  <label className="ev-lbl">Site name</label>
                  <input className="ev-in" value={p.name} autoFocus onChange={(e) => p.setName(e.target.value)} placeholder="e.g. 12 Beach Road — Townhouses"
                    onKeyDown={(e) => { if (e.key === "Enter") p.onCreate(); }} />
                  {who(p.onCreate, "e.g. Project Manager")}
                  <p className="page-sub" style={{ margin: "10px 0 0" }}>You&apos;ll be the site admin and get an invite code to bring your crew on.</p>
                  {p.err && <div className="ev-err">{p.err}</div>}
                  <div className="form-actions" style={{ marginTop: 18 }}>
                    <button className="lg-btn primary" style={{ height: 48, margin: 0, flex: 1 }} disabled={p.busy} onClick={p.onCreate}>{p.busy ? "Creating…" : "Create site"}</button>
                  </div>
                </>
              ) : (
                <>
                  <label className="ev-lbl">Join code</label>
                  <input className="ev-in" value={p.code} autoFocus onChange={(e) => p.setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX"
                    style={{ fontFamily: "ui-monospace, monospace", letterSpacing: 2 }}
                    onKeyDown={(e) => { if (e.key === "Enter") p.onJoin(); }} />
                  {who(p.onJoin, "e.g. Site Manager")}
                  <p className="page-sub" style={{ margin: "10px 0 0" }}>Enter the code your site manager shared, plus your name &amp; title, to join the site.</p>
                  {p.err && <div className="ev-err">{p.err}</div>}
                  <div className="form-actions" style={{ marginTop: 18 }}>
                    <button className="lg-btn primary" style={{ height: 48, margin: 0, flex: 1 }} disabled={p.busy} onClick={p.onJoin}>{p.busy ? "Joining…" : "Join site"}</button>
                  </div>
                </>
              )}

              {p.mandatory && (
                <div style={{ textAlign: "center", marginTop: 16 }}>
                  <button onClick={p.onSignOut} style={{ background: "none", border: "none", color: "var(--slate)", fontSize: 13, cursor: "pointer", textDecoration: "underline" }}>Sign out</button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
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

// One event row — used in the week strip, agenda, and day modal. Bar colour is
// the assignee's crew colour when assigned, else the event type's colour.
function EventRow({ e, colorFor }: { e: CalEvent; colorFor?: (id: string | null) => string | null }) {
  const tag = kindTag(e.kind);
  const crew = e.assigneeId ? colorFor?.(e.assigneeId) : null;
  const bar = crew || barColor(e.kind);
  const sub = [e.location, e.assigneeName ? `→ ${e.assigneeName}` : null, e.visibility === "team" ? "whole crew" : "just you", e.creatorName].filter(Boolean).join(" · ");
  return (
    <div className="ev">
      <div className="bar" style={{ background: bar }} />
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
  const assignee = t.assigneeName ? `→ ${t.assigneeName}` : null;
  const meta = full
    ? [t.creatorName, assignee, t.done ? "done" : due ? `due ${due}${time ? ` · ${time}` : ""}` : null].filter(Boolean).join(" · ")
    : [t.done ? "done" : time || (due ? `due ${due}` : null), assignee, t.creatorName].filter(Boolean).join(" · ");
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
