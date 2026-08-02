"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import Landing from "./landing";

type Tab = "assistant" | "calendar" | "tasks" | "plans" | "upload" | "insights";
type Cite = {
  code: string; title: string; sub: string; ans: string; hlTag: string;
  // Set when the answer came from a manufacturer's manual (e.g. GIB) rather than
  // the customer's own plans. Drives a different card, a different viewer (the
  // real page rendered as an image) and a link to the manufacturer's own PDF.
  // "determination" = an MBIE ruling on a real dispute. Its own card and viewer,
  // rendered from MBIE's public PDF and always shown with its year, because a
  // ruling can rest on an Acceptable Solution that has since changed.
  kind?: "manufacturer" | "determination" | "standard";
  mfr?: string; doc?: string; page?: number; url?: string;
  /** Determination reference, "2024/001". */
  ref?: string;
  /** Standard demo page: the slug (e.g. "nzs-3604-2011") for /api/standard-page. */
  stdSlug?: string;
};
type AsstCard = {
  id: string;
  itemType: "event" | "task" | "checklist" | "standard";
  action: "created" | "updated" | "deleted";
  title: string;
  when: string;
  sub: string;
  kind: string | null;
  visibility: "team" | "private";
  assigneeName?: string | null;
  /** "standard" cards: where to get a figure we are not licensed to reproduce.
   *  `demo` is set only for a demo-corpus account (personal-use evaluation of the
   *  account's own licensed copy) — a customer never receives it. */
  std?: {
    ref: string; title: string; section: string | null; holds: string; url: string;
    demo?: { slug: string; pages: { page: number; label: string }[] };
  };
};
// A manufacturer document we hold, from /api/manufacturer-docs. Drives reliable
// manufacturer citations (card, page image, verify link) independent of what the
// model writes in its answer.
type MfrDoc = { manufacturer: string; doc: string; sourceUrl: string | null; npages: number };
type Msg =
  | { role: "u"; text: string; att?: string }
  | { role: "a"; src?: string; text: string; raw?: string; full?: string; cites?: Cite[]; cards?: AsstCard[]; pending?: boolean };
type Attachment = { kind: "image" | "pdf"; mediaType: string; data: string; name: string };

// ─── Sites (projects) + crew ───
type Project = { id: string; name: string; code: string; role: string; timezone?: string };
type Member = { userId: string; name: string; title: string | null; role: string; colorIndex: number; isMe: boolean };
type PlanDoc = { doc: string; npages: number; indexed: number; file: string | null; uploadedAt: string };

// ─── Inspection history + checklists ───
type CategoryCount = { category: string; count: number };
type TopItem = { title: string; category: string; count: number; lastSeen: string | null };
type InspectionRow = {
  id: string; doc: string; projectId: string; projectName: string | null;
  source: string; inspectionCode: string | null; inspectionType: string | null;
  outcome: string; inspectedOn: string | null; itemCount: number; createdAt: string;
};
type Insights = {
  company: { name: string | null; sites: number };
  // `graded` = inspections that actually carry a pass/partial/fail. Consultant
  // site visits don't, so the pass rate is only meaningful over this subset.
  summary: { inspections: number; failedItems: number; graded: number; cleanPasses: number; returnVisits: number };
  categories: CategoryCount[];
  topItems: TopItem[];
  // The trade the drill-down is currently showing (defaults server-side to the
  // worst trade). The chart highlights this one and topItems belong to it.
  selectedCategory: string | null;
  inspections: InspectionRow[];
};
type ChecklistPhoto = { id: string; itemId: string; url: string; caption: string | null };
type ChecklistItem = {
  id: string; ord: number; category: string | null; title: string; detail: string | null;
  source: string; sourceRef: string | null; status: "pending" | "ok" | "issue" | "na";
  note: string | null; checkedByName: string | null; photos: ChecklistPhoto[];
};
type ChecklistHead = {
  id: string; eventId: string | null; kind: string; title: string; inspectionCode: string | null;
  status: string; createdByName: string | null; createdAt: string;
  total?: number; done?: number; issues?: number;
};
type ChecklistFull = { checklist: ChecklistHead; items: ChecklistItem[] };

// Consultant discipline codes → readable names (mirrors lib/categories.ts
// CONSULTANT_TYPES). Council codes come back on the row already named.
const DISCIPLINE: Record<string, string> = {
  FIRE: "Fire", ELEC: "Electrical", MECH: "Mechanical", HYD: "Hydraulic / plumbing",
  STRU: "Structural", ARCH: "Architectural", ACOU: "Acoustic", SEIS: "Seismic",
  SERV: "Building services",
};

