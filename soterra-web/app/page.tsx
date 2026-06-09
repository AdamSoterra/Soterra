"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

type Tab = "assistant" | "calendar" | "tasks" | "plans" | "upload";
type Cite = { code: string; title: string; sub: string; ans: string; hlTag: string };
type Msg =
  | { role: "u"; text: string }
  | { role: "a"; src?: string; text: string; cite?: Cite; event?: { title: string; when: string }; pending?: boolean };

// ─── Calendar + Tasks ─── (ported/adapted from the Montázs naptar/teendők)
const PROJECT_ID = "1-arthur-road";
// Soterra's project timezone. TODO: per-project tz once projects carry one.
const TZ = "Pacific/Auckland";

type EventKind = "inspection" | "delivery" | "pour" | "reminder" | "event";
type CalEvent = {
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  kind: EventKind;
  visibility: "team" | "private";
  creatorName: string | null;
};
type CalTask = {
  id: string;
  title: string;
  dueAt: string | null; // ISO
  done: boolean;
  visibility: "team" | "private";
  creatorName: string | null;
};

const EVENT_KINDS: { value: EventKind; label: string }[] = [
  { value: "inspection", label: "Inspection" },
  { value: "delivery", label: "Delivery" },
  { value: "pour", label: "Pour" },
  { value: "reminder", label: "Reminder" },
];

// TODO: colour by crew member once a crew table exists. For now we colour by
// event kind, reusing the existing dot/bar classes + CSS vars.
const KIND_DOT: Record<EventKind, string> = {
  inspection: "bl",
  delivery: "gr",
  pour: "nv",
  reminder: "am",
  event: "bl",
};
const KIND_BAR: Record<EventKind, string> = {
  inspection: "var(--brand)",
  delivery: "var(--green)",
  pour: "var(--navy)",
  reminder: "var(--amber)",
  event: "var(--brand)",
};
const KIND_TAG: Record<EventKind, { label: string; bg: string; fg: string }> = {
  inspection: { label: "Inspection", bg: "rgba(14,116,189,.1)", fg: "var(--brand-d)" },
  delivery: { label: "Delivery", bg: "rgba(16,185,129,.12)", fg: "var(--green)" },
  pour: { label: "Pour", bg: "rgba(10,37,64,.1)", fg: "var(--navy)" },
  reminder: { label: "Reminder", bg: "rgba(245,158,11,.14)", fg: "var(--amber)" },
  event: { label: "Event", bg: "rgba(14,116,189,.1)", fg: "var(--brand-d)" },
};

const NZ_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Auckland-anchored YYYY-MM-DD key — keeps timezones honest so two events on the
// same local day never land on separate cells. (Montázs uses Europe/Budapest.)
function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function todayKey(): string {
  return dayKey(new Date());
}
function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat("en-NZ", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}
// "FRI 12" style agenda stamp in the project timezone.
function fmtAgendaDay(iso: string): string {
  const wd = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short" }).format(new Date(iso)).toUpperCase();
  const day = new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, day: "numeric" }).format(new Date(iso));
  return `${wd} ${day}`;
}
// Short due-date label for task rows, e.g. "Wed 17". Null dueAt → no label.
function fmtDue(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-NZ", { timeZone: TZ, weekday: "short", day: "numeric" }).format(new Date(iso));
}

// Build a Mon-start grid sized to whatever the month needs (5 weeks usually, 6
// on overflow). Trailing all-out-of-month weeks are dropped to stay compact.
// Ported verbatim from Montázs buildMonthGrid.
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