// Past inspections, grouped the way they arrive: all the council ones together
// (they're one statutory series), then a heading per consultant discipline.
function groupInspections(rows: InspectionRow[]): { key: string; label: string; rows: InspectionRow[] }[] {
  const groups = new Map<string, { key: string; label: string; rows: InspectionRow[] }>();
  for (const r of rows) {
    const isCouncil = r.source === "council";
    const key = isCouncil ? "council" : r.inspectionCode && DISCIPLINE[r.inspectionCode] ? r.inspectionCode : "other";
    const label = isCouncil ? "Council" : DISCIPLINE[key] ?? "Other consultant";
    const g = groups.get(key) ?? { key, label, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  // Council first, then the biggest disciplines, "Other consultant" last.
  return [...groups.values()].sort((a, b) =>
    a.key === "council" ? -1 : b.key === "council" ? 1 : a.key === "other" ? 1 : b.key === "other" ? -1 : b.rows.length - a.rows.length
  );
}

// A collapsible section heading on Insights: the same .pg-k label, made into a
// button with a chevron that folds its body away.
function IzToggle({ label, count, open, onClick }: { label: string; count?: number | null; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className="pg-k iz-toggle" onClick={onClick} aria-expanded={open}>
      <span className={"iz-chev" + (open ? " open" : "")}>›</span>
      <span>{label}{count != null && count > 0 ? ` (${count})` : ""}</span>
    </button>
  );
}

// Category colours — must match lib/categories.ts CATEGORY_COLOR.
const CAT_COLOR: Record<string, string> = {
  Fire: "#EF4444",
  "Weathertightness / Cladding": "#0E74BD",
  Structural: "#0A2540",
  "Plumbing & Drainage": "#06B6D4",
  Electrical: "#F59E0B",
  Mechanical: "#8B5CF6",
  "Interior / Linings": "#10B981",
  "Access & Barriers": "#EC4899",
  "Site / External": "#65A30D",
  Acoustic: "#7C3AED",
  Seismic: "#B45309",
  Architect: "#0891B2",
  Other: "#94A6BE",
};
const catColor = (c: string) => CAT_COLOR[c] ?? "#94A6BE";

const OUTCOME_PILL: Record<string, string> = { pass: "pass", partial: "open", fail: "fail", unknown: "na" };
const OUTCOME_LABEL: Record<string, string> = { pass: "Passed", partial: "Partial", fail: "Failed", unknown: "—" };

// Where a checklist item came from. An item with no source is a guess, so the
// badge is deliberately loud about which of the three sources backed it.
const SRC_LABEL: Record<string, string> = { plans: "Plans", code: "Code", manufacturer: "GIB manual", history: "Our history", ccc: "CCC pack", manual: "Added" };

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
// Next calendar day for a YYYY-MM-DD key. Plain date arithmetic (noon-anchored
// so DST can't shift it) — used to walk a multi-day event across the grid.
function nextDayKey(k: string): string {
  const d = new Date(`${k}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
  insights: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>),
};
const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "assistant", label: "Assistant", icon: I.chat },
  { id: "calendar", label: "Calendar", icon: I.cal },
  { id: "tasks", label: "Tasks", icon: I.tasks },
  { id: "insights", label: "Insights", icon: I.insights },
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
        Got a site code? Log in or create an account, then enter it to join your site.
      </p>
    </div>
  );
}

// The indexed-document list, collapsed by default. A full drawing set is 120+
// sheets, which buried the rest of the page and made finding one to delete a
// long scroll. Shown on both Plans and Update plans, so it lives here.
function DocsList({ docs, onDelete }: { docs: { doc: string; indexed: number }[]; onDelete: (doc: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const shown = q.trim() ? docs.filter((d) => d.doc.toLowerCase().includes(q.trim().toLowerCase())) : docs;
  const pages = docs.reduce((n, d) => n + d.indexed, 0);
  return (
    <div className="docs-wrap">
      <button className={"docs-toggle" + (open ? " open" : "")} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        <b>{docs.length} document{docs.length === 1 ? "" : "s"}</b>
        <small>{pages} page{pages === 1 ? "" : "s"} indexed</small>
        <span className="docs-act">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <>
          {docs.length > 8 && (
            <input className="docs-find" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a sheet…" />
          )}
          <div className="docs">
            {shown.map((d) => (
              <div className="doc" key={d.doc}>
                <div className="ic spc">PDF</div>
                <div className="dt"><b>{d.doc}</b><small>{d.indexed} page{d.indexed === 1 ? "" : "s"} indexed</small></div>
                <button className="sh-x" title="Remove from index" onClick={() => onDelete(d.doc)} style={{ position: "static" }}>✕</button>
              </div>
            ))}
            {shown.length === 0 && <div className="page-sub" style={{ margin: "4px 2px" }}>Nothing matches “{q}”.</div>}
          </div>
        </>
      )}
    </div>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Cite | null>(null);
  // Reset the manufacturer-page image state each time a different source opens,
  // so a previous render error or spinner doesn't carry over.
  const [docImg, setDocImg] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => { setDocImg("loading"); }, [sheet]);
  // The full-screen page image (null = closed). Just shows the already-rendered
  // image bigger — no new render, no cost.
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);

  // The manufacturer documents we hold, so a "Source: GIB · …" line resolves to
  // a real card, page image and link even when the model doesn't paste the URL.
  const [mfrDocs, setMfrDocs] = useState<MfrDoc[]>([]);
  useEffect(() => {
    // Keep retrying until we actually get the list. A single attempt was fragile:
    // a cold session (Clerk not ready → 401 → empty) or a flaky network dropped it,
    // and with no map EVERY manufacturer citation silently mislabels as "FROM YOUR
    // PLANS" and its preview 404s (hit live at the GIB demo). Retry fixes the load;
    // the re-parse effect below then repairs any answers that rendered early.
    let live = true;
    let attempts = 0;
    const load = async () => {
      while (live && attempts < 8) {
        attempts++;
        try {
          const r = await fetch("/api/manufacturer-docs");
          if (r.ok) {
            const d = await r.json();
            if (live && Array.isArray(d.docs) && d.docs.length) { setMfrDocs(d.docs); return; }
          }
        } catch { /* network blip — retry */ }
        await new Promise((res) => setTimeout(res, 1500));
      }
    };
    load();
    return () => { live = false; };
  }, []);
  // If any answers rendered before the document list arrived, re-parse them now
  // so their citation cards and links appear without a resend.
  useEffect(() => {
    if (!mfrDocs.length) return;
    setMessages((prev) =>
      prev.map((m) => (m.role === "a" && m.full && !m.pending ? assistantMsg(m.full, m.cards, mfrDocs) : m)),
    );
  }, [mfrDocs]);
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
  const [setupCompany, setSetupCompany] = useState("");
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
  const planFolderRef = useRef<HTMLInputElement>(null);

  // ─── live Calendar + Tasks state ───
  const now = useMemo(() => new Date(), []);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [tasks, setTasks] = useState<CalTask[]>([]);
  const [evLoaded, setEvLoaded] = useState(false);
  const [taskLoaded, setTaskLoaded] = useState(false);
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth()); // 0-indexed
  const [calView, setCalView] = useState<"month" | "agenda">("month");
  // Crew filter: null = everyone. Filters the grid/agenda to one person's items.
  const [crewFilter, setCrewFilter] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showEventForm, setShowEventForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);

  // ─── Insights (company-wide inspection history) ───
  const [insights, setInsights] = useState<Insights | null>(null);
  const [insightsLoaded, setInsightsLoaded] = useState(false);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  // Which Insights sections are collapsed. Empty = all open; a section is
  // closed when its key is true. Lets a manager fold away the long lists.
  const [izClosed, setIzClosed] = useState<Record<string, boolean>>({});
  const izToggle = (k: string) => setIzClosed((s) => ({ ...s, [k]: !s[k] }));
  const [openInspection, setOpenInspection] = useState<{ inspection: InspectionRow; items: { id: string; category: string; title: string; detail: string | null; location: string | null }[] } | null>(null);
  const reportFileRef = useRef<HTMLInputElement>(null);
  const [repCurrent, setRepCurrent] = useState<{ name: string; phase: string; pct: number } | null>(null);
  const [repItems, setRepItems] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [repDragOver, setRepDragOver] = useState(false);

  // ─── Checklists (attached to a calendar event) ───
  const [checklists, setChecklists] = useState<ChecklistHead[]>([]);
  // Inspection types you can build a check for, grouped the way they actually
  // arrive: the council's statutory ones, then the consultants' disciplines.
  const [clTypes, setClTypes] = useState<{ council: { code: string; name: string }[]; consultant: { code: string; name: string }[] }>({ council: [], consultant: [] });
  const [openChecklist, setOpenChecklist] = useState<ChecklistFull | null>(null);
  const [clBusy, setClBusy] = useState(false);
  const [clErr, setClErr] = useState<string | null>(null);
  // The "new checklist" sheet, opened from an event or from Insights.
  const [newCl, setNewCl] = useState<{ eventId: string | null; eventTitle: string | null } | null>(null);
  const [newClKind, setNewClKind] = useState<"inspection" | "ccc">("inspection");
  const [newClCode, setNewClCode] = useState("");
  const [noteFor, setNoteFor] = useState<string | null>(null); // item id whose note box is open
  const [noteText, setNoteText] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoForRef = useRef<string | null>(null); // which item a picked photo belongs to

  // fetch() wrapper that tags every request with the current site so the server
  // can scope + authorise it. All per-site routes go through this.
  const apiFetch = (path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers || {});
    const pid = projRef.current;
    if (pid) headers.set("x-soterra-project", pid);
    return fetch(path, { ...init, headers });
  };

  /**
   * Wait for the current site id to be ready.
   *
   * On a fresh sign-in the projects list is still in flight for a moment. Asking
   * a question in that window sent the request with no site header, and the 403
   * came back rendered as the assistant's ANSWER: "No site selected". To the
   * person on screen that reads as a broken product, not a half-second of
   * loading — and it happened on the first take of a customer demo recording.
   * Waiting is the honest behaviour: the question they typed is still valid, it
   * just has to go a beat later.
   */
  const waitForProject = async (ms = 8000): Promise<string | null> => {
    const step = 150;
    for (let waited = 0; waited < ms && !projRef.current; waited += step) {
      await new Promise((r) => setTimeout(r, step));
    }
    return projRef.current;
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

  const loadInsights = async (category?: string | null) => {
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : "";
      const res = await apiFetch(`/api/insights${qs}`);
      const data = await res.json();
      if (data && data.summary) setInsights(data);
    } catch {
      /* leave as-is on failure */
    } finally {
      setInsightsLoaded(true);
    }
  };
  const loadChecklists = async () => {
    try {
      const res = await apiFetch("/api/checklists");
      const data = await res.json();
      if (Array.isArray(data.checklists)) setChecklists(data.checklists);
      if (data.types && Array.isArray(data.types.council)) setClTypes(data.types);
    } catch {
      /* ignore */
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
    // Insights are company-wide, but the fetch is authorised through the current
    // site — so a switch still has to re-fetch, and must not leave the old
    // site's checklists on screen.
    setInsights(null); setInsightsLoaded(false); setCatFilter(null); setOpenInspection(null);
    setChecklists([]); setOpenChecklist(null); setRepItems([]);
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
            m.role === "assistant" ? assistantMsg(m.content, undefined, mfrDocs) : ({ role: "u", text: m.content } as Msg)
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
    // The assistant home shows a today-at-a-glance, so it needs events + tasks too.
    if ((tab === "calendar" || tab === "assistant") && !evLoaded) loadEvents();
    if ((tab === "tasks" || tab === "assistant") && !taskLoaded) loadTasks();
    if ((tab === "plans" || tab === "upload") && !docsLoaded) loadPlans();
    if (tab === "insights" && !insightsLoaded) { loadInsights(); loadChecklists(); }
    // The calendar needs the checklist counts to show which inspections are
    // already prepped, so load them alongside events.
    if (tab === "calendar" && !checklists.length) loadChecklists();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, evLoaded, taskLoaded, docsLoaded, insightsLoaded, projectId]);

  // Manual delete — so a wrong booking can be fixed in one tap instead of going
  // through the assistant. Optimistic; resyncs from the server on failure.
  const deleteEvent = async (ev: CalEvent) => {
    if (!window.confirm(`Delete "${ev.title}"? This can't be undone.`)) return;
    setEvents((es) => es.filter((x) => x.id !== ev.id));
    setOpenDay(null);
    try {
      const res = await apiFetch("/api/events", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ev.id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      loadEvents(); // resync — the row is still there
    }
  };

  const deleteTask = async (t: CalTask) => {
    if (!window.confirm(`Delete "${t.title}"? This can't be undone.`)) return;
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
    try {
      const res = await apiFetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id }),
      });
      if (!res.ok) throw new Error();
    } catch {
      loadTasks();
    }
  };

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

  // Detect app-mode: the installed PWA (standalone) or an explicit ?app=1 launch.
  //
  // The flag lives in sessionStorage, NOT localStorage: it has to survive Clerk's
  // redirects within a session, but must never permanently hijack the marketing
  // site. The old localStorage version did exactly that — once a browser had
  // opened the app once, soterra.co.nz showed the login screen forever in that
  // browser. Hence the cleanup below.
  useEffect(() => {
    try {
      window.localStorage.removeItem("soterra:appmode"); // undo the old sticky flag
      // The native Android WebView reports display-mode "browser", NOT standalone,
      // and Capacitor loads the bare site URL — so without this check the native
      // app would show the MARKETING SITE to signed-out users instead of login.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const native = Boolean((window as any).Capacitor?.isNativePlatform?.());
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (navigator as any).standalone === true;
      const hasParam = new URLSearchParams(window.location.search).has("app");
      const sessionFlag = window.sessionStorage.getItem("soterra:appmode") === "1";
      if (native || standalone || hasParam || sessionFlag) {
        setAppMode(true);
        window.sessionStorage.setItem("soterra:appmode", "1");
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      setIsRecording(false);
      // Silent failure was the bug — a dead mic button with no reason. Surface it.
      const err = e?.error;
      if (err === "not-allowed" || err === "service-not-allowed")
        setAttachErr("Microphone is blocked. Allow mic access for this app in your device/browser settings, then try again.");
      else if (err === "audio-capture")
        setAttachErr("No microphone found — check one is connected.");
      else if (err === "network")
        setAttachErr("Voice dictation isn't available inside the installed app (it needs the browser's speech service). Open soterra.co.nz in Chrome to dictate, or just type.");
      else if (err && err !== "no-speech" && err !== "aborted")
        setAttachErr(`Voice didn't start (${err}). Type your message for now.`);
    };
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
      // Don't fire before the site id exists — see waitForProject.
      if (!(await waitForProject())) {
        setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Still connecting to your site — give that another go in a moment." }]);
        return;
      }
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
      setMessages((prev) => [...prev.slice(0, -1), assistantMsg(ans, cards, mfrDocs)]);
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
  const resetSetup = () => { setSetupName(""); setSetupCode(""); setSetupErr(null); setCreatedCode(null); setSetupMode("create"); setSetupPersonName(user?.firstName || ""); setSetupTitle(""); setSetupCompany(""); };
  const closeSetup = () => { setSetupOpen(false); resetSetup(); };
  const createSite = async () => {
    const name = setupName.trim();
    if (!name) { setSetupErr("Give your site a name."); return; }
    // Only the FIRST site names the company — after that the server puts every
    // new site under the company this person already belongs to, so their
    // failure history stays one history instead of splitting in two.
    const firstSite = projects.length === 0;
    if (firstSite && !setupCompany.trim()) { setSetupErr("Enter your company name."); return; }
    setSetupBusy(true); setSetupErr(null);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name, companyName: setupCompany.trim() || null, personName: setupPersonName.trim() || null, title: setupTitle.trim() || null }) });
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

  // The folder picker needs non-standard attributes that React won't type, so set
  // them on the DOM node directly. Chrome/Edge/Firefox all honour webkitdirectory
  // and return every file in the tree, subfolders included.
  useEffect(() => {
    const el = planFolderRef.current;
    if (!el) return;
    el.setAttribute("webkitdirectory", "");
    el.setAttribute("directory", "");
  }, [tab]);

  // Dropping a FOLDER gives you directory entries, not files — dataTransfer.files
  // is empty for them. Walk the tree via the entries API so a PM can drag the whole
  // "Lot-1&2-Approved-BC" folder (Architectural/CIVIL/Landscape/STRUCTURAL) in one go.
  const filesFromDrop = async (dt: DataTransfer): Promise<File[]> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const entries = Array.from(dt.items || []).map((i: any) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.length) return Array.from(dt.files || []);
    const out: File[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const walk = async (entry: any): Promise<void> => {
      if (entry.isFile) {
        const f = await new Promise<File | null>((res) => entry.file((x: File) => res(x), () => res(null)));
        if (f) out.push(f);
        return;
      }
      if (entry.isDirectory) {
        const reader = entry.createReader();
        // readEntries returns at most 100 per call — keep reading until it's dry,
        // or a big discipline folder silently loses everything past the 100th file.
        for (;;) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const batch: any[] = await new Promise((res) => reader.readEntries((b: any[]) => res(b), () => res([])));
          if (!batch.length) break;
          for (const e of batch) await walk(e);
        }
      }
    };
    await Promise.all(entries.map((e) => walk(e)));
    return out;
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
  // ─── inspection reports → this company's failure history ───
  const onReportFiles = async (fileList: FileList | File[]) => {
    const pid = projRef.current;
    if (repCurrent) return;
    if (!pid) { setRepItems((prev) => [{ name: "No site selected", ok: false, note: "pick a site first" }, ...prev]); return; }
    const all = Array.from(fileList);
    const pdfs = all.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    // Say so rather than dropping them on the floor — silence here is exactly
    // the "nothing happened" that made this feel broken in the first place.
    const notPdf = all.length - pdfs.length;
    if (notPdf > 0) setRepItems((prev) => [{ name: `${notPdf} file${notPdf === 1 ? "" : "s"} skipped`, ok: false, note: "not a PDF" }, ...prev]);
    if (!pdfs.length) return;

    // Reading a report takes 20-60s, almost all of it waiting on the model.
    // One at a time, a folder of 30 is half an hour of watching a bar — which
    // no site manager is going to do. They run four at a time instead, so the
    // wall clock is roughly a quarter of the sum. Four, not forty: each one
    // holds a serverless function, and the model has rate limits.
    const LANES = 4;
    let done = 0;
    const total = pdfs.length;
    setRepCurrent({ name: `${total} report${total === 1 ? "" : "s"}`, phase: "Reading", pct: 0 });

    const readOne = async (f: File) => {
      try {
        const blob = await upload(`${pid}/${f.name}`, f, {
          access: "private",
          handleUploadUrl: "/api/upload/token",
          clientPayload: JSON.stringify({ projectId: pid }),
          contentType: "application/pdf",
        });
        const res = await apiFetch("/api/inspections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathname: blob.pathname, filename: f.name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "couldn't read that report");
        const note = data.underRead
          // Say it plainly. A report whose register lists 25 open items and
          // came back with 2 is not a clean report, it's a bad read.
          ? `only read ${data.items} of about ${data.expectedItems} — check this one`
          : data.items === 0
            ? `${OUTCOME_LABEL[data.outcome] ?? "Filed"} — nothing outstanding`
            : `${data.items} item${data.items === 1 ? "" : "s"} · ${data.categories.slice(0, 2).join(", ")}${data.categories.length > 2 ? "…" : ""}`;
        setRepItems((prev) => [{ name: f.name, ok: !data.underRead, note }, ...prev]);
      } catch (e) {
        setRepItems((prev) => [{ name: f.name, ok: false, note: e instanceof Error ? e.message : "upload failed" }, ...prev]);
      } finally {
        done++;
        setRepCurrent({ name: `${done} of ${total} read`, phase: "Reading", pct: Math.round((done / total) * 100) });
        // Fill the page in as results land, rather than making them wait for
        // the whole batch to finish before anything appears.
        if (done % LANES === 0 || done === total) loadInsights(catFilter);
      }
    };

    // A shared queue, so a slow 23-page report doesn't hold up a whole lane's
    // worth of quick ones behind it.
    const queue = [...pdfs];
    await Promise.all(
      Array.from({ length: Math.min(LANES, queue.length) }, async () => {
        for (;;) {
          const next = queue.shift();
          if (!next) return;
          await readOne(next);
        }
      })
    );

    setRepCurrent(null);
    setInsightsLoaded(false);
    loadInsights(catFilter);
  };

  // Drag-and-drop for the report zones, same as the plan uploader. Worth having
  // both routes in: dropping a whole folder of reports beats picking them one
  // at a time, and it's the route that doesn't depend on a file dialog.
  const reportDropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (!repCurrent) setRepDragOver(true); },
    onDragLeave: () => setRepDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setRepDragOver(false);
      if (repCurrent) return;
      void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) onReportFiles(fs); });
    },
  };

  // ─── checklists ───
  const openChecklistById = async (id: string) => {
    setClErr(null);
    try {
      const res = await apiFetch(`/api/checklists?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (res.ok && data.checklist) setOpenChecklist(data);
    } catch {
      /* ignore */
    }
  };
  const createChecklist = async () => {
    if (!newCl) return;
    setClBusy(true); setClErr(null);
    try {
      const res = await apiFetch("/api/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: newCl.eventId,
          kind: newClKind,
          inspectionCode: newClKind === "inspection" ? newClCode || null : null,
          title: newClKind === "ccc" ? "CCC evidence pack" : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.checklist) throw new Error(data.error || "Couldn't build that checklist.");
      setNewCl(null); setNewClCode("");
      setOpenChecklist(data);
      loadChecklists();
    } catch (e) {
      setClErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setClBusy(false);
    }
  };
  // Tick an item. Optimistic — on site, on a phone, on bad reception, waiting
  // for a round trip before the tick lands is the difference between a tool
  // people use and one they don't.
  const setItemStatus = async (itemId: string, status: ChecklistItem["status"]) => {
    setOpenChecklist((c) => (c ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, status } : i)) } : c));
    try {
      const res = await apiFetch("/api/checklists", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, status }),
      });
      if (!res.ok) throw new Error();
      loadChecklists();
    } catch {
      if (openChecklist) openChecklistById(openChecklist.checklist.id); // resync
    }
  };
  const saveNote = async (itemId: string) => {
    const note = noteText.trim() || null;
    setOpenChecklist((c) => (c ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, note } : i)) } : c));
    setNoteFor(null); setNoteText("");
    try {
      await apiFetch("/api/checklists", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, note: note ?? "" }),
      });
    } catch {
      if (openChecklist) openChecklistById(openChecklist.checklist.id);
    }
  };
  const onPhotoPicked = async (file: File) => {
    const pid = projRef.current;
    const itemId = photoForRef.current;
    if (!pid || !itemId) return;
    try {
      // Resize on the phone before it goes up: a modern camera JPEG is 5-8 MB
      // and nobody on a site has the bandwidth for that.
      const small = await resizeImage(file, 1600, 0.82);
      const blob = await upload(`${pid}/checklists/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "_")}`, small, {
        access: "private",
        handleUploadUrl: "/api/upload/token",
        clientPayload: JSON.stringify({ projectId: pid }),
        contentType: "image/jpeg",
      });
      const res = await apiFetch("/api/checklists", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, photo: { url: blob.pathname } }),
      });
      if (!res.ok) throw new Error();
      if (openChecklist) openChecklistById(openChecklist.checklist.id);
    } catch {
      setClErr("Couldn't attach that photo — try again.");
    }
  };
  const closeOutChecklist = async (status: "open" | "done") => {
    if (!openChecklist) return;
    const id = openChecklist.checklist.id;
    setOpenChecklist((c) => (c ? { ...c, checklist: { ...c.checklist, status } } : c));
    try {
      await apiFetch("/api/checklists", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistId: id, status }),
      });
      loadChecklists();
    } catch {
      openChecklistById(id);
    }
  };
  const deleteChecklist = async (id: string) => {
    if (!window.confirm("Delete this checklist? Everything ticked off on it goes too.")) return;
    setOpenChecklist(null);
    setChecklists((cs) => cs.filter((c) => c.id !== id));
    try {
      await apiFetch(`/api/checklists?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      loadChecklists();
    }
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

  // Crew filter applied once, here — the grid, agenda and day modal all read
  // from these, so filtering stays consistent across every view.
  const fEvents = useMemo(
    () => (crewFilter ? events.filter((e) => e.assigneeId === crewFilter) : events),
    [events, crewFilter]
  );
  const fTasks = useMemo(
    () => (crewFilter ? tasks.filter((t) => t.assigneeId === crewFilter) : tasks),
    [tasks, crewFilter]
  );
  // Checks indexed by the event they hang off, so the day sheet can show at a
  // glance which inspections are already prepped.
  const checksByEvent = useMemo(() => {
    const m = new Map<string, ChecklistHead[]>();
    for (const c of checklists) {
      if (!c.eventId) continue;
      const list = m.get(c.eventId) ?? [];
      list.push(c);
      m.set(c.eventId, list);
    }
    return m;
  }, [checklists]);

  // Group events by Auckland day-key, time-sorted within each day.
  // A multi-day event lands on EVERY day it spans, not just its start day — we
  // already store end_date, we just weren't drawing it.
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const e of fEvents) {
      const startK = dayKey(new Date(e.startsAt));
      const endK = e.endsAt ? dayKey(new Date(e.endsAt)) : startK;
      let k = startK;
      for (let n = 0; n < 366; n++) {
        const list = map.get(k) ?? [];
        list.push(e);
        map.set(k, list);
        if (k >= endK) break;
        k = nextDayKey(k);
      }
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
    return map;
  }, [fEvents]);

  // Tasks with a due date, grouped by day-key.
  const tasksByDay = useMemo(() => {
    const map = new Map<string, CalTask[]>();
    for (const t of fTasks) {
      if (!t.dueAt) continue;
      const k = dayKey(new Date(t.dueAt));
      const list = map.get(k) ?? [];
      list.push(t);
      map.set(k, list);
    }
    return map;
  }, [fTasks]);

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
    for (const e of fEvents) {
      const k = dayKey(new Date(e.startsAt));
      if (k < tk0) continue;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t: new Date(e.startsAt).getTime(), ev: e });
    }
    for (const tk of fTasks) {
      if (!tk.dueAt) continue;
      const k = dayKey(new Date(tk.dueAt));
      if (k < tk0) continue;
      (byDay.get(k) ?? byDay.set(k, []).get(k)!).push({ t: new Date(tk.dueAt).getTime(), tk });
    }
    return [...byDay.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, items]) => ({ k, items: items.sort((a, b) => a.t - b.t) }));
  }, [fEvents, fTasks]);

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
        company={setupCompany}
        setCompany={setSetupCompany}
        showCompany={projects.length === 0}
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
        placeholder="Ask about your plans, the Building Code, H&S or RFIs…"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={onFilePick} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={onFilePick} />
      {attachErr && <div className="cerr">{attachErr}</div>}
      <div className="crow">
        <span className="hint">
          {isRecording ? "Listening… speak now"
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
          {/* Desktop shows the initials; on a phone the round gradient circle
              was the widest thing in the header and pushed the whole page off
              the screen, so it collapses to a plain ☰ — which also reads as
              "menu", which is what it actually is. */}
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">
            <span className="av-ini">{initials}</span>
            <svg className="av-bars" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          {menuOpen && (
            <div className="menu">
              <div className="mrow"><span className="mi">🏗️</span><div><b>{projName}</b><br /><small>{curProject?.role === "admin" ? "You're the admin" : (members.find((m) => m.isMe)?.title || "Crew member")}</small></div></div>
              {/* Past chats lives here now. It used to be a button floating
                  over the top-left of the assistant screen, which sat on top
                  of the Today card and covered its heading. */}
              <div className="mrow" onClick={() => { setMenuOpen(false); setTab("assistant"); setRailOpen(true); loadThreads(); }}><span className="mi">💬</span> Past chats</div>
              <div className="mrow" onClick={() => { setCrewOpen(true); setMenuOpen(false); loadMembers(); }}><span className="mi">👥</span> Crew &amp; invite code</div>
              <div className="mrow" onClick={() => { setMenuOpen(false); window.open("/install", "_blank"); }}><span className="mi">📱</span> Put it on a phone</div>
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
          <div className="assistant">
            {messages.length === 0 ? (
              <div className="hero-full home">
                {/* What's on today comes FIRST — it's the thing you open the
                    app to see. The greeting sits at the bottom, next to the
                    box you're about to type in, and gets pushed down further
                    the more you have on. */}
                <div className="home-scroll">
                  <TodayGlance
                    events={eventsByDay.get(todayKey()) ?? []}
                    tasks={(tasksByDay.get(todayKey()) ?? []).filter((t) => !t.done)}
                    loaded={evLoaded && taskLoaded}
                    colorFor={colorFor}
                    onToggle={toggleTask}
                    onOpen={() => setTab("calendar")}
                  />
                  {/* A gap either side centres the greeting in whatever space
                      the day leaves. Both collapse to their minimum on a busy
                      day, so a long list pushes the greeting down rather than
                      squashing it. */}
                  <div className="home-gap" />
                  {/* Logo, greeting and the box you type in are one block, so
                      they stay together: centred on a quiet day, pushed down
                      by a busy one. */}
                  <div className="home-ask">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="hero-logo home-logo" src="/logo-mark.png" alt="Soterra" />
                    <h1 className="home-greet">Hi <b className="grad">{firstName}</b>, how can I help?</h1>
                    <div className="hero-composer">{cbox}</div>
                  </div>
                  <div className="home-gap" />
                </div>
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
                              {m.cites && m.cites.length > 1 && (
                                <div className="cites-h">{m.cites.length} sources — tap any to open</div>
                              )}
                              {m.cites?.map((c, k) => (
                                <div className="cite" key={k} onClick={() => setSheet(c)}>
                                  <div className="cic">{c.kind === "manufacturer" ? "📕" : c.kind === "determination" ? "⚖️" : "📐"}</div>
                                  <div className="ct"><b>{c.code}{c.title ? ` · ${c.title}` : ""}</b><small>{c.sub}</small></div>
                                  <div className="ca">›</div>
                                </div>
                              ))}
                              {m.cards?.map((c, j) =>
                                c.itemType === "standard" && c.std ? (
                                  // The handoff card. Deliberately looks like a
                                  // deliberate stop, not a failure: the answer
                                  // continues, it just continues in a document
                                  // we can point at but are not licensed to
                                  // reproduce.
                                  <div className="stdcard" key={j}>
                                    <div className="stdh">
                                      <span className="stdtag">In the standard</span>
                                      <b>{c.std.ref}</b>
                                      <small>{c.std.title}</small>
                                    </div>
                                    <div className="stdbody">
                                      <div className="stdholds">
                                        {c.std.section ? <span className="stdsec">{c.std.section}</span> : null}
                                        {c.std.holds}
                                      </div>
                                      {c.std.demo ? (
                                        // Personal-use evaluation: your own licensed copy, this
                                        // account only. Tap to read the real table.
                                        <div className="stdpages">
                                          <div className="stdpages-h">Your licensed copy</div>
                                          {c.std.demo.pages.map((pg) => (
                                            <button
                                              key={pg.page}
                                              className="stdpage"
                                              onClick={() => setSheet({
                                                code: c.std!.ref, title: pg.label, sub: c.std!.title, ans: "", hlTag: c.std!.ref,
                                                kind: "standard", stdSlug: c.std!.demo!.slug, page: pg.page, url: c.std!.url,
                                              })}
                                            >
                                              <span className="stdpage-ic">▤</span>
                                              <span>{pg.label}</span>
                                              <span className="stdpage-go">›</span>
                                            </button>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="stdredact" aria-label="Content withheld pending licence">
                                          <span>content withheld pending licence</span>
                                        </div>
                                      )}
                                    </div>
                                    <a className="stdget" href={c.std.url} target="_blank" rel="noopener noreferrer">
                                      Free to download from Standards NZ ↗
                                    </a>
                                  </div>
                                ) : c.itemType === "checklist" ? (
                                  <div className="evcard ckcard" key={j} onClick={() => openChecklistById(c.id)} role="button" tabIndex={0} title="Tap to open the checklist">
                                    <div className="bar" style={{ background: "var(--brand)" }} />
                                    <div className="et">
                                      <b>{c.title}</b>
                                      <small>{c.when}{c.sub ? ` · ${c.sub}` : ""} · tap to open</small>
                                    </div>
                                    <div className="ec">📋</div>
                                  </div>
                                ) : (
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
                                )
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
          </div>
        )}

        {/* ─── CALENDAR ─── */}
        {tab === "calendar" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Calendar</div>
            <div className="page-sub">{projName}</div>
            {members.length > 1 && (
              <div className="crewchips">
                <button
                  className={"crewchip" + (crewFilter === null ? " on" : "")}
                  onClick={() => setCrewFilter(null)}
                >
                  Everyone
                </button>
                {members.map((m) => (
                  <button
                    key={m.userId}
                    className={"crewchip" + (crewFilter === m.userId ? " on" : "")}
                    onClick={() => setCrewFilter(crewFilter === m.userId ? null : m.userId)}
                    title={m.title || undefined}
                  >
                    <i style={{ background: crewColor(m.colorIndex) }} />
                    {m.name}{m.isMe ? " (you)" : ""}
                  </button>
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
                <div className="page-sub" style={{ marginBottom: 0 }}>{projName}</div>
              </div>
              <button className="cal-new" onClick={() => openTaskForm()}>＋ New task</button>
            </div>
            <div style={{ height: 18 }} />
            {!taskLoaded ? (
              <div className="page-sub">Loading…</div>
            ) : tasks.length === 0 ? (
              <div className="page-sub">No tasks yet. Add your first one, or just ask the assistant.</div>
            ) : (
              tasks.map((t) => <TaskRow key={t.id} t={t} onToggle={toggleTask} full onDelete={deleteTask} />)
            )}
          </div></div>
        )}

        {/* ─── PLANS ─── */}
        {tab === "plans" && (
          isDemo ? (
            <div className="page"><div className="page-inner">
              <div className="page-h">Plans &amp; specs</div>
              <div className="page-sub">{projName}</div>
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
              <div className="page-sub">{projName}</div>
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
                  <div style={{ marginTop: 14 }}>
                    <DocsList docs={docs} onDelete={deletePlan} />
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
              onChange={(e) => { const fs = filesFrom(e.target); if (planFileRef.current) planFileRef.current.value = ""; if (fs.length) onPlanFiles(fs); }} />
            {/* Folder picker: returns the whole tree (subfolders included). No `accept`
                here — webkitdirectory ignores it, so onPlanFiles filters to PDFs. */}
            <input ref={planFolderRef} type="file" multiple style={{ display: "none" }}
              onChange={(e) => { const fs = filesFrom(e.target); if (planFolderRef.current) planFolderRef.current.value = ""; if (fs.length) onPlanFiles(fs); }} />
            <div
              className="drop"
              onClick={() => { if (!upCurrent) planFileRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); if (!upCurrent) setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false); if (upCurrent) return;
                void filesFromDrop(e.dataTransfer).then((fs) => { if (fs.length) onPlanFiles(fs); });
              }}
              style={{ cursor: upCurrent ? "default" : "pointer", outline: dragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
            >
              <div className="ic">⬆️</div>
              <b>{upCurrent ? `${upCurrent.phase}…` : hasPlans ? "Add or update a sheet" : "Upload your full plan set"}</b>
              <p>{upCurrent ? upCurrent.name : hasPlans ? "Drop a revised or new sheet (PDF). It becomes the current version — the assistant uses the latest and treats the old as superseded. Keep the whole-set load to site setup." : "Drop your whole project folder here — subfolders and all (Architectural, Civil, Structural…). Soterra finds every PDF inside and skips the rest. Up to 100 MB per file."}</p>
              {upCurrent && (
                <div style={{ width: "80%", maxWidth: 360, height: 6, borderRadius: 99, background: "rgba(148,166,190,.25)", overflow: "hidden", marginTop: 6 }}>
                  <div style={{ width: `${upCurrent.phase === "Uploading" ? (upCurrent.pct || 4) : 100}%`, height: "100%", background: "var(--brand)", transition: "width .2s" }} />
                </div>
              )}
              {!upCurrent && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                  <span className="soon" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); planFolderRef.current?.click(); }}>📁 Choose folder</span>
                  <span className="soon" style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); planFileRef.current?.click(); }}>Choose files</span>
                </div>
              )}
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
              <div className="page-sub">{isDemo ? "This demo site already has 43 Kauri Road's plans loaded — try the assistant." : "Nothing indexed yet. Upload your plans above."}</div>
            ) : (
              <DocsList docs={docs} onDelete={deletePlan} />
            )}
          </div></div>
        )}

        {tab === "insights" && (
          <div className="page"><div className="page-inner">
            <div className="cal-top">
              <div>
                <div className="page-h">Insights</div>
                <div className="page-sub" style={{ marginBottom: 0 }}>
                  {insights?.company.name ? `${insights.company.name} · ` : ""}
                  what you keep getting pulled up on, across {insights?.company.sites === 1 ? "your site" : `all ${insights?.company.sites ?? ""} sites`}
                </div>
              </div>
              <button className="cal-new" onClick={() => { setNewCl({ eventId: null, eventTitle: null }); setNewClKind("inspection"); setNewClCode(""); setClErr(null); }}>＋ New check</button>
            </div>

            <input ref={reportFileRef} type="file" accept="application/pdf" multiple style={{ display: "none" }}
              onChange={(e) => { const fs = filesFrom(e.target); if (reportFileRef.current) reportFileRef.current.value = ""; if (fs.length) onReportFiles(fs); }} />

            {/* Pre-inspection checks — ALWAYS shown once the tab has loaded, even on a
                site with no inspection reports yet. This block used to live inside the
                "has reports" branch below, so a generated or completed check was
                invisible on a fresh site until a report was uploaded. */}
            {insightsLoaded && (
              <div style={{ marginTop: 18 }}>
                <IzToggle label="Pre-inspection checks" count={checklists.length} open={!izClosed.checks} onClick={() => izToggle("checks")} />
                {!izClosed.checks && (checklists.length === 0 ? (
                  <div className="page-sub">
                    None yet on {projName}. A check is built from this site&apos;s drawings, the Building Code and your own history — tick it off on your phone before the inspector turns up.
                  </div>
                ) : (
                  checklists.map((c) => <ChecklistRow key={c.id} c={c} onOpen={() => openChecklistById(c.id)} />)
                ))}
              </div>
            )}

            {!insightsLoaded ? (
              <div className="page-sub" style={{ marginTop: 18 }}>Loading…</div>
            ) : (insights?.summary.inspections ?? 0) === 0 ? (
              <div
                className="drop"
                style={{ marginTop: 18, cursor: repCurrent ? "default" : "pointer", outline: repDragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
                onClick={() => { if (!repCurrent) reportFileRef.current?.click(); }}
                {...reportDropProps}
              >
                <div className="ic">📋</div>
                <b>{repCurrent ? `${repCurrent.phase}…` : "Add your inspection reports"}</b>
                <p>
                  {repCurrent
                    ? repCurrent.name
                    : "Drop in the council and consultant reports you've already had — Soterra reads each one, keeps only what failed, and tags it. After a handful you can see what your crew actually gets pulled up on, and the assistant can build a check from it."}
                </p>
                {repCurrent ? (
                  <div className="upbar"><div className="upbar-fill" style={{ width: `${Math.max(repCurrent.pct, 4)}%` }} /></div>
                ) : (
                  <span className="soon">Choose reports</span>
                )}
              </div>
            ) : (
              <>
                {/* Headline counts — what fails and how much. No grading, no
                    reinspections, no fix-tracking: this page just learns what
                    keeps getting pulled up. The whole block folds under one toggle. */}
                <IzToggle label="What keeps failing" open={!izClosed.fails} onClick={() => izToggle("fails")} />
                {!izClosed.fails && (
                <>
                <div className="iz-kpis" style={{ marginTop: 4 }}>
                  <div className="iz-kpi hero">
                    <div className="iz-lab">Items flagged</div>
                    <div className="iz-val">{insights!.summary.failedItems}</div>
                    <div className="iz-sub">things picked up in your reports</div>
                  </div>
                  <div className="iz-kpi">
                    <div className="iz-lab">Reports read</div>
                    <div className="iz-val">{insights!.summary.inspections}</div>
                    <div className="iz-sub">council + consultant inspections</div>
                  </div>
                  <div className="iz-kpi">
                    <div className="iz-lab">Worst trade</div>
                    {insights!.categories[0] ? (
                      <>
                        <div className="iz-trade"><span className="rank-dot" style={{ width: 12, height: 12, background: catColor(insights!.categories[0].category) }} /><span className="iz-val">{insights!.categories[0].category}</span></div>
                        <div className="iz-sub">{insights!.categories[0].count} item{insights!.categories[0].count === 1 ? "" : "s"}, most of any trade</div>
                      </>
                    ) : (
                      <div className="iz-val">—</div>
                    )}
                  </div>
                </div>
                <div className="iz-note"><b>●</b> Every item below came off one of your own reports.</div>

                {insights!.categories.length === 0 ? (
                  <div className="cal-card"><div className="page-sub" style={{ marginBottom: 0 }}>Nothing failed yet across your filed reports. Enjoy it.</div></div>
                ) : (() => {
                  const selCat = insights!.selectedCategory ?? insights!.categories[0].category;
                  const selCount = insights!.categories.find((c) => c.category === selCat)?.count ?? 0;
                  const items = insights!.topItems;
                  const maxN = Math.max(1, ...items.map((i) => i.count));
                  const shown = items.reduce((s, i) => s + i.count, 0);
                  const more = Math.max(0, selCount - shown);
                  const maxCat = insights!.categories[0]?.count || 1;
                  return (
                    <div className="iz-split">
                      <div className="iz-card">
                        <div className="iz-cardh">
                          <div className="iz-cardt">By trade</div>
                          <div className="iz-cards">Across every report. Tap one to open it.</div>
                        </div>
                        <div className="iz-bars">
                          {insights!.categories.map((c) => {
                            const on = c.category === selCat;
                            return (
                              <button key={c.category} className={"iz-bar" + (on ? " on" : "")} onClick={() => { setCatFilter(c.category); loadInsights(c.category); }} title={`Show ${c.category}`}>
                                <span className="iz-bl"><span className="rank-dot" style={{ background: catColor(c.category) }} /><span>{c.category}</span></span>
                                <span className="iz-bt"><span className="iz-bf" style={{ width: `${Math.round((c.count / maxCat) * 100)}%`, background: catColor(c.category) }} /></span>
                                <span className="iz-bn">{c.count}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="iz-cardf">{insights!.summary.failedItems} items · {insights!.summary.inspections} reports</div>
                      </div>

                      <div className="iz-card">
                        <div className="iz-ddh">
                          <div className="iz-sw" style={{ background: catColor(selCat) }} />
                          <div>
                            <div className="iz-ddn">{selCat}</div>
                            <div className="iz-ddm">{selCount} item{selCount === 1 ? "" : "s"} across your reports · most repeated at the top</div>
                          </div>
                        </div>
                        {items.length === 0 ? (
                          <div className="page-sub" style={{ padding: "16px 20px", marginBottom: 0 }}>Nothing to show here yet.</div>
                        ) : (
                          <div className="iz-list">
                            {items.map((t, i) => (
                              <div className="iz-item" key={i}>
                                <div className="iz-im">
                                  <div className="iz-it">{t.title}</div>
                                  <div className="iz-itk"><div className="iz-itf" style={{ width: `${Math.round((t.count / maxN) * 100)}%`, background: catColor(selCat) }} /></div>
                                </div>
                                <div className="iz-ic">{t.count}<small>×</small></div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="iz-ddf"><span className="more">{more > 0 ? `+ ${more} more ${selCat} item${more === 1 ? "" : "s"}` : "All items shown"}</span><span>the number is how many times it came up</span></div>
                      </div>
                    </div>
                  );
                })()}
                </>
                )}

                <IzToggle label="Past inspections" count={insights!.inspections.length} open={!izClosed.past} onClick={() => izToggle("past")} />
                {/* Grouped the way they arrive: the council's statutory checks,
                    then each consultant discipline under its own heading. */}
                {!izClosed.past && groupInspections(insights!.inspections).map((g) => (
                  <div key={g.key}>
                    <div className="sub-k">{g.label}<span>{g.rows.length}</span></div>
                    {g.rows.map((r) => (
                  <div className="doc" key={r.id} onClick={async () => {
                    const res = await apiFetch(`/api/inspections?id=${encodeURIComponent(r.id)}`);
                    const data = await res.json();
                    if (res.ok) setOpenInspection({ inspection: r, items: data.items || [] });
                  }}>
                    <div className="ic spc" style={{ background: r.outcome === "pass" ? "var(--green)" : r.outcome === "fail" ? "var(--red)" : undefined }}>
                      {r.inspectionCode || (r.source === "council" ? "BCA" : "CON")}
                    </div>
                    <div className="dt">
                      <b>{r.inspectionType || r.doc}</b>
                      <small>{[r.inspectedOn, r.projectName, `${r.itemCount} item${r.itemCount === 1 ? "" : "s"} to fix`].filter(Boolean).join(" · ")}</small>
                    </div>
                    <span className={"pill " + (OUTCOME_PILL[r.outcome] ?? "na")}>{OUTCOME_LABEL[r.outcome] ?? "—"}</span>
                    <div className="arr">›</div>
                  </div>
                    ))}
                  </div>
                ))}

                <IzToggle label="Add more reports" open={!izClosed.addmore} onClick={() => izToggle("addmore")} />
                {!izClosed.addmore && (
                <div
                  className="drop"
                  style={{ padding: "26px 20px", cursor: repCurrent ? "default" : "pointer", outline: repDragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
                  onClick={() => { if (!repCurrent) reportFileRef.current?.click(); }}
                  {...reportDropProps}
                >
                  <b>{repCurrent ? `${repCurrent.phase}…` : "Drop in another inspection report"}</b>
                  <p>{repCurrent ? repCurrent.name : "Council checklists or a consultant's site observation report — PDF with real text, not a scan."}</p>
                  {repCurrent && <div className="upbar"><div className="upbar-fill" style={{ width: `${Math.max(repCurrent.pct, 4)}%` }} /></div>}
                </div>
                )}
              </>
            )}

            {repItems.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {repItems.map((it, i) => (
                  <div key={i} className={"up-row" + (it.ok ? " done" : " error")} style={{ marginBottom: 8 }}>
                    <span>{it.ok ? "✅" : "⚠️"}</span>
                    <b style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</b>
                    <small style={{ marginLeft: "auto", flex: "0 0 auto", color: it.ok ? "var(--green)" : "var(--red)" }}>{it.note}</small>
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
            {(() => {
              // The rendered page image URL for whichever kind this is, or null
              // when there's nothing to render (a Code citation, or missing bits).
              const docSrc =
                sheet.kind === "manufacturer"
                  ? sheet.mfr && sheet.doc && sheet.page
                    ? // &v busts the browser cache. doc-page images are served
                      // `immutable` for a year, so when the render itself changes
                      // (e.g. Resene's pages went from a blank live render to a
                      // stored pre-render), the same URL would keep showing the
                      // old frozen image. Bump this number after any such change.
                      `/api/doc-page?m=${encodeURIComponent(sheet.mfr)}&doc=${encodeURIComponent(sheet.doc)}&p=${sheet.page}&v=2`
                    : null
                  : sheet.kind === "determination"
                    ? sheet.ref && sheet.page
                      ? `/api/determination-page?ref=${encodeURIComponent(sheet.ref)}&p=${sheet.page}`
                      : null
                    : sheet.kind === "standard"
                      ? sheet.stdSlug && sheet.page
                        ? `/api/standard-page?ref=${encodeURIComponent(sheet.stdSlug)}&p=${sheet.page}`
                        : null
                      : projectId && sheet.doc && sheet.page
                        ? `/api/plan-page?project=${encodeURIComponent(projectId)}&doc=${encodeURIComponent(sheet.doc)}&p=${sheet.page}`
                        : null;
              const isMfr = sheet.kind === "manufacturer" || sheet.kind === "determination" || sheet.kind === "standard";
              return (
                <>
                  <div className="sh-canvas">
                    {docSrc && docImg !== "error" && (
                      <img
                        className="sh-doc"
                        style={{ opacity: docImg === "ok" ? 1 : 0 }}
                        src={docSrc}
                        alt={`${sheet.doc} page ${sheet.page}`}
                        onLoad={() => setDocImg("ok")}
                        onError={() => setDocImg("error")}
                      />
                    )}
                    {/* Expand to full screen — same image, bigger. Free. */}
                    {docSrc && docImg === "ok" && (
                      <button className="sh-expand" title="View full screen" onClick={() => setZoomImg(docSrc)}>⛶</button>
                    )}
                    {docSrc && docImg === "loading" && (
                      <div className="sh-msg">Loading the {isMfr ? "page" : "sheet"}{isMfr ? ` from ${sheet.mfr}` : ""}…</div>
                    )}
                    {docSrc && docImg === "error" && (
                      <div className="sh-msg">
                        Couldn&apos;t load the {isMfr ? "page" : "sheet"} preview.
                        {isMfr && sheet.url && <><br /><a href={sheet.url} target="_blank" rel="noopener noreferrer">Open the full manual ↗</a></>}
                      </div>
                    )}
                    {!docSrc && (
                      <div className="sheetpaper">
                        <div className="frame" /><div className="hl" /><div className="hltag">{sheet.hlTag}</div>
                        <div className="tb"><b>{sheet.code}</b><span>{sheet.title}</span><br /><span style={{ color: "#9AA7B4" }}>{projName}</span></div>
                      </div>
                    )}
                  </div>
                  <div className="sh-ans">
                    <div className="src">{isMfr ? `📕 FROM ${(sheet.mfr || "THE MANUFACTURER").toUpperCase()}’S MANUAL` : "📐 ANSWER FROM THIS SHEET"}</div>
                    <p dangerouslySetInnerHTML={{ __html: sheet.ans }} />
                    {isMfr && sheet.url && (
                      <a className="sh-open" href={sheet.url} target="_blank" rel="noopener noreferrer">
                        Open the full manual on {hostOf(sheet.url)} ↗
                      </a>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ─── full-screen, zoomable page image ─── */}
      {zoomImg && (
        <div className="zoomscrim" onClick={() => { setZoomImg(null); setZoomScale(1); }}>
          {/* Tap the image to zoom in a step (cycles back to fit after max); when
              zoomed the scrim scrolls so you can pan around the fine print. */}
          <img
            className="zoomimg"
            src={zoomImg}
            alt="Full page"
            style={zoomScale === 1
              ? { maxWidth: "100%", maxHeight: "calc(100vh - 96px)", cursor: "zoom-in" }
              : { width: `${zoomScale * 100}%`, maxWidth: "none", maxHeight: "none", cursor: "zoom-out" }}
            onClick={(e) => { e.stopPropagation(); setZoomScale((s) => (s >= 3 ? 1 : s + 1)); }}
          />
          <div className="zoomctl" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Zoom out" onClick={() => setZoomScale((s) => Math.max(1, s - 1))}>−</button>
            <span>{Math.round(zoomScale * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => setZoomScale((s) => Math.min(4, s + 1))}>+</button>
          </div>
          <button className="zoomx" onClick={() => { setZoomImg(null); setZoomScale(1); }}>✕</button>
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
              {(eventsByDay.get(openDay) ?? []).map((e) => (
                <EventRow
                  key={e.id}
                  e={e}
                  colorFor={colorFor}
                  onDelete={deleteEvent}
                  checks={checksByEvent.get(e.id) ?? []}
                  onOpenCheck={(id) => { setOpenDay(null); openChecklistById(id); }}
                  onNewCheck={(ev) => {
                    setOpenDay(null);
                    setNewCl({ eventId: ev.id, eventTitle: ev.title });
                    setNewClKind("inspection");
                    setNewClCode(""); setClErr(null);
                  }}
                />
              ))}
              {(tasksByDay.get(openDay) ?? []).map((t) => <TaskRow key={t.id} t={t} onToggle={toggleTask} onDelete={deleteTask} />)}
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

      {/* ─── new pre-inspection check ─── */}
      {newCl && (
        <div className="scrim" onClick={() => { if (!clBusy) { setNewCl(null); setClErr(null); } }}>
          <div className="sheet" style={{ maxWidth: 480, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New check</b><small>{newCl.eventTitle || projName}</small></div>
              {!clBusy && <button className="sh-x" onClick={() => { setNewCl(null); setClErr(null); }}>✕</button>}
            </div>
            <div className="form-body">
              <label className="ev-lbl">What&apos;s it for</label>
              <div className="ev-kinds">
                <button type="button" className={"ev-kind" + (newClKind === "inspection" ? " act" : "")} onClick={() => setNewClKind("inspection")}>An inspection</button>
                <button type="button" className={"ev-kind" + (newClKind === "ccc" ? " act" : "")} onClick={() => setNewClKind("ccc")}>CCC evidence</button>
              </div>

              {newClKind === "inspection" ? (
                <>
                  <label className="ev-lbl">Which inspection</label>
                  <select className="ev-in" value={newClCode} onChange={(e) => setNewClCode(e.target.value)}>
                    <option value="">Pick the inspection type…</option>
                    <optgroup label="Council (BCA)">
                      {clTypes.council.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                    </optgroup>
                    <optgroup label="Consultant">
                      {clTypes.consultant.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                    </optgroup>
                  </select>
                  <p className="page-sub" style={{ margin: "12px 0 0" }}>
                    Soterra writes the check from three places: this site&apos;s drawings, the Building Code, and what your company has already been failed on. Every item says where it came from, and anything it can&apos;t back up gets left out.
                  </p>
                </>
              ) : (
                <p className="page-sub" style={{ margin: "12px 0 0" }}>
                  The evidence a council wants before it&apos;ll issue the Code Compliance Certificate — energy work certificates, producer statements, LBP records of work, as-builts, truss documentation, cladding and waterproofing certificates. Start it early; the PS4 is usually the long pole.
                </p>
              )}

              {clErr && <div className="ev-err">{clErr}</div>}

              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={clBusy || (newClKind === "inspection" && !newClCode)} onClick={createChecklist}>
                  {clBusy ? "Reading your plans…" : "Build the check"}
                </button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={clBusy} onClick={() => { setNewCl(null); setClErr(null); }}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── the check itself: ticked off on site ─── */}
      {openChecklist && (
        <div className="scrim" onClick={() => setOpenChecklist(null)}>
          <div className="sheet" style={{ maxWidth: 560, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>{openChecklist.checklist.title}</b>
                <small>{openChecklist.checklist.status === "done" ? "✓ Marked done · saved under Insights › Checks · " : ""}{openChecklist.items.filter((i) => i.status !== "pending").length} of {openChecklist.items.length} done{openChecklist.items.some((i) => i.status === "issue") ? ` · ${openChecklist.items.filter((i) => i.status === "issue").length} to fix` : ""}</small>
              </div>
              <button className="sh-x" onClick={() => setOpenChecklist(null)}>✕</button>
            </div>
            <div className="dm-body">
              {clErr && <div className="ev-err" style={{ marginBottom: 12 }}>{clErr}</div>}
              {openChecklist.items.map((it) => (
                <div className={"ck" + (it.status !== "pending" ? " ck-" + it.status : "")} key={it.id}>
                  <div className="ck-head">
                    <div className="ck-txt">
                      <b>{it.title}</b>
                      {it.detail && <small>{it.detail}</small>}
                      <div className="ck-meta">
                        <span className={"src src-" + it.source}>{SRC_LABEL[it.source] ?? it.source}</span>
                        {it.sourceRef && <span className="src-ref" title={it.sourceRef}>{it.sourceRef}</span>}
                      </div>
                    </div>
                    {it.category && <span className="cat-dot" style={{ background: catColor(it.category) }} title={it.category} />}
                  </div>

                  <div className="ev-kinds ck-actions">
                    <button type="button" className={"ev-kind" + (it.status === "ok" ? " act" : "")} onClick={() => setItemStatus(it.id, it.status === "ok" ? "pending" : "ok")}>✓ Good</button>
                    <button type="button" className={"ev-kind" + (it.status === "issue" ? " act" : "")} onClick={() => setItemStatus(it.id, it.status === "issue" ? "pending" : "issue")}>Needs fixing</button>
                    <button type="button" className={"ev-kind" + (it.status === "na" ? " act" : "")} onClick={() => setItemStatus(it.id, it.status === "na" ? "pending" : "na")}>N/A</button>
                  </div>

                  {(it.photos.length > 0 || it.note || noteFor === it.id) && (
                    <div className="ck-extra">
                      {it.note && noteFor !== it.id && <div className="ck-note" onClick={() => { setNoteFor(it.id); setNoteText(it.note || ""); }}>{it.note}</div>}
                      {noteFor === it.id && (
                        <div>
                          <textarea className="ev-in" rows={2} autoFocus value={noteText} placeholder="What did you find?" onChange={(e) => setNoteText(e.target.value)} />
                          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                            <button className="lg-btn primary" style={{ height: 36, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} onClick={() => saveNote(it.id)}>Save note</button>
                            <button className="lg-btn" style={{ height: 36, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} onClick={() => { setNoteFor(null); setNoteText(""); }}>Cancel</button>
                          </div>
                        </div>
                      )}
                      {it.photos.length > 0 && (
                        <div className="shots">
                          {it.photos.map((p) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={p.id} className="shot" alt="Site photo" src={`/api/checklists/photo?path=${encodeURIComponent(p.url)}`} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="ck-tools">
                    <button onClick={() => { photoForRef.current = it.id; photoInputRef.current?.click(); }}>📷 Photo</button>
                    {noteFor !== it.id && <button onClick={() => { setNoteFor(it.id); setNoteText(it.note || ""); }}>{it.note ? "Edit note" : "＋ Note"}</button>}
                    {it.checkedByName && <span className="ck-by">{it.checkedByName}</span>}
                  </div>
                </div>
              ))}
              {openChecklist.items.length === 0 && <div className="page-sub" style={{ marginBottom: 0 }}>This check has no items.</div>}
            </div>
            <div className="dm-foot">
              {openChecklist.checklist.status === "done" ? (
                <>
                  {/* Already saved. "Done" just closes the sheet back to the calendar;
                      "Reopen" is there if they need to keep working on it. */}
                  <button className="lg-btn primary" style={{ height: 44, margin: 0, flex: 1 }} onClick={() => setOpenChecklist(null)}>Done</button>
                  <button className="lg-btn" style={{ height: 44, margin: 0, width: "auto", padding: "0 16px" }} onClick={() => closeOutChecklist("open")}>Reopen</button>
                </>
              ) : (
                // Mark done but STAY open, so the footer visibly flips to Done + Reopen —
                // confirmation the save happened. "Done" then closes it. (Closing on the
                // same tap read as "nothing happened".)
                <button className="lg-btn primary" style={{ height: 44, margin: 0, flex: 1 }} onClick={() => closeOutChecklist("done")}>Mark this check done</button>
              )}
              <button className="lg-btn" style={{ height: 44, margin: 0, width: "auto", padding: "0 18px" }} onClick={() => deleteChecklist(openChecklist.checklist.id)}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Camera/gallery picker for checklist photos — one input, reused. */}
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }}
        onChange={(e) => { const f = filesFrom(e.target)[0]; if (photoInputRef.current) photoInputRef.current.value = ""; if (f) onPhotoPicked(f); }} />

      {/* ─── one past inspection, and what it picked up ─── */}
      {openInspection && (
        <div className="scrim" onClick={() => setOpenInspection(null)}>
          <div className="sheet" style={{ maxWidth: 560, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>{openInspection.inspection.inspectionType || openInspection.inspection.doc}</b>
                <small>{[openInspection.inspection.inspectedOn, openInspection.inspection.projectName, OUTCOME_LABEL[openInspection.inspection.outcome]].filter(Boolean).join(" · ")}</small>
              </div>
              <button className="sh-x" onClick={() => setOpenInspection(null)}>✕</button>
            </div>
            <div className="dm-body">
              {openInspection.items.length === 0 ? (
                <div className="page-sub" style={{ marginBottom: 0 }}>Nothing was picked up on this one.</div>
              ) : (
                openInspection.items.map((it) => (
                  <div className="ins-row" key={it.id}>
                    <span className="cat-dot" style={{ background: catColor(it.category) }} />
                    <div className="ins-body">
                      <b>{it.title}</b>
                      <small>{[it.category, it.location].filter(Boolean).join(" · ")}</small>
                      {it.detail && <small className="ins-detail">{it.detail}</small>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── a saved pre-inspection check, in a list ── */
function ChecklistRow({ c, onOpen }: { c: ChecklistHead; onOpen: () => void }) {
  const total = c.total ?? 0;
  const done = c.done ?? 0;
  const issues = c.issues ?? 0;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="ev" onClick={onOpen} style={{ cursor: "pointer" }}>
      <div className="bar" style={{ background: issues ? "var(--amber)" : c.status === "done" ? "var(--green)" : "var(--brand)" }} />
      <div className="body">
        <b>{c.title}</b>
        <small>{total ? `${done} of ${total} checked` : "no items"}{issues ? ` · ${issues} to fix` : ""}{c.createdByName ? ` · ${c.createdByName}` : ""}</small>
        <span className="rank-track" style={{ display: "block", marginTop: 8, flex: "none", width: "100%" }}>
          <span className="rank-fill" style={{ width: `${pct}%`, background: issues ? "var(--amber)" : "var(--brand)" }} />
        </span>
      </div>
      <span className={"pill " + (c.status === "done" ? "pass" : issues ? "open" : "na")}>{c.status === "done" ? "Done" : issues ? `${issues} to fix` : `${pct}%`}</span>
    </div>
  );
}

/* ── site create / join screen (first-run mandatory, or switcher overlay) ── */
function SiteSetup(props: {
  mandatory: boolean;
  mode: "create" | "join";
  setMode: (m: "create" | "join") => void;
  name: string; setName: (v: string) => void;
  company: string; setCompany: (v: string) => void;
  /** Only the first site names the company — later ones inherit it. */
  showCompany: boolean;
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
                  {p.showCompany && (
                    <>
                      <label className="ev-lbl">Your company</label>
                      <input className="ev-in" value={p.company} autoFocus onChange={(e) => p.setCompany(e.target.value)} placeholder="e.g. Kalmar Construction"
                        onKeyDown={(e) => { if (e.key === "Enter") p.onCreate(); }} />
                    </>
                  )}
                  <label className="ev-lbl">Site name</label>
                  <input className="ev-in" value={p.name} autoFocus={!p.showCompany} onChange={(e) => p.setName(e.target.value)} placeholder="e.g. 12 Beach Road — Townhouses"
                    onKeyDown={(e) => { if (e.key === "Enter") p.onCreate(); }} />
                  {who(p.onCreate, "e.g. Project Manager")}
                  <p className="page-sub" style={{ margin: "10px 0 0" }}>
                    {p.showCompany
                      ? "You'll be the site admin and get an invite code to bring your crew on. Every site you add later sits under this company, so its inspection history builds up in one place."
                      : "You'll be the site admin and get an invite code to bring your crew on."}
                  </p>
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
// Copy a file input's selection into a plain array BEFORE anything resets the
// input. `input.files` is a LIVE FileList: setting `input.value = ""` (which
// every one of these handlers does, so picking the same file twice still
// fires onChange) empties the reference you already captured. The old code
// read `const fs = e.target.files` and then reset — by the time it checked
// `fs.length` it was 0, so choosing a file did nothing at all, silently.
function filesFrom(input: HTMLInputElement): File[] {
  return Array.from(input.files || []);
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
// Same downscale, but returning a Blob for direct-to-storage upload (checklist
// photos go to Blob, not into a chat message). A phone camera JPEG is 5-8 MB;
// on site that's the difference between a photo landing and a spinner.
function resizeImage(file: File, max = 1600, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const m = Math.max(width, height);
      if (m > max) { const s = max / m; width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("Image processing unavailable.")); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process that photo."))), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image couldn't be read.")); };
    img.src = url;
  });
}

// Turn a stored/streamed assistant reply into a renderable message: pull a
// trailing "Source: …" line into a citation card, format the rest. Shared by
// live sends and reloading a saved conversation.
//
// `mfrDocs` is the list of manufacturer documents we hold (fetched once per
// session). It's what makes a manufacturer citation reliable: we resolve the
// "GIB · <doc> · page 14" line to the actual document and its URL from OUR data,
// rather than trusting the model to have pasted the link into its answer (which
// it doesn't always do). The full `content` is stashed on the message so it can
// be re-parsed once mfrDocs loads, in case an answer rendered before it arrived.
function assistantMsg(content: string, cards?: AsstCard[], mfrDocs?: MfrDoc[]): Msg {
  // An answer can draw on several documents (e.g. a clash review cites four
  // schedules), so collect EVERY "Source: …" line, not just a trailing one, and
  // strip them all from the body. A single line that lists documents separated
  // by " / " is split into one per document.
  const sourceLines: string[] = [];
  let body = content.replace(/^[ \t]*[-*>]?[ \t]*(?:\*\*)?Source:(?:\*\*)?[ \t]*(.+?)[ \t]*$/gim, (_m, g) => {
    sourceLines.push(String(g).trim());
    return "";
  });
  body = body.replace(/https?:\/\/\S+\.pdf\b\S*/gi, "").replace(/\n{3,}/g, "\n\n").trim();

  const refs = sourceLines.flatMap((l) => l.split(/\s+\/\s+/).map((x) => x.trim()).filter(Boolean));
  const seen = new Set<string>();
  const cites: Cite[] = [];
  for (const ref of refs) {
    const c = makeCite(ref, body, mfrDocs);
    const key = `${c.kind || "plan"}|${(c.doc || c.code || "").toLowerCase()}|${c.page ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cites.push(c);
  }

  const first = cites[0];
  return {
    role: "a",
    src: first
      ? first.kind === "manufacturer"
        ? `📕 FROM ${(first.mfr || "the manufacturer").toUpperCase()}’S MANUAL`
        : first.kind === "determination"
          ? "⚖️ FROM AN MBIE DETERMINATION"
          : "📐 FROM YOUR PLANS"
      : undefined,
    text: fmt(body),
    raw: body,
    full: content,
    cites: cites.length ? cites : undefined,
    cards: cards && cards.length ? cards : undefined,
  };
}
function daySummary(ev: number, tk: number): string {
  const parts = [];
  if (ev) parts.push(`${ev} event${ev > 1 ? "s" : ""}`);
  if (tk) parts.push(`${tk} task${tk > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" · ") : "Empty day";
}
// Manufacturers whose literature we hold. Used ONLY as a fallback so a
// manufacturer citation is still labelled and rendered correctly when the
// /api/manufacturer-docs map hasn't loaded (cold session / flaky network). The
// canonical name + verify URL still come from the map once it arrives; this just
// stops a "GIB · …" line being mislabelled as "FROM YOUR PLANS" in the meantime.
// The image endpoint matches on the exact doc name the model copied from the
// retrieval label, so it loads without the map too. KEEP IN STEP with the
// `manufacturer` values used by dev/*-manifest.json — a brand missing here gets
// mislabelled "FROM YOUR PLANS" whenever the doc map is slow or fails to load.
const KNOWN_MFRS = new Set(["gib", "kingspan thermakraft", "boss fire", "james hardie", "rondo", "ryanfire", "resene", "colorsteel"]);

// Match a "GIB · <document> · page 14 of 32" source line to a document we hold,
// tolerating small differences in how the model wrote the document name. Returns
// the CANONICAL name and URL from our data — which the image endpoint and the
// verify link both depend on being exact.
function resolveMfrDoc(parts: string[], mfrDocs?: MfrDoc[]): MfrDoc | null {
  if (!mfrDocs?.length || parts.length < 2) return null;
  const mfrTok = parts[0].toLowerCase();
  const docTok = parts[1].toLowerCase();
  const cands = mfrDocs.filter((d) => d.manufacturer.toLowerCase() === mfrTok);
  if (!cands.length) return null;
  return (
    cands.find((d) => d.doc.toLowerCase() === docTok) ||
    cands.find((d) => d.doc.toLowerCase().startsWith(docTok) || docTok.startsWith(d.doc.toLowerCase())) ||
    cands.find((d) => d.doc.toLowerCase().includes(docTok) || docTok.includes(d.doc.toLowerCase())) ||
    null
  );
}

function makeCite(sourceLine: string, body: string, mfrDocs?: MfrDoc[]): Cite {
  // The model sometimes wraps the label in markdown bold (**…**). Strip it so a
  // literal "**" doesn't show on the card.
  const parts = sourceLine.replace(/[*_`]/g, "").split("·").map((x) => x.trim()).filter(Boolean);

  // Manufacturer citation. The label the tool produces is
  // "GIB · <document> · page 14 of 32": brand, document, page(s). Resolved
  // against our own document list, so it's reliable regardless of the answer text.
  const hit = resolveMfrDoc(parts, mfrDocs);
  if (hit) {
    const mfr = hit.manufacturer;
    const docName = hit.doc;
    const pageSeg = parts.find((p) => /^page\s/i.test(p)) || "";
    const pageNum = pageSeg.match(/\d+/);
    return {
      code: docName,
      title: pageSeg,
      sub: `${mfr} manual`,
      ans: fmt(body),
      hlTag: pageSeg || docName,
      kind: "manufacturer",
      mfr,
      doc: docName,
      page: pageNum ? parseInt(pageNum[0], 10) : 1,
      url: hit.sourceUrl || undefined,
    };
  }

  // Fallback: the map didn't resolve (empty / late), but the line clearly leads
  // with a manufacturer we hold. Classify it as a manufacturer FROM THE LINE
  // ITSELF, so the label is right and /api/doc-page can still render the page
  // (it matches on the exact doc name the model copied). The verify URL fills in
  // once the map loads and the message re-parses. Without this, a dropped map
  // silently turns every GIB citation into a broken "FROM YOUR PLANS" card.
  if (parts.length >= 2 && KNOWN_MFRS.has(parts[0].toLowerCase())) {
    const mfr = parts[0];
    const docName = parts[1];
    const pageSeg = parts.find((p) => /^page\s/i.test(p)) || "";
    const pageNum = pageSeg.match(/\d+/);
    return {
      code: docName,
      title: pageSeg,
      sub: `${mfr} manual`,
      ans: fmt(body),
      hlTag: pageSeg || docName,
      kind: "manufacturer",
      mfr,
      doc: docName,
      page: pageNum ? parseInt(pageNum[0], 10) : 1,
    };
  }

  // MBIE determination. The label is "Determination 2024/001 · <subject> · page
  // 3 of 15". These are public documents on building.govt.nz at a stable,
  // reference-derived URL, so the viewer can render the real page and link to
  // the original without us hosting anything.
  const detRef = parts[0]?.match(/^Determination\s+(\d{4})\/(\d{1,3})/i);
  if (detRef) {
    const [, year, num] = detRef;
    const ref = `${year}/${num.padStart(3, "0")}`;
    const pageSeg = parts.find((p) => /^page\s/i.test(p)) || "";
    const pageNum = pageSeg.match(/\d+/);
    const subject = parts.slice(1).find((p) => !/^page\s/i.test(p)) || "";
    return {
      code: `Determination ${ref}`,
      title: subject,
      sub: "MBIE determination",
      ans: fmt(body),
      hlTag: pageSeg || `Determination ${ref}`,
      kind: "determination",
      ref,
      page: pageNum ? parseInt(pageNum[0], 10) : 1,
      url: `https://www.building.govt.nz/assets/Uploads/resolving-problems/determinations/${year}/${year}-${num.padStart(3, "0")}.pdf`,
    };
  }

  // Plan / Code citation. Carry doc + page so the viewer can render the actual
  // uploaded sheet (a plan page has a private blob behind it; a Code page won't
  // resolve and the viewer falls back to the placeholder).
  const doc = parts[0] || "Source";
  const code = parts.find((p, i) => i > 0 && /[A-Z]/.test(p) && /\d/.test(p)) || doc;
  const rest = parts.filter((p) => p !== doc && p !== code).join(" · ");
  const pageSeg = parts.find((p) => /^page\s/i.test(p)) || "";
  const pageNum = pageSeg.match(/\d+/);
  return {
    code, title: rest || doc, sub: doc, ans: fmt(body), hlTag: code,
    // Default to page 1 when the model cited a sheet without a page number (it
    // does in long multi-source answers). Almost every drawing is a single page,
    // and the endpoint falls back to the sheet's first page if page 1 is wrong,
    // so this renders the actual sheet instead of the placeholder.
    doc, page: pageNum ? parseInt(pageNum[0], 10) : 1,
  };
}

// "https://www.gib.co.nz/…/x.pdf" → "gib.co.nz", for the "open the full manual
// on <site>" link in the document viewer.
function hostOf(u: string): string {
  try { return new URL(u).host.replace(/^www\./, ""); } catch { return "the manufacturer's site"; }
}

// One event row — used in the week strip, agenda, and day modal. Bar colour is
// the assignee's crew colour when assigned, else the event type's colour.
// Today-at-a-glance for the assistant home — today's events + open tasks, so
// opening the app lands you on your day, not a blank search box (Montázs style).
function TodayGlance({ events, tasks, loaded, colorFor, onToggle, onOpen }: {
  events: CalEvent[];
  tasks: CalTask[];
  loaded: boolean;
  colorFor: (id: string | null) => string | null;
  onToggle: (t: CalTask) => void;
  onOpen: () => void;
}) {
  const empty = loaded && events.length === 0 && tasks.length === 0;
  return (
    <div className="glance">
      <div className="glance-h"><span>Today</span><button onClick={onOpen}>Open calendar →</button></div>
      {!loaded ? (
        <div className="glance-empty">Loading your day…</div>
      ) : empty ? (
        <div className="glance-empty">No events or tasks today. Ask me to book something in.</div>
      ) : (
        <div className="glance-list">
          {events.map((e) => {
            const crew = e.assigneeId ? colorFor(e.assigneeId) : null;
            return (
              <div className="gl-row" key={e.id}>
                <span className="gl-bar" style={{ background: crew || barColor(e.kind) }} />
                <span className="gl-time">{e.allDay ? "All day" : fmtTime(e.startsAt)}</span>
                <span className="gl-title">{e.title}</span>
                {e.assigneeName && <span className="gl-who">{e.assigneeName}</span>}
              </div>
            );
          })}
          {tasks.map((t) => (
            <div className="gl-row task" key={t.id}>
              <span className="gl-cb" onClick={() => onToggle(t)}>{t.done ? "✓" : ""}</span>
              <span className="gl-title">{t.title}</span>
              {t.assigneeName && <span className="gl-who">{t.assigneeName}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EventRow({ e, colorFor, onDelete, checks, onOpenCheck, onNewCheck }: {
  e: CalEvent;
  colorFor?: (id: string | null) => string | null;
  onDelete?: (e: CalEvent) => void;
  /** Checks already attached to this event. Only passed where they're actionable. */
  checks?: ChecklistHead[];
  onOpenCheck?: (id: string) => void;
  onNewCheck?: (e: CalEvent) => void;
}) {
  const tag = kindTag(e.kind);
  const crew = e.assigneeId ? colorFor?.(e.assigneeId) : null;
  const bar = crew || barColor(e.kind);
  const sub = [e.location, e.assigneeName ? `→ ${e.assigneeName}` : null, e.visibility === "team" ? "whole crew" : "just you", e.creatorName].filter(Boolean).join(" · ");
  return (
    <div className="ev">
      <div className="bar" style={{ background: bar }} />
      <div className="when">{fmtAgendaDay(e.startsAt)}<br /><span className="when-t">{fmtEventRange(e)}</span></div>
      <div className="body">
        <b>{e.title}</b>{sub && <small>{sub}</small>}
        {/* An inspection IS a calendar event, so its check lives on the event —
            booked here, walked here, and still here in two years' time. */}
        {onNewCheck && (
          <div className="ev-checks">
            {(checks ?? []).map((c) => (
              <button key={c.id} className="ev-check" onClick={() => onOpenCheck?.(c.id)}>
                ✓ {c.title} · {c.done ?? 0}/{c.total ?? 0}{c.issues ? ` · ${c.issues} to fix` : ""}
              </button>
            ))}
            {(checks ?? []).length === 0 && (
              <button className="ev-check new" onClick={() => onNewCheck(e)}>＋ Build the pre-inspection check</button>
            )}
          </div>
        )}
      </div>
      {tag && <div className="tag" style={{ background: tag.bg, color: tag.fg }}>{tag.label}</div>}
      {onDelete && <button className="row-x" title="Delete" onClick={() => onDelete(e)}>✕</button>}
    </div>
  );
}

// One task row. `full` shows the long meta line (Tasks tab); compact otherwise.
function TaskRow({ t, onToggle, full, onDelete }: { t: CalTask; onToggle: (t: CalTask) => void; full?: boolean; onDelete?: (t: CalTask) => void }) {
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
      {onDelete && <button className="row-x" title="Delete" onClick={() => onDelete(t)}>✕</button>}
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