const CHIPS = [
  "What's the fire rating on the exterior doors?",
  "What GIB do I use in the bathrooms?",
  "Beam size over the garage?",
  "Insulation R-value — external walls?",
];

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

  // ─── live Calendar + Tasks state ───
  const now = useMemo(() => new Date(), []);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<CalTask[]>([]);
  const [evLoaded, setEvLoaded] = useState(false);
  const [taskLoaded, setTaskLoaded] = useState(false);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed
  const [showEventForm, setShowEventForm] = useState(false);
  const [newTask, setNewTask] = useState("");
  const [newTaskVis, setNewTaskVis] = useState<"team" | "private">("private");
  const [addingTask, setAddingTask] = useState(false);

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

  const addTask = async () => {
    const title = newTask.trim();
    if (!title || addingTask) return;
    setAddingTask(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, visibility: newTaskVis }),
      });
      const data = await res.json();
      if (data.task) {
        setTasks((ts) => [...ts, data.task as CalTask]);
        setNewTask("");
      }
    } catch {
      /* swallow — input keeps its value so the user can retry */
    } finally {
      setAddingTask(false);
    }
  };

  // Create-event form state. Date defaults to today (Auckland), kind=inspection,
  // visibility=team (the crew should see the schedule).
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState(todayKey());
  const [evTime, setEvTime] = useState("");
  const [evKind, setEvKind] = useState<EventKind>("inspection");
  const [evLocation, setEvLocation] = useState("");
  const [evVis, setEvVis] = useState<"team" | "private">("team");
  const [evSaving, setEvSaving] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);

  const resetEventForm = () => {
    setEvTitle(""); setEvDate(todayKey()); setEvTime(""); setEvKind("inspection");
    setEvLocation(""); setEvVis("team"); setEvError(null);
  };

  const saveEvent = async () => {
    if (evSaving) return;
    const title = evTitle.trim();
    if (!title || !evDate) { setEvError("Title and date are required."); return; }
    setEvSaving(true);
    setEvError(null);
    // Build an ISO instant. With a time → that wall-clock; without → all-day at
    // local noon so it lands on the right Auckland day regardless of UTC offset.
    // (Simpler than Montázs's budapestWallClockToUtc; good enough until we add a
    // proper tz-aware picker. TODO: convert wall-clock in the project tz exactly.)
    const allDay = !evTime;
    const startsAt = new Date(`${evDate}T${evTime || "12:00"}:00`).toISOString();
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, startsAt, allDay, kind: evKind, location: evLocation.trim() || null, visibility: evVis }),
      });
      const data = await res.json();
      if (!res.ok || !data.event) throw new Error(data.error || "Save failed");
      setEvents((es) => [...es, data.event as CalEvent]);
      // Jump the grid to the new event's month so the dot is visible.
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setBusy(true);
    setTab("assistant");
    setMessages((m) => [...m, { role: "u", text: t }, { role: "a", text: "…", pending: true }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: t }),
      });
      const data = await res.json();
      const ans = String(data.answer || data.error || "Sorry, something went wrong.");
      const sm = ans.match(/\n*\s*Source:\s*([^\n]+)\s*$/i);
      const body = sm ? ans.slice(0, sm.index).trim() : ans;
      const cite = sm ? makeCite(sm[1].trim(), body) : undefined;
      setMessages((prev) => [...prev.slice(0, -1), { role: "a", src: "📐 FROM YOUR PLANS", text: fmt(body), cite }]);
    } catch {
      setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Sorry — couldn't reach the plans just now. Try again." }]);
    } finally {
      setBusy(false);
    }
  };

  // Group events by Auckland day-key, time-sorted within each day (Montázs pattern).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of events) {
      const k = dayKey(new Date(e.startsAt));
      const list = map.get(k) ?? [];
      list.push(e);
      map.set(k, list);
    }
    for (const list of map.values())
      list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return map;
  }, [events]);

  // Month grid cells: day number, today flag, out-of-month (mut), and the
  // distinct kind-dots present on that day.
  const calCells = useMemo(() => {
    const grid = buildMonthGrid(calYear, calMonth);
    const tk = todayKey();
    return grid.map((d) => {
      const k = dayKey(d);
      const dayEvents = eventsByDay.get(k) ?? [];
      const dots: string[] = [];
      for (const e of dayEvents) {
        const dot = KIND_DOT[e.kind] ?? "bl";
        if (!dots.includes(dot)) dots.push(dot); // one dot per distinct kind
      }
      return { n: d.getDate(), today: k === tk, dots: dots.slice(0, 4), mut: d.getMonth() !== calMonth };
    });
  }, [calYear, calMonth, eventsByDay]);

  // "This week": events from today through the next 7 days, in the project tz.
  const weekEvents = useMemo(() => {
    const ms = Date.now();
    const weekAhead = ms + 7 * 24 * 60 * 60 * 1000;
    return events
      .filter((e) => {
        const t = new Date(e.startsAt).getTime();
        return t >= ms - 12 * 60 * 60 * 1000 && t <= weekAhead;
      })
      .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  }, [events]);

  function gotoMonth(delta: number) {
    let m = calMonth + delta;
    let y = calYear;
    while (m < 0) { m += 12; y -= 1; }
    while (m > 11) { m -= 12; y += 1; }
    setCalMonth(m);
    setCalYear(y);
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

  const cbox = (
    <div className="cbox">
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        placeholder="Ask your plans, or anything on site…"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="crow">
        <span className="hint">Enter to send · Shift+Enter for a new line</span>
        <div className="ract">
          <button className="attach" title="Attach">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 18.6a1.7 1.7 0 0 1-2.3-2.3l7.8-7.8" /></svg>
          </button>
          <button className="send" disabled={busy || !input.trim()} onClick={() => send()}>
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
                          <div className="msg u" key={i}><div className="bub">{m.text}</div></div>
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
                              {m.event && (
                                <div className="evcard"><div className="bar" /><div className="et"><b>{m.event.title}</b><small>{m.event.when}</small></div><div className="ec">🗓️</div></div>
                              )}
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
        )}

        {/* ─── CALENDAR ─── */}
        {tab === "calendar" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Calendar</div>
            <div className="page-sub">1 Arthur Road · site schedule (NZ time)</div>
            <div className="cal-top">
              <b>{NZ_MONTHS[calMonth]} {calYear}</b>
              <div className="cal-nav">
                <button onClick={() => gotoMonth(-1)} aria-label="Previous month">‹</button>
                <button onClick={() => gotoMonth(1)} aria-label="Next month">›</button>
                <button className="task-add" style={{ width: "auto", padding: "0 14px", marginTop: 0, fontSize: 13 }} onClick={() => setShowEventForm(true)}>＋ New event</button>
              </div>
            </div>
            <div className="cal-card">
              <div className="cal-dow"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>
              <div className="cal-days">
                {calCells.map((c, i) => (
                  <div className={"cd" + (c.today ? " today" : "") + (c.mut ? " mut" : "")} key={i}>
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
              weekEvents.map((e) => {
                const tag = KIND_TAG[e.kind] ?? KIND_TAG.event;
                const when = `${fmtAgendaDay(e.startsAt)} · ${e.allDay ? "all day" : fmtTime(e.startsAt)}`;
                const sub = [e.location, e.visibility === "team" ? "whole crew" : "just you", e.creatorName].filter(Boolean).join(" · ");
                return (
                  <Ev key={e.id} bar={KIND_BAR[e.kind] ?? "var(--brand)"} when={when} title={e.title} sub={sub} tag={tag.label} tagBg={tag.bg} tagFg={tag.fg} />
                );
              })
            )}
          </div></div>
        )}

        {/* ─── TASKS ─── */}
        {tab === "tasks" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Tasks</div>
            <div className="page-sub">1 Arthur Road · your to-dos and the crew&apos;s — what&apos;s coming up</div>
            {taskLoaded && tasks.length === 0 && (
              <div className="page-sub" style={{ marginBottom: 14 }}>No tasks yet. Add your first one below.</div>
            )}
            {tasks.map((t) => {
              const due = fmtDue(t.dueAt);
              const meta = [t.creatorName, t.done ? "done" : due ? `due ${due}` : null].filter(Boolean).join(" · ");
              const vis = t.visibility === "team" ? "team" : "me";
              return (
                <div className={"task" + (t.done ? " done" : "")} key={t.id}>
                  <div className="cb" onClick={() => toggleTask(t)}>{t.done ? "✓" : ""}</div>
                  <div className="tk"><b>{t.title}</b>{meta && <small>{meta}</small>}</div>
                  <span className={"vis " + vis}>{vis === "team" ? "Team" : "Just me"}</span>
                </div>
              );
            })}
            {/* Inline add-a-task row: type → Enter or +, with a Team/Just-me toggle. */}
            <div className="task-add" style={{ cursor: "default" }} onClick={(e) => e.stopPropagation()}>
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTask(); } }}
                placeholder="Add a task…"
                style={{ flex: 1, border: "none", outline: "none", background: "none", fontFamily: "var(--font)", fontSize: 14, color: "var(--navy)" }}
              />
              <button
                onClick={() => setNewTaskVis((v) => (v === "team" ? "private" : "team"))}
                className={"vis " + (newTaskVis === "team" ? "team" : "me")}
                style={{ border: "none", cursor: "pointer" }}
                title="Toggle who can see this task"
              >
                {newTaskVis === "team" ? "Team" : "Just me"}
              </button>
              <button
                onClick={addTask}
                disabled={!newTask.trim() || addingTask}
                className="send"
                style={{ width: 34, height: 34, opacity: !newTask.trim() || addingTask ? 0.5 : 1 }}
                aria-label="Add task"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            </div>
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

      {/* ─── create-event modal (ported/adapted from Montázs event-form) ─── */}
      {showEventForm && (
        <div className="scrim" onClick={() => { setShowEventForm(false); resetEventForm(); }}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New event</b><small>1 Arthur Road · NZ time</small></div>
              <button className="sh-x" onClick={() => { setShowEventForm(false); resetEventForm(); }}>✕</button>
            </div>
            <div style={{ padding: "20px 22px 24px", overflowY: "auto" }}>
              <label className="ev-lbl">Event</label>
              <input
                className="ev-in"
                value={evTitle}
                autoFocus
                onChange={(e) => setEvTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveEvent(); } }}
                placeholder="e.g. Pre-line inspection — Unit 49"
              />

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
                <div>
                  <label className="ev-lbl">Date</label>
                  <input className="ev-in" type="date" value={evDate} onChange={(e) => setEvDate(e.target.value)} style={{ width: "auto" }} />
                </div>
                <div>
                  <label className="ev-lbl">Time <span style={{ color: "var(--mut)", fontWeight: 400 }}>· optional</span></label>
                  <input className="ev-in" type="time" value={evTime} onChange={(e) => setEvTime(e.target.value)} style={{ width: "auto" }} />
                </div>
              </div>

              <label className="ev-lbl" style={{ marginTop: 14 }}>Type</label>
              <div className="ev-kinds">
                {EVENT_KINDS.map((k) => (
                  <button
                    key={k.value}
                    className={"ev-kind" + (evKind === k.value ? " act" : "")}
                    onClick={() => setEvKind(k.value)}
                    type="button"
                  >
                    <span className={"d " + (KIND_DOT[k.value] ?? "bl")} style={{ width: 8, height: 8, borderRadius: "50%", display: "inline-block" }} />
                    {k.label}
                  </button>
                ))}
              </div>

              <label className="ev-lbl" style={{ marginTop: 14 }}>Location <span style={{ color: "var(--mut)", fontWeight: 400 }}>· optional</span></label>
              <input className="ev-in" value={evLocation} onChange={(e) => setEvLocation(e.target.value)} placeholder="e.g. Block C, Level 2" />

              <label className="ev-lbl" style={{ marginTop: 14 }}>Visible to</label>
              <div className="ev-kinds">
                <button type="button" className={"ev-kind" + (evVis === "team" ? " act" : "")} onClick={() => setEvVis("team")}>Team</button>
                <button type="button" className={"ev-kind" + (evVis === "private" ? " act" : "")} onClick={() => setEvVis("private")}>Just me</button>
              </div>

              {evError && <div className="ev-err">{evError}</div>}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={evSaving} onClick={saveEvent}>
                  {evSaving ? "Saving…" : "Add event"}
                </button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={evSaving} onClick={() => { setShowEventForm(false); resetEventForm(); }}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── helpers ── */
function fmt(s: string): string {
  return s
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n+/g, "<br/>");
}
function makeCite(sourceLine: string, body: string): Cite {
  const parts = sourceLine.split("·").map((x) => x.trim()).filter(Boolean);
  const doc = parts[0] || "Source";
  const code = parts.find((p, i) => i > 0 && /[A-Z]/.test(p) && /\d/.test(p)) || doc;
  const rest = parts.filter((p) => p !== doc && p !== code).join(" · ");
  return { code, title: rest || doc, sub: doc, ans: fmt(body), hlTag: code };
}
function Ev(p: { bar: string; when: string; title: string; sub: string; tag: string; tagBg: string; tagFg: string }) {
  return (
    <div className="ev">
      <div className="bar" style={{ background: p.bar }} />
      <div className="when">{p.when}</div>
      <div className="body"><b>{p.title}</b><small>{p.sub}</small></div>
      <div className="tag" style={{ background: p.tagBg, color: p.tagFg }}>{p.tag}</div>
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
