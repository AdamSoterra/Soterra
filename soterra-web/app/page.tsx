"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
import { upload } from "@vercel/blob/client";
import { DOC_TYPES, DOC_TYPE_LABEL, docTypeOf, type DocType } from "@/lib/docType";
import Landing from "./landing";
import { InstallHint } from "./components/install-hint";

type Tab = "assistant" | "calendar" | "tasks" | "inspections" | "plans" | "upload" | "rfis" | "insights";
type Cite = {
  code: string; title: string; sub: string; ans: string; hlTag: string;
  // Set when the answer came from a manufacturer's manual (e.g. GIB) rather than
  // the customer's own plans. Drives a different card, a different viewer (the
  // real page rendered as an image) and a link to the manufacturer's own PDF.
  // "determination" = an MBIE ruling on a real dispute. Its own card and viewer,
  // rendered from MBIE's public PDF and always shown with its year, because a
  // ruling can rest on an Acceptable Solution that has since changed.
  // "code" = a Building Code / Acceptable Solution clause (B2, E2/AS1, …). We
  // hold no rendered Code pages, so its chip links out to the free Code on
  // building.govt.nz rather than opening the (blank) sheet viewer.
  kind?: "manufacturer" | "determination" | "standard" | "code";
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
  // streaming = words still arriving: text is a live partial, hold the copy
  // button and the citation cards until "done" replaces it with the final.
  | { role: "a"; src?: string; text: string; raw?: string; full?: string; cites?: Cite[]; cards?: AsstCard[]; pending?: boolean; streaming?: boolean };
type Attachment = { kind: "image" | "pdf"; mediaType: string; data: string; name: string };

// ─── Sites (projects) + crew ───
type Project = { id: string; name: string; code: string; role: string; timezone?: string };
type Member = { userId: string; name: string; title: string | null; role: string; colorIndex: number; isMe: boolean };
type PlanDoc = { doc: string; npages: number; indexed: number; file: string | null; uploadedAt: string; docType?: string | null };

// ─── Inspection history + checklists ───
type CategoryCount = { category: string; count: number };
/** count = how many INSPECTIONS the item appeared on (not rows — the council's
 *  carried-forward register repeats an open item on every later report).
 *  firstSeen→lastSeen is how long it stayed open. */
type TopItem = { title: string; category: string; count: number; firstSeen: string | null; lastSeen: string | null };
type InspectionRow = {
  id: string; doc: string; projectId: string; projectName: string | null;
  source: string; inspectionCode: string | null; inspectionType: string | null;
  inspector: string | null;
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
type ItemPin = { id: string; doc: string; page: number; x: number; y: number; label: string | null };
type ChecklistItem = {
  id: string; ord: number; category: string | null; title: string; detail: string | null;
  source: string; sourceRef: string | null; status: "pending" | "ok" | "issue" | "na";
  note: string | null; checkedByName: string | null; photos: ChecklistPhoto[]; pins?: ItemPin[];
  sentTo?: string | null; sentAt?: string | null; sentStatus?: string | null;
};
// A subcontractor contact (Feature 4): company-scoped, trade = a category.
type Sub = { id: string; name: string; email: string; trade: string | null };
// A consultant contact (the Directory): company-scoped, discipline = an RFI discipline.
type Consultant = { id: string; name: string | null; company: string | null; discipline: string | null; email: string };
// A QA flag (Feature 7): a pinned mistake on a drawing.
type FlagRow = { id: string; n: number; doc: string; page: number; title: string; trade: string | null; note: string | null; status: string; subName: string | null; sentAt: string | null; sentStatus: string | null; fixedAt: string | null };
// ─── RFI types (Feature 5) ───
type RfiRow = {
  id: string; number: number | null; label: string; subject: string; discipline: string | null;
  status: string; ballParty: string; priority: string; criticalPath: boolean;
  consultantCompany: string | null; consultantName: string | null;
  dateRequiredBy: string | null; daysOpen: number; overdue: boolean; lateWd: number;
};
type RfiMsg = { id: string; type: string; authorSide: string; authorName: string | null; body: string; createdAt: string };
type RfiFull = {
  rfi: RfiRow & {
    question: string; proposedSolution: string | null; codeRefs: string | null; location: string | null;
    costImpact: string; costEstimate: string | null; programmeImpact: string; programmeDays: number | null;
    raisedByName: string | null; consultantEmail: string | null; dateRaised: string | null; dateAnswered: string | null; revision: number;
  };
  messages: RfiMsg[];
  transitions: { id: string; fromStatus: string | null; toStatus: string; ballTo: string | null; byName: string | null; comment: string | null; at: string }[];
  pins: { id: string; doc: string; page: number; x: number; y: number }[];
  ci: { id: string; number: number; title: string } | null;
};
type RfiAna = {
  slaWd: number;
  tiles: { openTotal: number; ballConsultants: number; ballUs: number; avgResponseWd: number; overdue: number; criticalPath: number; raisedTotal: number };
  scorecard: { consultant: string; open: number; avgWd: number; medianWd: number; pctInSla: number | null; overdue: number; avgLateWd: number; longestOpenWd: number; reopenPct: number; answered: number }[];
  ballSplit: { consultant: string; count: number }[];
  eot: { label: string; subject: string; consultant: string; requiredBy: string | null; answered: string | null; netLateWd: number; programmeDays: number | null; costImpact: string; status: string }[];
};
const RFI_BALL_PILL = (r: { ballParty: string; consultantCompany: string | null; status: string }) =>
  r.status === "closed" || r.status === "void"
    ? { cls: "none", label: "-" }
    : r.ballParty === "consultant"
      ? { cls: "consult", label: r.consultantCompany || "Consultant" }
      : r.ballParty === "us"
        ? { cls: "us", label: r.status === "answered" ? "Us · to close" : "Us" }
        : { cls: "none", label: "-" };

// Mirror of lib/categories CATEGORIES — the trade options for a sub.
const TRADES = [
  "Structural", "Weathertightness / Cladding", "Fire", "Electrical", "Plumbing & Drainage",
  "Mechanical", "Interior / Linings", "Access & Barriers", "Site / External", "Acoustic",
  "Seismic", "Architect", "Other",
];
// Mirror of lib/rfi DISCIPLINES - the discipline options for a consultant.
const DISCIPLINES = [
  "Architectural", "Structural", "Civil", "Fire", "Mechanical", "Electrical", "Hydraulic", "Geotech", "Facade",
];
type ChecklistHead = {
  id: string; eventId: string | null; kind: string; title: string; inspectionCode: string | null;
  location?: string | null;
  status: string; createdByName: string | null; createdAt: string;
  total?: number; done?: number; issues?: number;
};
// A QA-scope location (Feature 4): extracted from drawing titles, or user-typed.
type QaLoc = { label: string; kind: string; drawings: string[]; source: "extracted" | "user" };
type ChecklistFull = { checklist: ChecklistHead; items: ChecklistItem[] };

// ─── Floor-plan-first sheet pick ──────────────────────────────────────────
// A location-scoped pin should land on the location's floor / GA plan — the
// "you are here" map — not on whatever detail sheet the location list happened
// to start with. Titles are all we have, so: reward plan wording and a
// level/unit match, punish detail-ish wording, and refuse to guess when
// nothing scores — callers keep their old first-drawing fallback.
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function locPartMatches(part: string, title: string): boolean {
  const m = part.match(/^(level|unit|apartment|block|tower|building|stage)\s*0*([a-z0-9]+)$/i);
  if (m) {
    const noun: Record<string, string> = {
      level: "(?:level|lvl|l)", unit: "(?:unit|u)", apartment: "(?:apartment|apt)",
      building: "(?:building|bldg)", block: "block", tower: "tower", stage: "stage",
    };
    return new RegExp(`\\b${noun[m[1].toLowerCase()]}[ ._-]*0*${escRe(m[2])}\\b`, "i").test(title);
  }
  if (/^ground(\s*floor)?$/.test(part)) return /\bground\b|\bgf\b/i.test(title);
  if (/^basement/.test(part)) return /\bbasement\b|\bbsmt\b/i.test(title);
  if (part === "site-wide") return /\bsite\b/i.test(title);
  const words = part.split(/\s+/).filter((w) => w.length > 2);
  return words.length > 0 && words.every((w) => title.includes(w));
}
function floorPlanScore(locLabel: string, title: string): number {
  const t = title.toLowerCase();
  let s = 0;
  if (/floor\s*plan|general\s*arrangement|\bga\b/.test(t)) s += 6;
  else if (/\bplan\b/.test(t)) s += 3;
  if (/\bdetails?\b|\bsections?\b|\belevations?\b|\bschedules?\b|\brcp\b|reflected\s*ceiling|\bsetout\b|\bschematic\b|\bdiagram\b|\briser\b|\blegend\b|\bnotes\b|\bcover\b|\bindex\b|drawing\s*list/.test(t)) s -= 6;
  for (const part of locLabel.toLowerCase().split(" - ")) {
    if (locPartMatches(part.trim(), t)) s += 4;
  }
  return s;
}
/** Best "you are here" sheet for a location, or null to keep the caller's
 *  fallback. Own drawings need any positive score; borrowing from the rest of
 *  the set demands plan wording AND a location match, so we never open some
 *  other level's floor plan. */
function floorPlanFor(locLabel: string, drawings: string[], allDocs: string[]): string | null {
  const pick = (list: string[], min: number): string | null => {
    let best: string | null = null;
    let bestScore = min;
    for (const d of list) {
      const s = floorPlanScore(locLabel, d);
      if (s > bestScore) { best = d; bestScore = s; }
    }
    return best;
  };
  return pick(drawings, 0) ?? pick(allDocs.filter((d) => !drawings.includes(d)), 6);
}

// Consultant discipline codes → readable names (mirrors lib/categories.ts
// CONSULTANT_TYPES). Council codes come back on the row already named.
const DISCIPLINE: Record<string, string> = {
  FIRE: "Fire", ELEC: "Electrical", MECH: "Mechanical", HYD: "Hydraulic / plumbing",
  STRU: "Structural", ARCH: "Architectural", ACOU: "Acoustic", SEIS: "Seismic",
  SERV: "Building services",
};

// Past inspections, grouped the way they arrive: all the council ones together
// (they're one statutory series), then a heading per consultant discipline.
// The trade a row belongs to: council together (one statutory series), each
// consultant discipline on its OWN (Fire, Electrical, Hydraulic…). Shared by
// the grouping and the filter so the dropdown and the headings always agree.
// A consultant report carries its discipline either as a code (FIRE, ELEC — the
// extractor's form) or only in its type text ("Fire observation report" — the
// demo seed leaves the code null), so read both rather than dumping the
// code-less ones into a single "Other consultant" bucket.
const TYPE_DISC: [RegExp, string, string][] = [
  [/fire/i, "FIRE", "Fire"],
  [/elect/i, "ELEC", "Electrical"],
  [/mechan/i, "MECH", "Mechanical"],
  [/hydraul|plumb|drainage/i, "HYD", "Hydraulic / plumbing"],
  [/structur/i, "STRU", "Structural"],
  [/architect/i, "ARCH", "Architectural"],
  [/acoustic/i, "ACOU", "Acoustic"],
  [/seismic/i, "SEIS", "Seismic"],
];
function inspDisc(r: InspectionRow): { key: string; label: string } {
  if (r.source === "council") return { key: "council", label: "Council" };
  if (r.inspectionCode && DISCIPLINE[r.inspectionCode]) return { key: r.inspectionCode, label: DISCIPLINE[r.inspectionCode] };
  const t = `${r.inspectionType ?? ""} ${r.doc}`;
  for (const [re, key, label] of TYPE_DISC) if (re.test(t)) return { key, label };
  return { key: "other", label: "Other consultant" };
}
function groupInspections(rows: InspectionRow[]): { key: string; label: string; rows: InspectionRow[] }[] {
  const groups = new Map<string, { key: string; label: string; rows: InspectionRow[] }>();
  for (const r of rows) {
    const { key, label } = inspDisc(r);
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
// The verdict shown on a report. A council issues a real Pass/Partial/Fail, so
// use exactly what it said. A consultant issues no grade — but on site, items
// to fix ARE a fail you have to deal with, and a clean report is a pass, so
// derive it from the item count. One function so the pill, the outcome filter,
// the sort and the badge colour can never disagree.
function effectiveOutcome(source: string, outcome: string, itemCount: number): "pass" | "partial" | "fail" | "unknown" {
  if (source === "consultant") return itemCount > 0 ? "fail" : "pass";
  if (outcome === "pass" || outcome === "partial" || outcome === "fail") return outcome;
  return "unknown";
}
function outcomeChip(source: string, outcome: string, itemCount: number): { cls: string; label: string } {
  const eff = effectiveOutcome(source, outcome, itemCount);
  return { cls: OUTCOME_PILL[eff], label: OUTCOME_LABEL[eff] };
}

// Where a checklist item came from. An item with no source is a guess, so the
// badge is deliberately loud about which of the three sources backed it.
const SRC_LABEL: Record<string, string> = { plans: "Plans", code: "Code", manufacturer: "GIB manual", history: "Our history", ccc: "CCC pack", hsw: "HSWA / WorkSafe", manual: "Added" };

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
  rfi: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m3 7 9 6 9-6" /></svg>),
};
const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "assistant", label: "Assistant", icon: I.chat },
  { id: "inspections", label: "Inspections", icon: I.tasks },
  { id: "plans", label: "Documents", icon: I.plans },
  { id: "rfis", label: "RFIs", icon: I.rfi },
  { id: "insights", label: "Insights", icon: I.insights },
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
function DocsList({ docs, onDelete, onOpen, defaultOpen }: { docs: { doc: string; indexed: number }[]; onDelete: (doc: string) => void; onOpen?: (doc: string, npages: number) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
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
          <div className="docs" style={docs.length > 10 ? { maxHeight: "58vh", overflowY: "auto" } : undefined}>
            {shown.map((d) => (
              <div
                className={"doc" + (onOpen ? " clickable" : "")}
                key={d.doc}
                onClick={onOpen ? () => onOpen(d.doc, d.indexed) : undefined}
                title={onOpen ? "Open this drawing" : undefined}
              >
                <div className="ic spc">PDF</div>
                <div className="dt"><b>{d.doc}</b><small>{d.indexed} page{d.indexed === 1 ? "" : "s"} indexed</small></div>
                {onOpen && <span className="doc-open">Open ›</span>}
                <button className="sh-x" title="Remove from index" onClick={(e) => { e.stopPropagation(); onDelete(d.doc); }} style={{ position: "static" }}>✕</button>
              </div>
            ))}
            {shown.length === 0 && <div className="page-sub" style={{ margin: "4px 2px" }}>Nothing matches “{q}”.</div>}
          </div>
        </>
      )}
    </div>
  );
}

// Procore-style preview grid of a project's drawings (Plans tab). Each card
// shows a cached thumbnail (rendered once, then instant) and opens the sheet.
function PlanGrid({ docs, projectId, onOpen, onDelete, onSetType }: {
  docs: { doc: string; indexed: number; docType?: string | null }[];
  projectId: string;
  onOpen: (doc: string, npages: number) => void;
  onDelete: (doc: string) => void;
  /** Reclassify a document when auto-detection guessed wrong. */
  onSetType?: (doc: string, docType: DocType) => void;
}) {
  const [q, setQ] = useState("");
  const shown = q.trim() ? docs.filter((d) => d.doc.toLowerCase().includes(q.trim().toLowerCase())) : docs;
  return (
    <>
      {docs.length > 8 && (
        <input className="docs-find" style={{ marginTop: 0, marginBottom: 12 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a document…" />
      )}
      <div className="plan-grid">
        {shown.map((d) => (
          <div className="plan-card" key={d.doc} onClick={() => onOpen(d.doc, d.indexed)} title="Open this document">
            <div className="plan-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/plan-thumb?project=${encodeURIComponent(projectId)}&doc=${encodeURIComponent(d.doc)}&p=1`}
                alt=""
                loading="lazy"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; (e.currentTarget.parentElement as HTMLElement).classList.add("noimg"); }}
              />
              <span className="plan-thumb-fallback">PDF</span>
            </div>
            <div className="plan-meta">
              <b title={d.doc}>{d.doc}</b>
              <small>{d.indexed} page{d.indexed === 1 ? "" : "s"}</small>
              {onSetType && (
                <select
                  className="plan-type"
                  value={docTypeOf(d.docType)}
                  title="Document type - change it if the auto-detect got it wrong"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetType(d.doc, e.target.value as DocType)}
                >
                  {DOC_TYPES.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
                </select>
              )}
            </div>
            <button className="plan-del" title="Remove from index" onClick={(e) => { e.stopPropagation(); onDelete(d.doc); }}>✕</button>
          </div>
        ))}
        {shown.length === 0 && <div className="page-sub" style={{ margin: "4px 2px" }}>Nothing matches “{q}”.</div>}
      </div>
    </>
  );
}

export default function Page() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Cite | null>(null);
  // Pin stage (Foundation 2): full-screen sheet browser, opened from Plans.
  const [pinStage, setPinStage] = useState<{ doc: string; page: number; npages: number } | null>(null);
  // Reset the manufacturer-page image state each time a different source opens,
  // so a previous render error or spinner doesn't carry over.
  const [docImg, setDocImg] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => { setDocImg("loading"); }, [sheet]);
  // The full-screen page image (null = closed). Just shows the already-rendered
  // image bigger — no new render, no cost.
  const [zoomImg, setZoomImg] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const zoomScrimRef = useRef<HTMLDivElement>(null);
  // Mirrors zoomScale for the native wheel handler, which is registered once and
  // would otherwise close over a stale value.
  const zoomScaleRef = useRef(1);
  useEffect(() => { zoomScaleRef.current = zoomScale; }, [zoomScale]);

  // Wheel and trackpad-pinch zoom, anchored on the pointer.
  //
  // Registered natively rather than with onWheel because the handler must call
  // preventDefault to stop the page scrolling underneath, and React attaches
  // wheel listeners passively. A trackpad pinch arrives as ctrl+wheel; a plain
  // wheel zooms too, since inspecting the page is the only thing this view is
  // for. Anchoring means the detail under the cursor stays under the cursor,
  // which is what makes it feel like a document viewer rather than a slider.
  useEffect(() => {
    const el = zoomScrimRef.current;
    if (!el || !zoomImg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const prev = zoomScaleRef.current;
      const next = Math.min(6, Math.max(1, prev * Math.exp(-e.deltaY * 0.0015)));
      if (Math.abs(next - prev) < 0.001) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Where the cursor sits in the content, before the scale changes.
      const cx = el.scrollLeft + px;
      const cy = el.scrollTop + py;
      const ratio = next / prev;
      zoomScaleRef.current = next;
      setZoomScale(next);
      // After React has resized the image, put that same point back under the
      // cursor. rAF because the new layout does not exist until it paints.
      requestAnimationFrame(() => {
        el.scrollLeft = cx * ratio - px;
        el.scrollTop = cy * ratio - py;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomImg]);

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
      // A live streaming bubble is excluded: re-parsing it would strip the
      // streaming flag and surface citation chips before the answer is done.
      prev.map((m) => (m.role === "a" && m.full && !m.pending && !m.streaming ? assistantMsg(m.full, m.cards, mfrDocs) : m)),
    );
  }, [mfrDocs]);
  const [menuOpen, setMenuOpen] = useState(false);
  // App-mode: installed PWA / launched with ?app=1 → login-first instead of marketing.
  const [appMode, setAppMode] = useState(false);

  // ─── sites (projects) + crew ───
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  // Free look-around mode: a signed-in user with NO site trying the assistant
  // (5 questions on base knowledge). Client-side door only — the trial route
  // re-checks membership and meters server-side.
  const [freeMode, setFreeMode] = useState(false);
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
  const [setupAccess, setSetupAccess] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupErr, setSetupErr] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [crewOpen, setCrewOpen] = useState(false);
  const [crewErr, setCrewErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ─── saved conversations (threads) ───
  const [threads, setThreads] = useState<{ id: string; title: string | null; updatedAt: string }[]>([]);
  /** Which conversation is asking "delete this?" — an inline confirm, because a
   *  deleted chat cannot be recovered and the ✕ sits next to the row you click
   *  to open it. "all" confirms clearing every conversation. */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [railOpen, setRailOpen] = useState(false); // mobile drawer
  const [railCollapsed, setRailCollapsed] = useState(false); // desktop collapse

  // ─── voice + file attach (chat composer) ───
  const [isRecording, setIsRecording] = useState(false);
  // Streaming guards. gen invalidates an in-flight stream the moment the user
  // navigates away (new chat, thread switch, project switch) so late deltas
  // can never clobber the conversation now on screen; pinned tracks whether
  // the user sits at the bottom of the chat, so autoscroll follows the stream
  // for a reader at the bottom and never fights one who scrolled up.
  const sendGenRef = useRef(0);
  const scrollPinnedRef = useRef(true);
  // Which assistant message just got copied (index) — drives the ✓ flash.
  const [copiedMsg, setCopiedMsg] = useState<number | null>(null);
  /** Copy an assistant message: the bubble holds rendered HTML, but the
   *  clipboard wants the text a form will accept. On a DETACHED div,
   *  innerText degrades to textContent and fuses paragraphs into one run-on
   *  line — so the block/break tags become newlines BEFORE the strip. */
  const copyMsg = async (html: string, i: number) => {
    try {
      const el = document.createElement("div");
      el.innerHTML = html
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li|ul|ol|h[1-6]|tr)>/gi, "$&\n");
      const plain = (el.innerText || el.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
      if (!plain) return;
      await navigator.clipboard.writeText(plain);
      setCopiedMsg(i);
      setTimeout(() => setCopiedMsg((c) => (c === i ? null : c)), 2200);
    } catch {
      /* clipboard blocked — nothing to break */
    }
  };
  const [sttBusy, setSttBusy] = useState(false);
  const [sttSupported, setSttSupported] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  /** Which of the three dictation engines this device gets:
   *   "native"   — the installed Android app: the phone's own speech engine.
   *   "recorder" — iPhone: record the audio and transcribe it server-side,
   *                because Apple exposes the Web Speech API in a home-screen
   *                app and then refuses to run it.
   *   "web"      — everywhere else: the browser's own Web Speech API, free. */
  const sttModeRef = useRef<"native" | "recorder" | "web" | null>(null);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const mediaStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Watchdog for the browser engine, which on an iPhone home-screen app can
   *  accept start() and then deliver nothing at all — no result, no error, no
   *  end — stranding the composer on "Listening…" until the app is force-quit. */
  const sttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ─── plan upload (Upload tab) + indexed docs (Plans tab) ───
  const [docs, setDocs] = useState<PlanDoc[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  // Which document type the Documents tab is showing. Drawings = the daily one.
  const [docView, setDocView] = useState<DocType>("drawings");
  // Bulk upload: a live "current file" progress + a log of finished ones, so a PM
  // can drop the whole plan set (many PDFs) at once.
  const [upCurrent, setUpCurrent] = useState<{ name: string; phase: string; pct: number } | null>(null);
  const [upItems, setUpItems] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
// A file input hidden with display:none is removed from the layout tree, and
  // some browsers, WebViews and desktop shells then refuse a programmatic
  // .click() on it — which is exactly why "Choose files" did nothing while
  // drag-and-drop worked. Visually hidden but still laid out fixes it everywhere.
  const HIDDEN_INPUT: React.CSSProperties = {
    position: "absolute", width: 1, height: 1, padding: 0, margin: -1,
    overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap", border: 0,
  };
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
  // Past-inspections list filters: free-text search, trade (discipline), outcome.
  const [izSearch, setIzSearch] = useState("");
  const [izDisc, setIzDisc] = useState(""); // "" = all trades
  const [izOutcome, setIzOutcome] = useState(""); // "" = all outcomes
  const [openInspection, setOpenInspection] = useState<{ inspection: InspectionRow; items: { id: string; category: string; title: string; detail: string | null; location: string | null; workStatus?: string; sentTo?: string | null; sentAt?: string | null; sentStatus?: string | null }[] } | null>(null);
  const reportFileRef = useRef<HTMLInputElement>(null);
  const [repCurrent, setRepCurrent] = useState<{ name: string; phase: string; pct: number } | null>(null);
  const [repItems, setRepItems] = useState<{ name: string; ok: boolean; note: string }[]>([]);
  const [repDragOver, setRepDragOver] = useState(false);

  // ─── Checklists (attached to a calendar event) ───
  const [checklists, setChecklists] = useState<ChecklistHead[]>([]);
  // Inspections-tab QA-check filters: free-text + status (open/done).
  const [clSearch, setClSearch] = useState("");
  const [clStatus, setClStatus] = useState(""); // "" = all
  // Inspection-reports table sort. Newest inspected first by default.
  const [repSort, setRepSort] = useState<{ key: "type" | "inspector" | "date" | "items" | "result"; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
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
  // Where the check is scoped (Feature 4): null = whole job.
  const [newClLoc, setNewClLoc] = useState<string | null>(null);
  const [newClLocs, setNewClLocs] = useState<QaLoc[]>([]);
  const [newClLocCustom, setNewClLocCustom] = useState("");
  // Pinning an item on a drawing: which item, and which sheet to open.
  const [pinFor, setPinFor] = useState<{ itemId: string; label: string; doc: string; page: number; npages: number; sheets?: { doc: string; npages: number }[] } | null>(null);
  // Send-fixes-to-subs modal (Feature 4 finish move).
  const [sendOpen, setSendOpen] = useState(false);
  const [subsList, setSubsList] = useState<Sub[]>([]);
  // ONE recipient pool per send (Adam's call): tick existing subs, or add a
  // one-off email. Shared by the checklist and inspection send modals — they
  // are never open at the same time, and each open* handler resets them.
  const [recipSubs, setRecipSubs] = useState<Record<string, boolean>>({});
  const [recipExtras, setRecipExtras] = useState<{ name: string; email: string }[]>([]);
  const [recipOpen, setRecipOpen] = useState(false); // the checkbox panel
  const [exName, setExName] = useState("");
  const [exEmail, setExEmail] = useState("");
  const [sendMsg, setSendMsg] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null); // post-send truth banner
  // Feature 7: QA flags — pin a mistake on a drawing, send it, record it.
  const [flagAt, setFlagAt] = useState<{ x: number; y: number; page: number } | null>(null); // pending drop
  const [flTitle, setFlTitle] = useState("");
  const [flTrade, setFlTrade] = useState("");
  const [flSub, setFlSub] = useState("");
  const [flNote, setFlNote] = useState("");
  const [flagView, setFlagView] = useState<FlagRow | null>(null); // open flag card
  const [flagSendSub, setFlagSendSub] = useState("");
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagErr, setFlagErr] = useState<string | null>(null);
  const [flagNotice, setFlagNotice] = useState<string | null>(null);
  const [pinRefresh, setPinRefresh] = useState(0);
  // Feature 6: inspection-item worklist send (same rails, its own modal).
  const [insSendOpen, setInsSendOpen] = useState(false);
  const [insSendMsg, setInsSendMsg] = useState("");
  const [insBusy, setInsBusy] = useState(false);
  const [insErr, setInsErr] = useState<string | null>(null);
  const [insNotice, setInsNotice] = useState<string | null>(null);
  // ─── RFIs (Feature 5) ───
  const [rfiList, setRfiList] = useState<RfiRow[]>([]);
  const [rfiLoaded, setRfiLoaded] = useState(false);
  const [rfiView, setRfiView] = useState<"reg" | "ana">("reg");
  const [rfiFilter, setRfiFilter] = useState<"all" | "open" | "overdue" | "answered" | "closed">("all");
  const [rfiOpen, setRfiOpen] = useState<RfiFull | null>(null);
  const [rfiAna, setRfiAna] = useState<RfiAna | null>(null);
  const [rfiErr, setRfiErr] = useState<string | null>(null);
  const [rfiBusy, setRfiBusy] = useState(false);
  const [ansOpen, setAnsOpen] = useState(false);
  const [ansText, setAnsText] = useState("");
  const [fuText, setFuText] = useState("");
  const [ciOpen, setCiOpen] = useState(false);
  const [ciTitle, setCiTitle] = useState("");
  const [newRfiOpen, setNewRfiOpen] = useState(false);
  const [nr, setNr] = useState({ subject: "", discipline: "", priority: "normal", location: "", question: "", proposedSolution: "", consultantName: "", consultantCompany: "", consultantEmail: "", cc: "", codeRefs: "", criticalPath: false, costImpact: "unknown", costEstimate: "", programmeImpact: "unknown", programmeDays: "" });
  const [nrCon, setNrCon] = useState(""); // saved-consultant pick on the New RFI form (cosmetic; the fields hold the truth)
  // ─── The Directory (address book): consultants + subs, company-wide ───
  const [dirOpen, setDirOpen] = useState(false);
  const [dirTab, setDirTab] = useState<"consultants" | "subs">("consultants");
  const [conList, setConList] = useState<Consultant[]>([]);
  const [dirForm, setDirForm] = useState({ name: "", company: "", discipline: "", trade: "", email: "" });
  const [dirEdit, setDirEdit] = useState<{ id: string; name: string; company: string; discipline: string; trade: string; email: string } | null>(null);
  const [dirBusy, setDirBusy] = useState(false);
  const [dirErr, setDirErr] = useState<string | null>(null);
  // Inline "+ New sub" on the flag card - the fallback when the sub list is empty.
  const [flagNewSubOpen, setFlagNewSubOpen] = useState(false);
  const [fns, setFns] = useState({ name: "", trade: "", email: "" });
  const [fnsBusy, setFnsBusy] = useState(false);
  const [fnsErr, setFnsErr] = useState<string | null>(null);
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

  // ─── crew management (admin only — the server re-checks every call) ───
  const removeMember = async (m: Member) => {
    if (!window.confirm(`Remove ${m.name} from ${projName}? They lose access now; everything they've already done keeps their name.`)) return;
    const res = await apiFetch(`/api/members?userId=${encodeURIComponent(m.userId)}`, { method: "DELETE" });
    if (res.ok) { setCrewErr(null); await loadMembers(); }
    else setCrewErr((await res.json().catch(() => null))?.error ?? "Couldn't remove them just now.");
  };
  const toggleRole = async (m: Member) => {
    const role = m.role === "admin" ? "member" : "admin";
    const res = await apiFetch("/api/members", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: m.userId, role }) });
    if (res.ok) { setCrewErr(null); await loadMembers(); }
    else setCrewErr((await res.json().catch(() => null))?.error ?? "Couldn't change that role.");
  };
  const rotateCode = async () => {
    if (!window.confirm("Get a new invite code? The old one stops working immediately — anyone you've already sent it to won't be able to use it.")) return;
    const res = await apiFetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rotate-code" }) });
    if (res.ok) {
      const data = await res.json();
      if (data.code) setSiteCode(data.code);
      setCrewErr(null);
    } else setCrewErr((await res.json().catch(() => null))?.error ?? "Couldn't change the code just now.");
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
    sendGenRef.current += 1; // orphan any in-flight stream — see send()
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
    sendGenRef.current += 1; // orphan any in-flight stream — see send()
    setMessages([]);
    setThreadId(null);
    setRailOpen(false);
    setTab("assistant");
  };

  // Open a saved conversation from the sidebar.
  const loadThread = async (id: string) => {
    sendGenRef.current += 1; // orphan any in-flight stream — see send()
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

  // Delete a saved conversation, or all of them. The server scopes both to this
  // user and this site, so nothing else can be reached from here. If the open
  // conversation is the one removed, drop back to an empty chat rather than
  // leaving a thread on screen that no longer exists.
  const deleteThread = async (id: string | "all") => {
    const q = id === "all" ? "all=1" : `id=${encodeURIComponent(id)}`;
    try {
      const res = await apiFetch(`/api/threads?${q}`, { method: "DELETE" });
      if (!res.ok) return;
      if (id === "all") {
        setThreads([]);
        newChat();
      } else {
        setThreads((ts) => ts.filter((t) => t.id !== id));
        if (threadId === id) newChat();
      }
    } catch {
      /* ignore */
    } finally {
      setConfirmDel(null);
    }
  };

  // Lazy-load each tab's data the first time it's opened (after a site is picked).
  useEffect(() => {
    if (!projectId) return;
    if ((tab === "plans" || tab === "upload") && !docsLoaded) loadPlans();
    // Both tabs need the filed reports now: Insights derives its analytics from
    // them, and the Inspections tab lists them beneath the QA checks.
    if ((tab === "insights" || tab === "inspections") && !insightsLoaded) loadInsights();
    // The Inspections tab (and Insights, for the failure counts) needs the
    // checklists — the pre-inspection QA checks and the safety plans.
    if ((tab === "inspections" || tab === "insights") && !checklists.length) loadChecklists();
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
    // Follow the conversation only while the reader is at the bottom. During a
    // streamed answer this effect fires ~10x/second — without the pin check it
    // would snap the view back down every 90ms and make scrolling up
    // impossible for the whole answer.
    if (scrollPinnedRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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

  // Voice dictation runs on two different engines, because they are two genuinely
  // different problems:
  //   • Browser → the Web Speech API, which is Chrome's own cloud service.
  //   • Installed app → the phone's OWN speech engine, through Capacitor.
  // Android's System WebView does not implement the Web Speech API at all, so in
  // the installed app the browser path either doesn't exist or fails "network".
  // That was the dead mic button: not a bug in the button, a missing engine.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      let cancelled = false;
      (async () => {
        try {
          const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
          const { available } = await SpeechRecognition.available();
          if (cancelled) return;
          // We trust available() on Android, where it asks the OS whether a
          // recognition service is actually installed. On iOS it builds a bare
          // SFSpeechRecognizer with the DEVICE's default locale, before we have
          // asked for authorisation — so a false here means "not ready yet",
          // not "unsupported", and hiding the button on it would recreate the
          // exact invisible-mic bug we are fixing. On iOS the plugin answering
          // at all is enough; a genuine failure surfaces on the first tap with
          // a message, which is far better than a button that never appears.
          if (!available && cap.getPlatform?.() !== "ios") return;
          sttModeRef.current = "native";
          setSttSupported(true);
        } catch {
          // No speech plugin in this build. Leave the mic hidden rather than
          // showing a button that can't work — the old failure mode.
        }
      })();
      return () => { cancelled = true; };
    }

    // iPhone. Apple EXPOSES webkitSpeechRecognition in a home-screen web app and
    // then does nothing with it — no prompt, no result, no error — while
    // getUserMedia in the same app records perfectly. Feature detection can't
    // see the difference, so it has to be decided by platform: record here, and
    // transcribe on the server. Covers Safari tabs too, so a phone behaves the
    // same however it was opened.
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    // navigator.mediaDevices is undefined outside a secure context, which is the
    // check that actually matters here.
    if (isIos && navigator.mediaDevices && typeof MediaRecorder !== "undefined") {
      sttModeRef.current = "recorder";
      setSttSupported(true);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    sttModeRef.current = "web";
    setSttSupported(true);
    const rec = new SR();
    rec.lang = "en-NZ";
    rec.continuous = false;
    rec.interimResults = false;
    // Any sign of life disarms the watchdog armed in toggleRecording.
    const clearStt = () => {
      if (sttTimerRef.current) { clearTimeout(sttTimerRef.current); sttTimerRef.current = null; }
    };
    rec.onstart = () => clearStt();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      clearStt();
      const transcript = e.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) setInput((prev) => (prev.trim() ? prev + " " : "") + transcript);
    };
    rec.onend = () => { clearStt(); setIsRecording(false); };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      clearStt();
      setIsRecording(false);
      // Silent failure was the bug — a dead mic button with no reason. Surface it.
      const err = e?.error;
      // On an iPhone home-screen app WebKit exposes webkitSpeechRecognition but
      // can refuse to run it, because the fix needs a usage description in the
      // HOST app's Info.plist and a web app has no host app. Sending someone to
      // Settings for a switch that doesn't exist is worse than saying nothing —
      // so point at the iPhone keyboard's own mic key, which dictates into any
      // text field including this one.
      if (err === "service-not-allowed")
        setAttachErr("Voice dictation isn't available in the home-screen app. Use the microphone key on the iPhone keyboard instead, or just type.");
      else if (err === "not-allowed")
        setAttachErr("Microphone is blocked. Allow mic access for this app in your device/browser settings, then try again.");
      else if (err === "audio-capture")
        setAttachErr("No microphone found — check one is connected.");
      else if (err === "network")
        setAttachErr("Voice dictation couldn't reach the browser's speech service. Check your connection, or just type.");
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

  /** Release the mic. Called on every exit path, including failure: an iOS web
   *  app that holds a MediaStream across a suspension can come back unable to
   *  record until the phone is rebooted. */
  const releaseMic = (stream: MediaStream | null) => {
    try { stream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  };

  /** iPhone: record, then transcribe on the server. */
  const toggleRecorder = async () => {
    if (mediaStopRef.current) { clearTimeout(mediaStopRef.current); mediaStopRef.current = null; }
    const live = mediaRecRef.current;
    if (live) {
      // Second tap: stop. onstop does the upload.
      mediaRecRef.current = null;
      try { live.stop(); } catch { /* ignore */ }
      return;
    }

    setAttachErr(null);
    let stream: MediaStream | null = null;
    try {
      // A FRESH stream every time, never one kept between recordings.
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // iOS wrote MP4/AAC only until 18.4, so a hardcoded webm fails on most
      // iPhones in the field. Ask for what this device actually supports.
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported?.(t)
      );
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      rec.onstop = async () => {
        const captured = stream;
        stream = null;
        releaseMic(captured);
        mediaRecRef.current = null;
        setIsRecording(false);
        if (!chunks.length) return;
        setSttBusy(true);
        try {
          const body = new FormData();
          body.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/mp4" }));
          const res = await fetch("/api/transcribe", { method: "POST", body });
          if (res.status === 503) {
            // No transcription key configured. Voice still works on an iPhone,
            // just not through us — so send them somewhere that does.
            setAttachErr("Voice isn't set up yet. Use the microphone key on your keyboard, or type.");
            return;
          }
          if (!res.ok) {
            setAttachErr("Couldn't turn that into text. Try again, use the microphone key on your keyboard, or type.");
            return;
          }
          const { text } = (await res.json()) as { text?: string };
          if (text) setInput((prev) => (prev.trim() ? prev + " " : "") + text);
          else setAttachErr("Didn't catch that. Try again, or type your message.");
        } catch {
          setAttachErr("Couldn't turn that into text. Try again, or type your message.");
        } finally {
          setSttBusy(false);
        }
      };
      rec.start();
      mediaRecRef.current = rec;
      setIsRecording(true);
      // Nobody asks a 60-second question, and an app left recording in a pocket
      // is both a cost and a privacy problem.
      mediaStopRef.current = setTimeout(() => {
        const r = mediaRecRef.current;
        mediaRecRef.current = null;
        try { r?.stop(); } catch { /* ignore */ }
      }, 60_000);
    } catch {
      releaseMic(stream);
      mediaRecRef.current = null;
      setIsRecording(false);
      setAttachErr("Microphone is blocked. Allow it for Soterra in your iPhone settings, or use the microphone key on your keyboard.");
    }
  };

  const toggleRecording = async () => {
    if (sttModeRef.current === "recorder") return toggleRecorder();

    // ─── installed app: the phone's own speech engine ───
    if (sttModeRef.current === "native") {
      const { SpeechRecognition } = await import("@capacitor-community/speech-recognition");
      if (isRecording) {
        try { await SpeechRecognition.stop(); } catch { /* ignore */ }
        setIsRecording(false);
        return;
      }
      setAttachErr(null);
      try {
        // Ask only when we don't already hold it, so a returning user taps the
        // mic and speaks rather than tapping through a prompt every time.
        const held = await SpeechRecognition.checkPermissions();
        if (held.speechRecognition !== "granted") {
          const asked = await SpeechRecognition.requestPermissions();
          if (asked.speechRecognition !== "granted") {
            setAttachErr("Microphone is blocked. Allow mic access for Soterra in your phone's settings, then try again.");
            return;
          }
        }
        setIsRecording(true);
        // popup:false keeps it in our own UI — the composer already says
        // "Listening… speak now", so Android's dialog would be a second,
        // conflicting one. (popup is ignored on iOS, which has no such dialog.)
        // partialResults:false means start() resolves with the finished
        // transcript, so there's no listener to leak.
        //
        // The two platforms END differently and the UI has to suit both:
        // Android's recognizer detects the end of speech and finalises itself,
        // while iOS keeps the request open until stop() is called. Tapping the
        // mic again hits the isRecording branch above and calls stop(), which
        // resolves this same pending promise — so tap-to-stop works on iOS and
        // is simply redundant on Android.
        //
        // The race guards a silent hang: iOS returns nil from
        // SFSpeechRecognizer(locale:) for a locale it doesn't support and then
        // never resolves OR rejects, which would strand the button in
        // "Listening…" forever with nothing to catch.
        const res = await Promise.race([
          SpeechRecognition.start({
            language: "en-NZ", maxResults: 1, partialResults: false, popup: false,
          }),
          new Promise((_, rej) => setTimeout(() => rej(new Error("stt-timeout")), 60_000)),
        ]);
        const transcript = (res as { matches?: string[] } | undefined)?.matches?.[0] ?? "";
        if (transcript) setInput((prev) => (prev.trim() ? prev + " " : "") + transcript);
      } catch (e) {
        // iOS checkPermissions() only reports the SPEECH authorisation — it
        // never looks at the microphone. So the guard above can pass while the
        // mic itself is denied, and the refusal arrives here instead. Read it,
        // or we'd tell someone to "try again" when the fix is in Settings.
        const msg = String((e as Error)?.message ?? e).toLowerCase();
        if (msg.includes("denied") || msg.includes("permission"))
          setAttachErr("Microphone is blocked. Allow mic access for Soterra in your phone's settings, then try again.");
        else if (msg.includes("stt-timeout"))
          setAttachErr("Voice didn't respond. Try again, or type your message.");
        else
          // Includes the user simply saying nothing, so keep it low-key.
          setAttachErr("Voice didn't catch that. Try again, or type your message.");
      } finally {
        setIsRecording(false);
      }
      return;
    }

    // ─── browser: Web Speech API ───
    const r = recognitionRef.current;
    if (!r) return;
    if (sttTimerRef.current) { clearTimeout(sttTimerRef.current); sttTimerRef.current = null; }
    if (isRecording) {
      try { r.stop(); } catch { /* ignore */ }
      setIsRecording(false);
      return;
    }
    setAttachErr(null);
    try {
      r.start();
      setIsRecording(true);
      // Cleared by onstart the moment the service actually engages, so a working
      // session is never cut short — this only fires when nothing comes back at
      // all, which is the iPhone home-screen failure mode.
      sttTimerRef.current = setTimeout(() => {
        try { r.stop(); } catch { /* ignore */ }
        setIsRecording(false);
        setAttachErr("Voice didn't start. Use the microphone key on the iPhone keyboard, or type your message.");
      }, 6000);
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
    // This stream owns the conversation only while its generation is current —
    // any navigation (new chat, thread switch, project switch) bumps the
    // counter and every later write from this stream becomes a no-op, so late
    // deltas can never overwrite whatever conversation is now on screen.
    sendGenRef.current += 1;
    const gen = sendGenRef.current;
    const live = () => gen === sendGenRef.current;
    scrollPinnedRef.current = true; // a fresh question always starts followed
    setMessages((m) => [...m, { role: "u", text: t, att: att?.name }, { role: "a", text: "…", pending: true }]);
    try {
      // Don't fire before the site id exists — see waitForProject.
      if (!(await waitForProject())) {
        if (live()) setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Still connecting to your site — give that another go in a moment." }]);
        return;
      }
      const res = await apiFetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, threadId, attachment: att, stream: true }),
      });
      if (res.status === 413) {
        if (live()) setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "That attachment's too big to send here — try a smaller file, or add full plan sets via the Upload tab." }]);
        return;
      }
      const finish = (data: { answer?: unknown; error?: unknown; cards?: unknown; threadId?: string; threadNew?: boolean }) => {
        if (!live()) return; // navigated away — the server has it saved; the thread shows it on open
        const ans = String(data.answer || data.error || "Sorry, something went wrong.");
        const cards: AsstCard[] = Array.isArray(data.cards) ? (data.cards as AsstCard[]) : [];
        setMessages((prev) => [...prev.slice(0, -1), assistantMsg(ans, cards, mfrDocs)]);
        if (data.threadId) setThreadId(data.threadId);
        // Refresh the sidebar (new thread appears, or title/order updates).
        loadThreads();
        // If the assistant changed anything card-shaped, refresh dependent tabs.
        if (cards.length) { loadEvents(); loadTasks(); }
      };
      const isStream = (res.headers.get("content-type") || "").includes("x-ndjson") && !!res.body;
      if (!isStream) {
        // Early errors (limits, bad request) and pre-streaming servers still
        // answer as classic JSON — handle exactly as before.
        finish(await res.json());
        return;
      }
      // NDJSON events. delta grows the live bubble; reset clears a searching
      // round's preamble; phase labels what is being searched; done carries
      // the authoritative final answer (identical to the classic response).
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let raw = "";
      let phase: string | undefined;
      let lastPaint = 0;
      const paint = (force = false) => {
        if (!live()) return;
        const now = Date.now();
        if (!force && now - lastPaint < 90) return; // ~10fps: smooth, not stormy
        lastPaint = now;
        // Citations and the source header stay hidden until "done" — a
        // half-streamed "Source:" line would render as a bogus chip. src is
        // reused for the phase label on the pending bubble only.
        const bubble: Msg = raw
          ? { ...(assistantMsg(raw, undefined, mfrDocs) as Extract<Msg, { role: "a" }>), cites: undefined, src: undefined, streaming: true }
          : { role: "a", text: "…", pending: true, src: phase };
        setMessages((prev) => [...prev.slice(0, -1), bubble]);
      };
      let finished = false;
      const handleLine = (line: string) => {
        if (!line.trim() || finished) return;
        let ev: { t?: string; text?: string; label?: string; answer?: unknown; cards?: unknown; threadId?: string; threadNew?: boolean; error?: unknown };
        try { ev = JSON.parse(line); } catch { return; }
        if (ev.t === "delta") { raw += ev.text || ""; paint(); }
        else if (ev.t === "reset") { raw = ""; paint(true); }
        else if (ev.t === "phase") { phase = ev.label; if (!raw) paint(true); }
        else if (ev.t === "done") { finished = true; finish(ev); }
        else if (ev.t === "error") {
          finished = true;
          if (live()) {
            setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: String(ev.error || "Sorry, something went wrong.") }]);
            loadThreads(); // the server recorded the failure in the thread — keep the sidebar honest
          }
        }
      };
      try {
        for (;;) {
          if (!live()) { try { void reader.cancel(); } catch { /* already dead */ } return; }
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const l of lines) handleLine(l);
        }
        if (buf.trim()) handleLine(buf);
      } catch {
        // A hard drop mid-read (network reset, proxy timeout) rejects the
        // read — fall through to the same keep-what-arrived path as clean EOF.
      }
      if (!finished && live()) {
        // Connection died mid-answer: keep what arrived rather than losing it.
        setMessages((prev) => [...prev.slice(0, -1),
          raw ? assistantMsg(raw, undefined, mfrDocs) : { role: "a", text: "Sorry, the connection dropped mid-answer. Try again." }]);
      }
    } catch {
      if (live()) setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Sorry — couldn't reach the assistant just now. Try again." }]);
    } finally {
      setBusy(false);
    }
  };

  // ─── site create / join ───
  const resetSetup = () => { setSetupName(""); setSetupCode(""); setSetupErr(null); setCreatedCode(null); setSetupMode("create"); setSetupPersonName(user?.firstName || ""); setSetupTitle(""); setSetupCompany(""); setSetupAccess(""); };
  const closeSetup = () => { setSetupOpen(false); resetSetup(); };
  const createSite = async () => {
    const name = setupName.trim();
    if (!name) { setSetupErr("Give your site a name."); return; }
    // Only the FIRST site names the company — after that the server puts every
    // new site under the company this person already belongs to, so their
    // failure history stays one history instead of splitting in two.
    const firstSite = projects.length === 0;
    if (firstSite && !setupCompany.trim()) { setSetupErr("Enter your company name."); return; }
    if (firstSite && !setupAccess.trim()) { setSetupErr("Enter your access code. No code yet? Email adam@soterra.co.nz."); return; }
    setSetupBusy(true); setSetupErr(null);
    try {
      const res = await fetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", name, companyName: setupCompany.trim() || null, accessCode: setupAccess.trim() || null, personName: setupPersonName.trim() || null, title: setupTitle.trim() || null }) });
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
    // Warm the QA-location cache now the plan set changed (one model call per
    // batch, so the check-creation picker opens instantly). Fire-and-forget.
    apiFetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) }).catch(() => {});
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
            ? `${data.outcome && data.outcome !== "unknown" ? OUTCOME_LABEL[data.outcome] ?? "Filed" : "Filed"} — nothing outstanding`
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
  // The location picker's options — loaded when the New-check modal opens.
  // Instant when the cache is warm (it is, after any upload), and harmless to
  // refetch: GET /api/locations is a table read.
  useEffect(() => {
    if (!newCl) return;
    setNewClLoc(null); setNewClLocCustom("");
    apiFetch("/api/locations")
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d) => setNewClLocs(Array.isArray(d?.locations) ? d.locations : []))
      .catch(() => setNewClLocs([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newCl]);
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
          location: newClKind === "inspection" ? newClLoc || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.checklist) throw new Error(data.error || "Couldn't build that checklist.");
      setNewCl(null); setNewClCode(""); setNewClLoc(null); setNewClLocCustom("");
      setOpenChecklist(data);
      loadChecklists();
    } catch (e) {
      setClErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setClBusy(false);
    }
  };
  // The post-send truth banner lives with the open checklist.
  useEffect(() => { if (!openChecklist) setSendNotice(null); }, [openChecklist]);
  useEffect(() => { if (!openInspection) { setInsNotice(null); setInsSendOpen(false); } }, [openInspection]);
  // Feature 6: tick a failed inspection item along the worklist. Optimistic.
  const setInsItemStatus = async (itemId: string, workStatus: string) => {
    const insId = openInspection?.inspection.id;
    setOpenInspection((c) => (c ? { ...c, items: c.items.map((i) => (i.id === itemId ? { ...i, workStatus } : i)) } : c));
    try {
      const r = await apiFetch("/api/inspections", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ itemId, workStatus }) });
      if (!r.ok) throw new Error();
    } catch {
      if (insId) {
        try {
          const r = await apiFetch(`/api/inspections?id=${encodeURIComponent(insId)}`);
          const d = await r.json();
          if (d?.inspection) setOpenInspection(d);
        } catch { /* leave optimistic state */ }
      }
    }
  };
  // Tick the subs whose trade matches anything on the list — the common case
  // costs zero taps. Open the panel when nothing pre-ticked, so an empty
  // recipients box never looks like a dead end.
  const preTickRecipients = (list: Sub[], categories: (string | null | undefined)[]) => {
    const cats = new Set(categories.filter(Boolean));
    const ticks: Record<string, boolean> = {};
    for (const s of list) if (s.trade && cats.has(s.trade)) ticks[s.id] = true;
    setRecipSubs(ticks);
    setRecipExtras([]);
    setExName(""); setExEmail("");
    setRecipOpen(Object.keys(ticks).length === 0);
  };
  const addExtraRecipient = () => {
    const email = exEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
    // The server caps one-off addresses at 10 per send — stop at the same line
    // here so the send never dead-ends on "too many recipients".
    setRecipExtras((x) => (x.length >= 10 || x.some((e) => e.email === email) ? x : [...x, { name: exName.trim(), email }]));
    setExName(""); setExEmail("");
  };
  const chosenRecipientCount = () => Object.values(recipSubs).filter(Boolean).length + recipExtras.length;
  const recipientPayload = () => ({
    subIds: Object.keys(recipSubs).filter((id) => recipSubs[id]),
    extras: recipExtras,
  });
  // The one recipients control both send modals share: chips for who's picked,
  // a checkbox row per saved sub, and a one-off email add at the bottom.
  const renderRecipients = () => {
    const chosen = subsList.filter((s) => recipSubs[s.id]);
    return (
      <>
        <label className="ev-lbl" style={{ marginTop: 14 }}>Recipients</label>
        <button type="button" className="rp-box" onClick={() => setRecipOpen((o) => !o)}>
          {chosen.length || recipExtras.length ? (
            <span className="rp-chips">
              {chosen.map((s) => <span key={s.id} className="rp-chip">{s.name}</span>)}
              {recipExtras.map((x) => <span key={x.email} className="rp-chip">{x.name || x.email}</span>)}
            </span>
          ) : (
            <span className="rp-empty">Choose who gets this…</span>
          )}
          <span className="rp-caret">{recipOpen ? "▴" : "▾"}</span>
        </button>
        {recipOpen && (
          <div className="rp-panel">
            {subsList.map((s) => (
              <label key={s.id} className="rp-row">
                <input
                  type="checkbox"
                  checked={!!recipSubs[s.id]}
                  onChange={(e) => setRecipSubs((r) => ({ ...r, [s.id]: e.target.checked }))}
                />
                <span className="rp-name">{s.name}</span>
                {s.trade && <small>{s.trade}</small>}
              </label>
            ))}
            {recipExtras.map((x) => (
              <label key={x.email} className="rp-row">
                <input type="checkbox" checked onChange={() => setRecipExtras((list) => list.filter((e) => e.email !== x.email))} />
                <span className="rp-name">{x.name || x.email}</span>
                <small>{x.name ? x.email : "one-off"}</small>
              </label>
            ))}
            {subsList.length === 0 && recipExtras.length === 0 && (
              <div className="rp-none">No subs saved for this company yet - add an email below.</div>
            )}
            <div className="rp-manual">
              <input className="ev-in" type="email" placeholder="Send to any email…" value={exEmail}
                onChange={(e) => setExEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtraRecipient(); } }} />
              <input className="ev-in" placeholder="Name (optional)" value={exName}
                onChange={(e) => setExName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExtraRecipient(); } }} />
              <button type="button" className="lg-btn" style={{ height: 38, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }}
                disabled={recipExtras.length >= 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(exEmail.trim())} onClick={addExtraRecipient}>Add</button>
            </div>
          </div>
        )}
      </>
    );
  };
  const openInsSend = async () => {
    if (!openInspection) return;
    setInsErr(null); setInsSendMsg("");
    let list: Sub[] = subsList;
    try {
      const r = await apiFetch("/api/subs");
      const d = await r.json();
      if (Array.isArray(d?.subs)) list = d.subs;
    } catch { /* manual add still works */ }
    setSubsList(list);
    preTickRecipients(list, openInspection.items.filter((i) => (i.workStatus ?? "not_done") !== "done").map((i) => i.category));
    setInsSendOpen(true);
  };
  const sendInsItems = async () => {
    if (!openInspection) return;
    if (!chosenRecipientCount()) { setInsErr("Pick at least one recipient."); return; }
    setInsBusy(true); setInsErr(null);
    try {
      const r = await apiFetch("/api/inspections/send-items", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionId: openInspection.inspection.id, ...recipientPayload(), message: insSendMsg.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't send just now.");
      const sent: { sub: string; items: number; status: string }[] = Array.isArray(d?.sent) ? d.sent : [];
      const failed = sent.filter((s) => s.status === "failed");
      try {
        const rr = await apiFetch(`/api/inspections?id=${encodeURIComponent(openInspection.inspection.id)}`);
        const dd = await rr.json();
        if (dd?.inspection) setOpenInspection(dd);
      } catch { /* stamps show on next open */ }
      if (failed.length) {
        setInsErr(`Couldn't email ${failed.map((f) => f.sub).join(", ")} - their items are NOT sent. Check the address and try again.`);
        return;
      }
      setInsSendOpen(false);
      setInsNotice(
        d.transmitting === false
          ? "Recorded on the project log. Email delivery isn't switched on yet, so nothing was emailed - these go out the moment sending is live."
          : `Emailed ${sent.length} sub${sent.length === 1 ? "" : "s"} - recorded on each item.`
      );
    } catch (e) {
      setInsErr(e instanceof Error ? e.message : "Couldn't send just now.");
    } finally {
      setInsBusy(false);
    }
  };
  // Open the send-fixes modal: load the company's subs and pre-tick the ones
  // whose trade matches anything on the Needs-fixing list.
  const openSendFixes = async () => {
    if (!openChecklist) return;
    setSendErr(null); setSendMsg("");
    let list: Sub[] = [];
    try {
      const r = await apiFetch("/api/subs");
      const d = await r.json();
      if (Array.isArray(d?.subs)) list = d.subs;
    } catch { /* manual add still works */ }
    setSubsList(list);
    preTickRecipients(list, openChecklist.items.filter((i) => i.status === "issue").map((i) => i.category));
    setSendOpen(true);
  };
  const sendFixes = async () => {
    if (!openChecklist) return;
    if (!chosenRecipientCount()) { setSendErr("Pick at least one recipient."); return; }
    setSendBusy(true); setSendErr(null);
    try {
      const r = await apiFetch("/api/checklists/send-fixes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklistId: openChecklist.checklist.id, ...recipientPayload(), message: sendMsg.trim() || undefined }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't send just now.");
      // The route reports per-sub outcomes — read them, don't assume success.
      const sent: { sub: string; items: number; status: string }[] = Array.isArray(d?.sent) ? d.sent : [];
      const failed = sent.filter((s) => s.status === "failed");
      openChecklistById(openChecklist.checklist.id); // pick up whatever stamped
      if (failed.length) {
        // Keep the modal open and say exactly who did NOT get their email.
        setSendErr(`Couldn't email ${failed.map((f) => f.sub).join(", ")} - their item${failed.reduce((n, f) => n + f.items, 0) === 1 ? " is" : "s are"} NOT sent. Check the address and try again.`);
        return;
      }
      setSendOpen(false);
      setSendNotice(
        d.transmitting === false
          ? "Recorded on the project log. Email delivery isn't switched on yet, so nothing was emailed - these go out the moment sending is live."
          : `Emailed ${sent.length} sub${sent.length === 1 ? "" : "s"} - recorded on each item.`
      );
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "Couldn't send just now.");
    } finally {
      setSendBusy(false);
    }
  };
  // ─── QA flag actions (Feature 7) ───
  const loadSubs = async () => {
    try {
      const r = await apiFetch("/api/subs");
      const d = await r.json();
      if (Array.isArray(d?.subs)) setSubsList(d.subs);
    } catch { /* keep whatever we have */ }
  };
  const loadSubsIfNeeded = async () => {
    if (subsList.length) return subsList;
    try {
      const r = await apiFetch("/api/subs");
      const d = await r.json();
      if (Array.isArray(d?.subs)) { setSubsList(d.subs); return d.subs as Sub[]; }
    } catch { /* empty list - the flag card's + New sub covers it */ }
    return subsList;
  };
  const dropFlag = async (at: { x: number; y: number; page: number }) => {
    await loadSubsIfNeeded();
    setFlTitle(""); setFlTrade(""); setFlSub(""); setFlNote(""); setFlagErr(null);
    setFlagAt(at);
  };
  const saveFlag = async () => {
    if (!flagAt || !pinStage) return;
    setFlagBusy(true); setFlagErr(null);
    try {
      const r = await apiFetch("/api/flags", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doc: pinStage.doc, page: flagAt.page, x: flagAt.x, y: flagAt.y, title: flTitle, trade: flTrade || undefined, note: flNote || undefined, subId: flSub || undefined }),
      });
      const d = await r.json();
      if (!r.ok || !d.flag) throw new Error(d.error || "Couldn't save the flag.");
      setFlagAt(null);
      setPinRefresh((n) => n + 1);
      setFlagNewSubOpen(false); setFnsErr(null);
      setFlagView(d.flag); // open the card so Send is one tap away
      setFlagSendSub(flSub);
    } catch (e) {
      setFlagErr(e instanceof Error ? e.message : "Couldn't save the flag.");
    } finally { setFlagBusy(false); }
  };
  const openFlagById = async (id: string) => {
    setFlagErr(null); setFlagNotice(null); setFlagNewSubOpen(false); setFnsErr(null);
    await loadSubsIfNeeded();
    try {
      const r = await apiFetch(`/api/flags?id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (r.ok && d.flag) { setFlagView(d.flag); setFlagSendSub(""); }
    } catch { /* stays closed */ }
  };
  // The un-bricking move: a brand-new account has no subs, so the flag card's
  // Send button had nothing to pick. Saves via /api/subs, then selects it.
  const addFlagSub = async () => {
    setFnsBusy(true); setFnsErr(null);
    try {
      const r = await apiFetch("/api/subs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: fns.name.trim(), email: fns.email.trim(), trade: fns.trade || undefined }),
      });
      const d = await r.json();
      if (!r.ok || !d.sub) throw new Error(d.error || "Couldn't save the sub.");
      setSubsList((list) => [...list, d.sub as Sub].sort((a, b) => a.name.localeCompare(b.name)));
      setFlagSendSub(d.sub.id);
      setFlagNewSubOpen(false);
      setFns({ name: "", trade: "", email: "" });
    } catch (e) {
      setFnsErr(e instanceof Error ? e.message : "Couldn't save the sub.");
    } finally { setFnsBusy(false); }
  };
  const flagAction = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setFlagBusy(true); setFlagErr(null);
    try {
      const r = await apiFetch("/api/flags", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "That didn't work just now.");
      if (d.flag) setFlagView(d.flag);
      if (action === "send") {
        setFlagNotice(d.transmitting === false
          ? "Recorded on the project log. Email delivery isn't switched on yet - it goes out the moment sending is live."
          : `Emailed ${d.flag?.subName ?? "the sub"} - recorded.`);
      }
      setPinRefresh((n) => n + 1);
      return true;
    } catch (e) {
      setFlagErr(e instanceof Error ? e.message : "That didn't work just now.");
      return false;
    } finally { setFlagBusy(false); }
  };

  // ─── RFI loaders + actions ───
  const loadRfis = async () => {
    try {
      const r = await apiFetch("/api/rfis");
      const d = await r.json();
      if (Array.isArray(d?.rfis)) setRfiList(d.rfis);
    } catch { /* keep whatever we have */ } finally { setRfiLoaded(true); }
  };
  const loadRfiAna = async () => {
    try {
      const r = await apiFetch("/api/rfis?analytics=1");
      const d = await r.json();
      if (d?.tiles) setRfiAna(d);
    } catch { /* rail shows nothing */ }
  };
  const openRfiById = async (id: string) => {
    setRfiErr(null); setAnsOpen(false); setAnsText(""); setFuText(""); setCiOpen(false); setCiTitle("");
    try {
      const r = await apiFetch(`/api/rfis?id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (r.ok && d.rfi) setRfiOpen(d);
      else setRfiErr(d.error || "Couldn't open that RFI.");
    } catch { setRfiErr("Couldn't open that RFI."); }
  };
  const loadConsultants = async () => {
    try {
      const r = await apiFetch("/api/consultants");
      const d = await r.json();
      if (Array.isArray(d?.consultants)) setConList(d.consultants);
    } catch { /* keep whatever we have */ }
  };
  useEffect(() => {
    if (tab === "rfis" && !rfiLoaded) { loadRfis(); loadRfiAna(); loadConsultants(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  // ─── Directory (address book) actions ───
  const openDirectory = (tabName: "consultants" | "subs") => {
    setDirTab(tabName); setDirErr(null); setDirEdit(null);
    setDirForm({ name: "", company: "", discipline: "", trade: "", email: "" });
    setDirOpen(true);
    // Fresh lists every open - an add elsewhere shouldn't show stale here.
    void loadConsultants(); void loadSubs();
  };
  const dirCreate = async () => {
    setDirBusy(true); setDirErr(null);
    try {
      const isCon = dirTab === "consultants";
      const body = isCon
        ? { name: dirForm.name.trim(), company: dirForm.company.trim(), discipline: dirForm.discipline || undefined, email: dirForm.email.trim() }
        : { name: dirForm.name.trim(), trade: dirForm.trade || undefined, email: dirForm.email.trim() };
      const r = await apiFetch(isCon ? "/api/consultants" : "/api/subs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save that just now.");
      setDirForm({ name: "", company: "", discipline: "", trade: "", email: "" });
      if (isCon) await loadConsultants(); else await loadSubs();
    } catch (e) {
      setDirErr(e instanceof Error ? e.message : "Couldn't save that just now.");
    } finally { setDirBusy(false); }
  };
  const dirSaveEdit = async () => {
    if (!dirEdit) return;
    setDirBusy(true); setDirErr(null);
    try {
      const isCon = dirTab === "consultants";
      const body = isCon
        ? { id: dirEdit.id, name: dirEdit.name.trim(), company: dirEdit.company.trim(), discipline: dirEdit.discipline || null, email: dirEdit.email.trim() }
        : { id: dirEdit.id, name: dirEdit.name.trim(), trade: dirEdit.trade || null, email: dirEdit.email.trim() };
      const r = await apiFetch(isCon ? "/api/consultants" : "/api/subs", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save that just now.");
      setDirEdit(null);
      if (isCon) await loadConsultants(); else await loadSubs();
    } catch (e) {
      setDirErr(e instanceof Error ? e.message : "Couldn't save that just now.");
    } finally { setDirBusy(false); }
  };
  const dirDelete = async (id: string, label: string) => {
    if (!window.confirm(`Remove ${label} from the directory?`)) return;
    setDirBusy(true); setDirErr(null);
    try {
      const isCon = dirTab === "consultants";
      const r = await apiFetch(`${isCon ? "/api/consultants" : "/api/subs"}?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't remove that just now.");
      if (isCon) await loadConsultants(); else await loadSubs();
    } catch (e) {
      setDirErr(e instanceof Error ? e.message : "Couldn't remove that just now.");
    } finally { setDirBusy(false); }
  };
  const rfiAction = async (id: string, action: string, extra: Record<string, unknown> = {}) => {
    setRfiBusy(true); setRfiErr(null);
    try {
      const r = await apiFetch("/api/rfis", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action, ...extra }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "That didn't work just now.");
      await openRfiById(id);
      loadRfis(); loadRfiAna();
      return true;
    } catch (e) {
      setRfiErr(e instanceof Error ? e.message : "That didn't work just now.");
      return false;
    } finally { setRfiBusy(false); }
  };
  const createRfi = async (sendNow: boolean) => {
    setRfiBusy(true); setRfiErr(null);
    try {
      const res = await apiFetch("/api/rfis", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...nr,
          cc: nr.cc.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean),
          codeRefs: nr.codeRefs.split(/[,;]+/).map((s) => s.trim()).filter(Boolean),
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.rfi) throw new Error(d.error || "Couldn't save the RFI.");
      if (sendNow) {
        const ok = await rfiAction(d.rfi.id, "send");
        if (!ok) { await openRfiById(d.rfi.id); } // saved as draft; error already shown
      } else {
        await openRfiById(d.rfi.id);
        loadRfis();
      }
      setNewRfiOpen(false);
      setNr({ subject: "", discipline: "", priority: "normal", location: "", question: "", proposedSolution: "", consultantName: "", consultantCompany: "", consultantEmail: "", cc: "", codeRefs: "", criticalPath: false, costImpact: "unknown", costEstimate: "", programmeImpact: "unknown", programmeDays: "" });
      setNrCon("");
    } catch (e) {
      setRfiErr(e instanceof Error ? e.message : "Couldn't save the RFI.");
    } finally { setRfiBusy(false); }
  };

  // Open the pin stage for a checklist item. An already-pinned item opens on
  // its pin's sheet; a fresh one opens on the check's location FLOOR PLAN (the
  // "you are here" map), else the location's first drawing, else the first doc
  // on the site. The location's sheet list rides along for the sheet switcher.
  const openPinFor = async (it: ChecklistItem, n: number) => {
    let doc: string | null = null;
    let page = 1;
    let loc: QaLoc | null = null;
    const locLabel = openChecklist?.checklist.location;
    if (locLabel) {
      try {
        const r = await apiFetch("/api/locations");
        const d = await r.json();
        loc = (Array.isArray(d?.locations) ? (d.locations as QaLoc[]) : []).find((l) => l.label.toLowerCase() === locLabel.toLowerCase()) ?? null;
      } catch { /* fall through to first doc */ }
    }
    if (it.pins?.length) {
      doc = it.pins[0].doc;
      page = it.pins[0].page;
    }
    let dlist = docs;
    if (!docsLoaded) {
      try {
        const r = await apiFetch("/api/plans");
        const d = await r.json();
        if (Array.isArray(d?.docs)) dlist = d.docs;
      } catch { /* keep what we have */ }
    }
    if (!doc && loc?.drawings?.length) doc = floorPlanFor(loc.label, loc.drawings, dlist.map((d) => d.doc)) ?? loc.drawings[0];
    if (!doc) doc = dlist[0]?.doc ?? null;
    if (!doc) { setClErr("Upload this site's plans first — there's no drawing to pin on."); return; }
    const nd = dlist.find((d) => d.doc === doc);
    // The switcher's sheet list: the location's drawings when the check is
    // location-scoped, the whole set otherwise — always including the open doc.
    const locDrawings = loc?.drawings ?? [];
    const inScope = locDrawings.length ? dlist.filter((d) => locDrawings.includes(d.doc)) : dlist;
    const sheets = inScope.map((d) => ({ doc: d.doc, npages: Math.max(d.indexed, 1) }));
    if (!sheets.some((s) => s.doc === doc)) sheets.unshift({ doc, npages: Math.max(nd?.indexed ?? 0, page) });
    setPinFor({ itemId: it.id, label: String(n), doc, page, npages: Math.max(nd?.indexed ?? 0, page), sheets });
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

  // Print → Save as PDF. Renders a clean, filed-record version of the open
  // check into a hidden iframe and prints it, so a QA check or safety plan can
  // be saved or emailed. An iframe (not a popup window) dodges popup blockers.
  const downloadChecklistPdf = () => {
    if (!openChecklist) return;
    const { checklist: c, items } = openChecklist;
    const isSwms = c.kind === "swms";
    const esc = (s: string) => (s || "").replace(/[&<>]/g, (m) => (m === "&" ? "&amp;" : m === "<" ? "&lt;" : "&gt;"));
    const stLabel: Record<string, string> = isSwms
      ? { ok: "In place", issue: "Not yet", na: "N/A", pending: "—" }
      : { ok: "Good", issue: "Needs fixing", na: "N/A", pending: "—" };
    const stColor: Record<string, string> = { ok: "#12876A", issue: "#C21F1F", na: "#7186A0", pending: "#9AA7B4" };
    const done = items.filter((i) => i.status !== "pending").length;
    const issues = items.filter((i) => i.status === "issue").length;
    const rows = items.map((it) => `
      <div class="it">
        <div class="it-h"><div class="it-t">${esc(it.title)}</div><div class="it-s" style="color:${stColor[it.status] || "#9AA7B4"}">${stLabel[it.status] || "—"}</div></div>
        ${it.detail ? `<div class="it-d">${esc(it.detail)}</div>` : ""}
        <div class="it-m">${esc(SRC_LABEL[it.source] ?? it.source)}${it.sourceRef ? " &middot; " + esc(it.sourceRef) : ""}</div>
        ${it.note ? `<div class="it-n">Note: ${esc(it.note)}</div>` : ""}
      </div>`).join("");
    const today = new Date().toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" });
    const kindLabel = isSwms ? "Safety plan (SWMS / JSA)" : "Pre-inspection checklist";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(c.title)}</title><style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0F2440;margin:32px;font-size:13px;line-height:1.5}
      .brand{font-size:20px;font-weight:800;letter-spacing:-.02em;color:#1B4EC0}
      .kind{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7186A0;margin-top:2px}
      h1{font-size:20px;margin:14px 0 4px;letter-spacing:-.01em}
      .meta,.count{color:#4B5F77;font-size:12px} .count{margin:2px 0 16px}
      hr{border:none;border-top:1px solid #DCE6F1;margin:12px 0}
      .it{padding:11px 0;border-bottom:1px solid #EAF0F7;page-break-inside:avoid}
      .it-h{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
      .it-t{font-weight:700;font-size:13.5px} .it-s{font-weight:700;font-size:12px;white-space:nowrap}
      .it-d{margin-top:3px} .it-m{color:#7186A0;font-size:11px;margin-top:4px}
      .it-n{color:#8a5a00;font-size:12px;margin-top:4px;background:#FFF7E6;padding:5px 8px;border-radius:5px;display:inline-block}
      .swms-note{margin:10px 0 2px;padding:8px 11px;background:#FFF7E6;border-radius:6px;color:#7a5200;font-size:11.5px}
      .foot{margin-top:22px;color:#9AA7B4;font-size:10.5px}
    </style></head><body>
      <div class="brand">Soterra</div><div class="kind">${kindLabel}</div>
      <h1>${esc(c.title)}</h1>
      <div class="meta">${[esc(projName || ""), today].filter(Boolean).join(" &middot; ")}</div>
      <div class="count">${done} of ${items.length} completed${issues ? ` &middot; ${issues} to fix` : ""}</div>
      ${isSwms ? `<div class="swms-note">Draft safety plan. Under HSWA 2015 it must be reviewed and agreed with the crew doing the work before the job starts.</div>` : ""}
      <hr>${rows}
      <div class="foot">Generated by Soterra &middot; soterra.co.nz${c.createdByName ? " &middot; " + esc(c.createdByName) : ""}</div>
    </body></html>`;
    const iframe = document.createElement("iframe");
    iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(iframe);
    const idoc = iframe.contentWindow?.document;
    if (!idoc) { document.body.removeChild(iframe); return; }
    idoc.open(); idoc.write(html); idoc.close();
    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => { try { document.body.removeChild(iframe); } catch { /* already gone */ } }, 1500);
    };
  };

  const deletePlan = async (doc: string) => {
    if (!window.confirm(`Remove "${doc}" from this site's index? The assistant will stop using it.`)) return;
    setDocs((ds) => ds.filter((d) => d.doc !== doc)); // optimistic
    try {
      await apiFetch("/api/plans", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc }) });
      // The plan set changed → re-warm the QA-location cache. Fire-and-forget.
      apiFetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) }).catch(() => {});
    } catch {
      loadPlans(); // resync on failure
    }
  };
  // Reclassify a document (the Documents tab's per-card override). Optimistic;
  // resyncs on failure. Locations only re-derive when the drawings set changed.
  const setDocTypeFor = async (doc: string, docType: DocType) => {
    const wasDrawing = docTypeOf(docs.find((d) => d.doc === doc)?.docType) === "drawings";
    setDocs((ds) => ds.map((d) => (d.doc === doc ? { ...d, docType } : d)));
    try {
      const r = await apiFetch("/api/plans", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc, docType }) });
      if (!r.ok) throw new Error();
      if (wasDrawing !== (docType === "drawings")) {
        apiFetch("/api/locations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) }).catch(() => {});
      }
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
  if (mustSetUp && freeMode && !setupOpen && !createdCode) {
    return <FreeTrial onSetUp={() => setFreeMode(false)} onSignOut={() => clerk.signOut()} />;
  }
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
        access={setupAccess}
        setAccess={setSetupAccess}
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
        onTryFree={mustSetUp && projects.length === 0 ? () => setFreeMode(true) : undefined}
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
      <input ref={fileInputRef} type="file" accept="image/*,application/pdf" style={HIDDEN_INPUT} onChange={onFilePick} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={HIDDEN_INPUT} onChange={onFilePick} />
      {attachErr && <div className="cerr">{attachErr}</div>}
      <div className="crow">
        <span className="hint">
          {isRecording ? "Listening… tap the mic again when you're done"
            : sttBusy ? "Writing that down…"
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
              {/* Switch between this company's sites, and start a new one. The
                  backend always supported multiple sites per company; this is
                  the missing switcher — a clean empty site is also how you demo
                  the Code and standards without a project's plans in the way. */}
              {projects.filter((p) => p.id !== projectId).map((p) => (
                <div className="mrow" key={p.id} onClick={() => { selectProject(p.id); setMenuOpen(false); }}><span className="mi">🏢</span> Switch to {p.name}</div>
              ))}
              <div className="mrow" onClick={() => { setMenuOpen(false); setSetupMode("create"); setSetupOpen(true); }}><span className="mi">＋</span> New site</div>
              {/* Past chats lives here now. It used to be a button floating
                  over the top-left of the assistant screen, which sat on top
                  of the Today card and covered its heading. */}
              <div className="mrow" onClick={() => { setMenuOpen(false); setTab("assistant"); setRailOpen(true); loadThreads(); }}><span className="mi">💬</span> Past chats</div>
              <div className="mrow" onClick={() => { setCrewOpen(true); setCrewErr(null); setMenuOpen(false); loadMembers(); }}><span className="mi">👥</span> Crew &amp; invite code</div>
              <div className="mrow" onClick={() => { setMenuOpen(false); window.open("/install", "_blank"); }}><span className="mi">📱</span> Put it on a phone</div>
              <div className="mrow sep" onClick={() => clerk.signOut()}><span className="mi">↩️</span> Sign out</div>
            </div>
          )}
        </div>
      </header>

      {/* iPhone/iPad Safari only: nudge towards Add to Home Screen. */}
      <InstallHint />

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
                  {threads.length > 0 && (
                    <div className="rail-k rail-krow">
                      <span>Recent</span>
                      {confirmDel === "all" ? (
                        <span className="rail-conf">
                          <button onClick={() => deleteThread("all")} title="Delete them all">Clear all?</button>
                          <button onClick={() => setConfirmDel(null)} title="Keep them">No</button>
                        </span>
                      ) : (
                        <button className="rail-clear" onClick={() => setConfirmDel("all")}>Clear</button>
                      )}
                    </div>
                  )}
                  <ul className="rail-list">
                    {threads.map((th) => (
                      <li
                        key={th.id}
                        className={"rail-item" + (th.id === threadId ? " act" : "")}
                        onClick={() => loadThread(th.id)}
                        title={th.title || "Conversation"}
                      >
                        <span className="rail-t">{th.title || "Conversation"}</span>
                        {confirmDel === th.id ? (
                          <span className="rail-conf" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => deleteThread(th.id)} title="Delete this chat">Delete</button>
                            <button onClick={() => setConfirmDel(null)} title="Keep it">No</button>
                          </span>
                        ) : (
                          <button
                            className="rail-x"
                            title="Delete this chat"
                            aria-label="Delete this chat"
                            onClick={(e) => { e.stopPropagation(); setConfirmDel(th.id); }}
                          >
                            ✕
                          </button>
                        )}
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
                  {/* A gap either side centres the greeting in the available
                      space. */}
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
                <div
                  className="asst-scroll"
                  ref={scrollRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    scrollPinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                  }}
                >
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
                              {/* Every citation now opens the viewer. A Code chip
                                  used to jump straight out to building.govt.nz
                                  because there was nothing to show; the link out
                                  now lives inside the sheet instead, so a Code
                                  page with no stored render still gets you
                                  there and nothing is lost either way. */}
                              {m.cites?.map((c, k) => (
                                <div className="cite" key={k} onClick={() => setSheet(c)}>
                                  <div className="cic">{c.kind === "manufacturer" ? "📕" : c.kind === "determination" ? "⚖️" : c.kind === "standard" ? "📘" : c.kind === "code" ? "📖" : "📐"}</div>
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
                                        // The real table pages from the licensed standard. Tap to
                                        // read the exact figures on the page itself.
                                        <div className="stdpages">
                                          <div className="stdpages-h">The exact table</div>
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
                                        // No rendered page for this topic yet - point at the free
                                        // download rather than imply anything is being withheld.
                                        <div className="stdredact" aria-label="Open the standard to read the table">
                                          <span>open the standard to read the exact table</span>
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
                              {/* The bridge from a drafted RFI (or any answer)
                                  to wherever it needs to be pasted. */}
                              {!m.pending && !m.streaming && !!m.text && (
                                <button
                                  className={"msg-copy" + (copiedMsg === i ? " ok" : "")}
                                  title="Copy this answer as plain text"
                                  onClick={() => void copyMsg(m.text, i)}
                                >
                                  {copiedMsg === i ? "✓ Copied" : "⧉ Copy"}
                                </button>
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
              <div className="page-h">Documents</div>
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
              <div className="page-h">Documents</div>
              <div className="page-sub">{projName}</div>
              {!docsLoaded ? (
                <div className="page-sub">Loading…</div>
              ) : docs.length === 0 ? (
                <div className="drop" onClick={() => setTab("upload")} style={{ cursor: "pointer" }}>
                  <div className="ic">📄</div>
                  <b>No documents yet</b>
                  <p>Upload your drawings, specs, consultant reports and scopes — Soterra reads every page so you can ask the assistant anything about this site.</p>
                  <span className="soon">Go to Upload →</span>
                </div>
              ) : (
                <>
                  <div className="idx">
                    <div><div className="big">{docs.reduce((n, d) => n + d.indexed, 0)}</div><small>pages indexed</small></div>
                    <div style={{ flex: 1 }}><small>{docs.length} document{docs.length > 1 ? "s" : ""} read and searchable by the assistant.</small><span className="grn">● Ready</span></div>
                  </div>
                  {/* One picker, no folder tree: every document has a type
                      (auto-detected at upload, correctable on its card). */}
                  <div className="dt-tabs">
                    {DOC_TYPES.map((t) => {
                      const n = docs.filter((d) => docTypeOf(d.docType) === t).length;
                      return (
                        <button key={t} type="button" className={"dt-tab" + (docView === t ? " act" : "")} onClick={() => setDocView(t)}>
                          {DOC_TYPE_LABEL[t]}{n > 0 && <span>{n}</span>}
                        </button>
                      );
                    })}
                  </div>
                  {(() => {
                    const inView = docs.filter((d) => docTypeOf(d.docType) === docView);
                    if (inView.length === 0) {
                      return (
                        <div className="page-sub" style={{ marginTop: 14 }}>
                          Nothing filed under {DOC_TYPE_LABEL[docView]} on {projName} yet — drop documents on the Upload tab and they land here automatically.
                        </div>
                      );
                    }
                    return (
                      <>
                        <div className="pg-k" style={{ marginTop: 16 }}>{DOC_TYPE_LABEL[docView]} <span style={{ fontWeight: 500, color: "var(--mut)", textTransform: "none", letterSpacing: 0 }}>· tap any one to open it full screen, zoom, pan and pin issues</span></div>
                        <div style={{ marginTop: 10 }}>
                          {projectId && <PlanGrid docs={inView} projectId={projectId} onOpen={(doc, npages) => setPinStage({ doc, page: 1, npages })} onDelete={deletePlan} onSetType={setDocTypeFor} />}
                        </div>
                      </>
                    );
                  })()}
                </>
              )}
            </div></div>
          )
        )}

        {/* ─── UPLOAD ─── */}
        {tab === "upload" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">{hasPlans ? "Update documents" : "Upload documents"}</div>
            <div className="page-sub">
              {hasPlans
                ? `Add or update a document on ${projName} — drawings, specs, consultant reports, scopes. Drop a revised version and the assistant answers from the latest, treating the old one as superseded.`
                : `Load ${projName}'s documents — drawings, specs, consultant reports, scopes — the whole set at once. Soterra reads & indexes every page (private to your site) and files each one by type automatically.`}
            </div>
            <input ref={planFileRef} type="file" accept="application/pdf" multiple style={HIDDEN_INPUT}
              onChange={(e) => { const fs = filesFrom(e.target); if (planFileRef.current) planFileRef.current.value = ""; if (fs.length) onPlanFiles(fs); }} />
            {/* Folder picker: returns the whole tree (subfolders included). No `accept`
                here — webkitdirectory ignores it, so onPlanFiles filters to PDFs. */}
            <input ref={planFolderRef} type="file" multiple style={HIDDEN_INPUT}
              onChange={(e) => { const fs = filesFrom(e.target); if (planFolderRef.current) planFolderRef.current.value = ""; if (fs.length) onPlanFiles(fs); }} />
            <div
              className="drop"
              onClick={(e) => { if (e.target !== e.currentTarget) return; if (!upCurrent) planFileRef.current?.click(); }}
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
                <>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    <button type="button" className="soon" onClick={(e) => { e.stopPropagation(); planFileRef.current?.click(); }}>Choose PDFs</button>
                    <button type="button" className="soon" onClick={(e) => { e.stopPropagation(); planFolderRef.current?.click(); }}>📁 Whole folder</button>
                  </div>
                  {/* The OS folder dialog hides the files inside — people read that
                      as "empty" and bail. Say so before they open it. */}
                  <p style={{ fontSize: 12.5, color: "var(--mut)", marginTop: 8 }}>
                    Picking a whole folder? The window will look empty — that&apos;s Windows hiding the files. Select the folder itself and hit Upload; every PDF inside (subfolders too) comes with it.
                  </p>
                </>
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

        {tab === "inspections" && (
          <div className="page"><div className="page-inner">
            <div className="cal-top">
              <div>
                <div className="page-h">Inspections</div>
                <div className="page-sub" style={{ marginBottom: 0 }}>
                  Your pre-inspection checks and the council and consultant reports filed on {projName}.
                </div>
              </div>
              <button className="cal-new" onClick={() => { setNewCl({ eventId: null, eventTitle: null }); setNewClKind("inspection"); setNewClCode(""); setClErr(null); }}>＋ New check</button>
            </div>

            {/* ── Section 1: the pre-inspection QA checks we generate ── */}
            <div className="sub-k" style={{ marginTop: 20 }}>Pre-inspection checks<span>{checklists.length}</span></div>
            {checklists.length === 0 ? (
              <div className="page-sub" style={{ marginTop: 4 }}>
                None yet on {projName}. Ask the assistant to get you ready for an inspection (&quot;what will I fail on at pre-line, build me the check&quot;) or to draft a safety plan for a task — or hit ＋ New check. Each is built from this site&apos;s drawings, the Building Code and your history, and you tick it off on your phone.
              </div>
            ) : (() => {
              const q = clSearch.trim().toLowerCase();
              const filtered = checklists.filter((c) => {
                const st = c.status === "done" ? "done" : "open";
                if (clStatus && st !== clStatus) return false;
                if (q) {
                  const hay = [c.title, c.location, c.inspectionCode, c.createdByName].filter(Boolean).join(" ").toLowerCase();
                  if (!hay.includes(q)) return false;
                }
                return true;
              });
              return (
                <>
                  <div className="iz-filters">
                    <input className="iz-search" placeholder="Search checks…" value={clSearch} onChange={(e) => setClSearch(e.target.value)} />
                    <select className="iz-sel" value={clStatus} onChange={(e) => setClStatus(e.target.value)}>
                      <option value="">All checks</option>
                      <option value="open">Open</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                  {filtered.length === 0 ? (
                    <div className="iz-none">No checks match{q || clStatus ? " those filters" : ""}.</div>
                  ) : (
                    <div>{filtered.map((c) => <ChecklistRow key={c.id} c={c} onOpen={() => openChecklistById(c.id)} />)}</div>
                  )}
                </>
              );
            })()}

            {/* ── Section 2: the filed council + consultant inspection reports ── */}
            <input ref={reportFileRef} type="file" accept="application/pdf" multiple style={HIDDEN_INPUT}
              onChange={(e) => { const fs = filesFrom(e.target); if (reportFileRef.current) reportFileRef.current.value = ""; if (fs.length) onReportFiles(fs); }} />
            <div className="sub-k" style={{ marginTop: 26 }}>Inspection reports<span>{insights?.inspections.length ?? 0}</span></div>
            {!insightsLoaded ? (
              <div className="page-sub" style={{ marginTop: 4 }}>Loading…</div>
            ) : (insights?.inspections.length ?? 0) === 0 ? (
              <div
                className="drop"
                style={{ marginTop: 4, cursor: repCurrent ? "default" : "pointer", outline: repDragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
                onClick={() => { if (!repCurrent) reportFileRef.current?.click(); }}
                {...reportDropProps}
              >
                <div className="ic">📋</div>
                <b>{repCurrent ? `${repCurrent.phase}…` : "Add your inspection reports"}</b>
                <p>{repCurrent ? repCurrent.name : "Drop in the council and consultant reports you've already had — Soterra reads each one, keeps what failed, and Insights learns what your crew keeps getting pulled up on."}</p>
                {repCurrent ? <div className="upbar"><div className="upbar-fill" style={{ width: `${Math.max(repCurrent.pct, 4)}%` }} /></div> : <span className="soon">Choose reports</span>}
              </div>
            ) : (() => {
              const all = insights!.inspections;
              const discOpts = groupInspections(all).map((g) => ({ key: g.key, label: g.label, count: g.rows.length }));
              const q = izSearch.trim().toLowerCase();
              const filtered = all.filter((r) => {
                if (izDisc && inspDisc(r).key !== izDisc) return false;
                if (izOutcome && effectiveOutcome(r.source, r.outcome, r.itemCount) !== izOutcome) return false;
                if (q) {
                  const hay = [r.inspectionType, r.doc, r.inspectionCode, r.projectName, r.inspectedOn, inspDisc(r).label]
                    .filter(Boolean).join(" ").toLowerCase();
                  if (!hay.includes(q)) return false;
                }
                return true;
              });
              // Newest inspected first by default; click a header to re-sort.
              // Council severity ranks fail > partial > pass; a consultant
              // "Report" has no verdict so it sits at the bottom of a result sort.
              const resultRank = (r: InspectionRow) => { const e = effectiveOutcome(r.source, r.outcome, r.itemCount); return e === "fail" ? 3 : e === "partial" ? 2 : e === "pass" ? 1 : 0; };
              const cmp = (a: InspectionRow, b: InspectionRow) => {
                let v = 0;
                if (repSort.key === "items") v = a.itemCount - b.itemCount;
                else if (repSort.key === "result") v = resultRank(a) - resultRank(b);
                else if (repSort.key === "type") v = (a.inspectionType || a.doc).localeCompare(b.inspectionType || b.doc);
                else if (repSort.key === "inspector") v = (a.inspector || "").localeCompare(b.inspector || "");
                else v = (a.inspectedOn || "").localeCompare(b.inspectedOn || "");
                if (v === 0) v = (a.inspectedOn || "").localeCompare(b.inspectedOn || ""); // tiebreak by date
                return repSort.dir === "asc" ? v : -v;
              };
              const rows = [...filtered].sort(cmp);
              const clickSort = (key: typeof repSort.key) =>
                setRepSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "type" || key === "inspector" ? "asc" : "desc" }));
              const caret = (key: typeof repSort.key) => (repSort.key === key ? (repSort.dir === "asc" ? " ↑" : " ↓") : "");
              return (
                <>
                  <div className="iz-filters">
                    <input className="iz-search" placeholder="Search reports…" value={izSearch} onChange={(e) => setIzSearch(e.target.value)} />
                    <select className="iz-sel" value={izDisc} onChange={(e) => setIzDisc(e.target.value)}>
                      <option value="">All trades</option>
                      {discOpts.map((o) => <option key={o.key} value={o.key}>{o.label} ({o.count})</option>)}
                    </select>
                    <select className="iz-sel" value={izOutcome} onChange={(e) => setIzOutcome(e.target.value)}>
                      <option value="">All outcomes</option>
                      <option value="pass">Passed</option>
                      <option value="partial">Partial</option>
                      <option value="fail">Failed</option>
                    </select>
                  </div>
                  {rows.length === 0 ? (
                    <div className="iz-none">No reports match{q || izDisc || izOutcome ? " those filters" : ""}.</div>
                  ) : (
                    <div className="rt-wrap">
                      <table className="rt">
                        <colgroup><col style={{ width: "33%" }} /><col style={{ width: "27%" }} /><col style={{ width: "16%" }} /><col style={{ width: "10%" }} /><col style={{ width: "14%" }} /></colgroup>
                        <thead>
                          <tr>
                            <th className="rt-th" onClick={() => clickSort("type")}>Report{caret("type")}</th>
                            <th className="rt-th" onClick={() => clickSort("inspector")}>Inspector{caret("inspector")}</th>
                            <th className="rt-th" onClick={() => clickSort("date")}>Inspected{caret("date")}</th>
                            <th className="rt-th r" onClick={() => clickSort("items")}>To fix{caret("items")}</th>
                            <th className="rt-th r" onClick={() => clickSort("result")}>Result{caret("result")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => {
                            const oc = outcomeChip(r.source, r.outcome, r.itemCount);
                            return (
                              <tr className="rt-row" key={r.id} onClick={async () => {
                                const res = await apiFetch(`/api/inspections?id=${encodeURIComponent(r.id)}`);
                                const data = await res.json();
                                if (res.ok) setOpenInspection({ inspection: r, items: data.items || [] });
                              }}>
                                <td className="rt-name">
                                  <span className="rt-badge" style={{ background: oc.cls === "pass" ? "var(--green)" : oc.cls === "fail" ? "var(--red)" : undefined }}>
                                    {r.inspectionCode || (r.source === "council" ? "BCA" : "CON")}
                                  </span>
                                  <span className="rt-type">{r.inspectionType || r.doc}</span>
                                </td>
                                <td className="rt-mut">{r.inspector || "—"}</td>
                                <td className="rt-mut">{r.inspectedOn || "—"}</td>
                                <td className="rt-r">{r.itemCount ? r.itemCount : "—"}</td>
                                <td className="rt-r"><span className={"pill " + oc.cls}>{oc.label}</span></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div
                    className="drop"
                    style={{ marginTop: 12, padding: "18px 20px", cursor: repCurrent ? "default" : "pointer", outline: repDragOver ? "2px dashed var(--brand)" : undefined, outlineOffset: 4 }}
                    onClick={() => { if (!repCurrent) reportFileRef.current?.click(); }}
                    {...reportDropProps}
                  >
                    <b>{repCurrent ? `${repCurrent.phase}…` : "Add another inspection report"}</b>
                    <p>{repCurrent ? repCurrent.name : "Council checklists or a consultant's site observation report — PDF with real text, not a scan."}</p>
                    {repCurrent && <div className="upbar"><div className="upbar-fill" style={{ width: `${Math.max(repCurrent.pct, 4)}%` }} /></div>}
                  </div>
                </>
              );
            })()}
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

        {/* ─── RFIs (Feature 5, per the approved rfi-mock.html) ─── */}
        {tab === "rfis" && (
          <div className="page"><div className="page-inner" style={{ maxWidth: 1060 }}>
            {!rfiOpen && (
              <>
                <div className="rf-head">
                  <div className="page-h" style={{ margin: 0 }}>RFIs</div>
                  <div className="rf-vs">
                    <button className={"rf-vsb" + (rfiView === "reg" ? " act" : "")} onClick={() => setRfiView("reg")}>Register</button>
                    <button className={"rf-vsb" + (rfiView === "ana" ? " act" : "")} onClick={() => { setRfiView("ana"); loadRfiAna(); }}>Analytics</button>
                    <button className="rf-vsb" onClick={() => openDirectory("consultants")}>Directory</button>
                  </div>
                  <button className="rf-new" onClick={() => { setRfiErr(null); setNewRfiOpen(true); }}>＋ New RFI</button>
                </div>
                {rfiErr && <div className="ev-err" style={{ marginBottom: 12 }}>{rfiErr}</div>}
              </>
            )}

            {!rfiOpen && rfiView === "reg" && (
              <>
                <div className="rf-strip">
                  <div className="rf-tile"><b>{rfiAna?.tiles.openTotal ?? rfiList.filter((r) => r.status === "open" || r.status === "answered").length}</b><span>open</span><small>{rfiAna ? `${rfiAna.tiles.ballConsultants} with consultants` : ""}</small></div>
                  <div className="rf-tile"><b className={rfiAna && rfiAna.tiles.avgResponseWd > rfiAna.slaWd ? "red" : ""}>{rfiAna?.tiles.avgResponseWd || 0} wd</b><span>avg response</span><small>vs {rfiAna?.slaWd ?? 7} wd allowed</small></div>
                  <div className="rf-tile"><b className={rfiAna && rfiAna.tiles.overdue > 0 ? "red" : ""}>{rfiAna?.tiles.overdue ?? rfiList.filter((r) => r.overdue).length}</b><span>overdue</span><small>past required-by</small></div>
                  <div className="rf-tile"><b>{rfiAna?.tiles.criticalPath ?? 0}</b><span>critical path</span><small>flagged for EOT</small></div>
                </div>
                <div className="rf-filters">
                  {(["all", "open", "overdue", "answered", "closed"] as const).map((f) => (
                    <button key={f} className={"rf-f" + (rfiFilter === f ? " act" : "")} onClick={() => setRfiFilter(f)}>
                      {f === "all" ? "All" : f[0].toUpperCase() + f.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="rf-reg">
                  {!rfiLoaded ? (
                    <div className="page-sub" style={{ padding: 16 }}>Loading…</div>
                  ) : rfiList.length === 0 ? (
                    <div style={{ padding: "26px 20px", textAlign: "center" }}>
                      <b style={{ fontSize: 15, color: "var(--navy)" }}>No RFIs yet on {projName}</b>
                      <p className="page-sub" style={{ margin: "8px auto 14px", maxWidth: 460 }}>
                        Raise one and Soterra sends it, tracks who holds the ball, and builds the consultant scorecard from day one. The consultant answers from a link in the email - no account needed - and it lands back in this thread. Tip: ask the assistant about the detail first, then Copy its draft straight into the question.
                      </p>
                      <button className="rf-new" style={{ margin: 0 }} onClick={() => setNewRfiOpen(true)}>＋ Raise the first RFI</button>
                    </div>
                  ) : (
                    <table>
                      <thead><tr><th>RFI #</th><th>Subject</th><th>Ball in court</th><th>Status</th><th>Due</th><th style={{ textAlign: "right" }}>Days open</th></tr></thead>
                      <tbody>
                        {rfiList
                          .filter((r) => rfiFilter === "all" ? true : rfiFilter === "overdue" ? r.overdue : r.status === rfiFilter)
                          .map((r) => {
                            const ball = RFI_BALL_PILL(r);
                            return (
                              <tr key={r.id} className={r.overdue ? "late" : ""} onClick={() => void openRfiById(r.id)}>
                                <td className="num">{r.label}</td>
                                <td className="subj">{r.subject}</td>
                                <td><span className={"rf-pill " + ball.cls}>{ball.label}</span></td>
                                <td><span className={"rf-pill " + r.status}>{r.status}</span></td>
                                <td className={"due" + (r.overdue ? " red" : "")}>
                                  {r.dateRequiredBy && (r.status === "open" || r.status === "draft")
                                    ? new Date(r.dateRequiredBy).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) + (r.overdue ? ` · ${r.lateWd} wd late` : "")
                                    : "-"}
                                </td>
                                <td className="days">{r.number == null ? "-" : r.daysOpen}</td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}

            {!rfiOpen && rfiView === "ana" && (
              <>
                <div className="rf-strip">
                  <div className="rf-tile"><b>{rfiAna ? `${rfiAna.tiles.ballConsultants} / ${rfiAna.tiles.ballUs}` : "-"}</b><span>ball in court</span><small>design team / us</small></div>
                  <div className="rf-tile"><b className={rfiAna && rfiAna.tiles.avgResponseWd > rfiAna.slaWd ? "red" : ""}>{rfiAna?.tiles.avgResponseWd || 0} wd</b><span>avg consultant response</span><small>vs {rfiAna?.slaWd ?? 7} wd allowed</small></div>
                  <div className="rf-tile"><b className={rfiAna && rfiAna.tiles.overdue > 0 ? "red" : ""}>{rfiAna?.tiles.overdue ?? 0}</b><span>overdue</span><small>past required-by</small></div>
                  <div className="rf-tile"><b>{rfiAna?.tiles.openTotal ?? 0}</b><span>open RFIs</span><small>of {rfiAna?.tiles.raisedTotal ?? 0} raised</small></div>
                </div>

                <div className="rf-sc">
                  <h3>Consultant scorecard</h3>
                  <div className="note">Worst offender first · RAG against the {rfiAna?.slaWd ?? 7} working-day allowance · this table goes in the monthly minutes</div>
                  {rfiAna && rfiAna.scorecard.length > 0 ? (
                    <table>
                      <thead><tr><th>Consultant</th><th>Open</th><th>Avg (wd)</th><th>Median *</th><th>% in SLA †</th><th>Overdue</th><th>Avg late</th><th>Longest</th></tr></thead>
                      <tbody>
                        {rfiAna.scorecard.map((s) => {
                          const rag = (v: number, warn: number, bad: number) => (v >= bad ? "r" : v >= warn ? "a" : "g");
                          const ragPct = (v: number | null) => (v == null ? "" : v < 50 ? "r" : v < 75 ? "a" : "g");
                          return (
                            <tr key={s.consultant}>
                              <td className="cname">{s.consultant}</td>
                              <td>{s.open}</td>
                              <td className={s.answered ? rag(s.avgWd, rfiAna.slaWd, rfiAna.slaWd * 1.6) : ""}>{s.answered ? s.avgWd : "-"}</td>
                              <td className={s.answered ? rag(s.medianWd, rfiAna.slaWd, rfiAna.slaWd * 1.6) : ""}>{s.answered ? s.medianWd : "-"}</td>
                              <td className={ragPct(s.pctInSla)}>{s.pctInSla == null ? "-" : `${s.pctInSla}%`}</td>
                              <td className={s.overdue ? "r" : "g"}>{s.overdue}</td>
                              <td className={s.avgLateWd ? rag(s.avgLateWd, 2, 5) : "g"}>{s.avgLateWd ? `${s.avgLateWd} wd` : "-"}</td>
                              <td>{s.longestOpenWd ? `${s.longestOpenWd} wd` : "-"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  ) : (
                    <div className="page-sub" style={{ padding: "4px 15px 14px" }}>Numbers appear as RFIs are sent and answered.</div>
                  )}
                  {rfiAna && rfiAna.scorecard.length > 0 && (
                    <div className="rf-guard" style={{ padding: "2px 15px 12px" }}>
                      * Median = the middle answer time, so one slow RFI can&apos;t skew it. &nbsp; † % in SLA = share answered within the {rfiAna.slaWd} working-day allowance.
                    </div>
                  )}
                </div>

                {rfiAna && rfiAna.scorecard.some((s) => s.answered > 0) && (
                  <div className="rf-sc">
                    <h3>Average turnaround by consultant</h3>
                    <div className="rf-bars">
                      {rfiAna.scorecard.filter((s) => s.answered > 0).map((s) => {
                        const max = Math.max(...rfiAna.scorecard.map((x) => x.avgWd), rfiAna.slaWd * 2);
                        return (
                          <div className="rf-brow" key={s.consultant}>
                            <span className="bl">{s.consultant}</span>
                            <div className="rf-btrack">
                              <div className={"rf-bfill" + (s.avgWd > rfiAna.slaWd ? " over" : "")} style={{ width: `${Math.min(100, (s.avgWd / max) * 100)}%` }} />
                              <div className="rf-slaline" style={{ left: `${(rfiAna.slaWd / max) * 100}%` }} />
                            </div>
                            <span className="rf-bval">{s.avgWd} wd</span>
                          </div>
                        );
                      })}
                      <div className="rf-guard" style={{ textAlign: "right" }}>│ = the {rfiAna.slaWd} working-day allowance</div>
                    </div>
                  </div>
                )}

                <div className="rf-sc">
                  <h3>EOT evidence pack</h3>
                  <div className="note">Every late, critical-path RFI as cause and effect: issued → required-by → answered → net consultant days late → schedule impact. {rfiAna?.eot.length ? `${rfiAna.eot.length} RFI${rfiAna.eot.length === 1 ? "" : "s"} qualify right now.` : "None qualify right now, which is a good thing."}</div>
                  {rfiAna && rfiAna.eot.length > 0 ? (
                    <table>
                      <thead><tr><th>RFI</th><th>Subject</th><th>Consultant</th><th>Required by</th><th>Answered</th><th>Net late</th><th>Schedule impact</th><th>Status</th></tr></thead>
                      <tbody>
                        {rfiAna.eot.map((e) => (
                          <tr key={e.label}>
                            <td className="cname">{e.label}</td>
                            <td>{e.subject}</td>
                            <td>{e.consultant}</td>
                            <td>{e.requiredBy ? new Date(e.requiredBy).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "-"}</td>
                            <td>{e.answered ? new Date(e.answered).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "still open"}</td>
                            <td className="r">{e.netLateWd} wd</td>
                            <td>{e.programmeDays ? `${e.programmeDays} days` : "-"}</td>
                            <td><span className={"rf-pill " + e.status}>{e.status}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="page-sub" style={{ padding: "2px 15px 8px" }}>No late critical-path RFIs right now, so there is nothing to claim.</div>
                  )}
                  <div className="rf-guard" style={{ padding: "2px 15px 12px" }}>Shown against the register&apos;s assumed allowance ({rfiAna?.slaWd ?? 7} working days). Turnaround is net of clarification bounce-backs (the clock pauses while the ball is back with us). Our own late-raised RFIs stay in the log - an honest register is what makes the pack defensible.</div>
                </div>
              </>
            )}

            {rfiOpen && (
              <>
                <button className="rf-back" onClick={() => { setRfiOpen(null); loadRfis(); }}>‹ Back to the register</button>
                <div className="rf-dhead">
                  <span className="no">{rfiOpen.rfi.label}</span>
                  <span className="rev">Rev {rfiOpen.rfi.revision}</span>
                  <span className="subj">{rfiOpen.rfi.subject}</span>
                  <span className={"rf-pill " + rfiOpen.rfi.status}>{rfiOpen.rfi.status}</span>
                  {(() => { const b = RFI_BALL_PILL(rfiOpen.rfi); return <span className={"rf-pill " + b.cls}>{b.label}</span>; })()}
                  {rfiOpen.rfi.discipline && <span className="rf-pill us">{rfiOpen.rfi.discipline}</span>}
                  <span className="meta">
                    {rfiOpen.rfi.dateRequiredBy && rfiOpen.rfi.status === "open" ? `Due ${new Date(rfiOpen.rfi.dateRequiredBy).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })} · ` : ""}
                    {rfiOpen.rfi.number != null ? `${rfiOpen.rfi.daysOpen} days open` : "draft"}
                  </span>
                </div>
                {rfiErr && <div className="ev-err" style={{ marginBottom: 12 }}>{rfiErr}</div>}

                <div className="rf-cols">
                  <div className="rf-thread">
                    <div className="rf-card">
                      <div className="k">Question · {rfiOpen.rfi.raisedByName ?? "us"}{rfiOpen.rfi.dateRaised ? ` · ${new Date(rfiOpen.rfi.dateRaised).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : " · draft"}</div>
                      <div className="rf-q">{rfiOpen.rfi.question}</div>
                      {rfiOpen.rfi.proposedSolution && <div className="rf-prop"><b>Our proposed solution</b>{rfiOpen.rfi.proposedSolution}</div>}
                      {(rfiOpen.pins.length > 0 || rfiOpen.rfi.codeRefs) && (
                        <div className="rf-refs">
                          {rfiOpen.pins.map((p) => (
                            <span key={p.id} className="rf-rchip" onClick={() => {
                              const nd = docs.find((d) => d.doc === p.doc);
                              setPinStage({ doc: p.doc, page: p.page, npages: Math.max(nd?.indexed ?? 0, p.page) });
                            }}>📌 {p.doc} · p{p.page}</span>
                          ))}
                          {(rfiOpen.rfi.codeRefs ? (JSON.parse(rfiOpen.rfi.codeRefs) as string[]) : []).map((c) => (
                            <span key={c} className="rf-rchip code">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>

                    {rfiOpen.rfi.status === "draft" && (
                      <div className="rf-card" style={{ borderColor: "rgba(139,92,246,.4)" }}>
                        <div className="k">Draft - not sent, no number burned</div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 18px", fontSize: 13 }} disabled={rfiBusy} onClick={() => void rfiAction(rfiOpen.rfi.id, "send")}>
                            {rfiBusy ? "Sending…" : `Send to ${rfiOpen.rfi.consultantCompany || "the consultant"}`}
                          </button>
                          <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={rfiBusy} onClick={() => void rfiAction(rfiOpen.rfi.id, "void")}>Void draft</button>
                        </div>
                      </div>
                    )}

                    {rfiOpen.messages.filter((m) => m.type === "system").map((m) => (
                      <div className="rf-sys" key={m.id}>{m.body} · {new Date(m.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</div>
                    ))}

                    {rfiOpen.rfi.status !== "draft" && (
                      <div className="rf-card rf-ans">
                        <div className="k">Official response</div>
                        {rfiOpen.messages.filter((m) => m.type === "official_answer").length === 0 ? (
                          ansOpen ? (
                            <div>
                              <textarea className="ev-in" rows={4} autoFocus value={ansText} placeholder="Paste the consultant's emailed answer here - it becomes the locked official response" onChange={(e) => setAnsText(e.target.value)} />
                              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                <button className="lg-btn primary" style={{ height: 38, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} disabled={rfiBusy || !ansText.trim()} onClick={async () => { if (await rfiAction(rfiOpen.rfi.id, "log_answer", { body: ansText })) { setAnsOpen(false); setAnsText(""); } }}>Log it</button>
                                <button className="lg-btn" style={{ height: 38, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} onClick={() => setAnsOpen(false)}>Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
                              <p className="page-sub" style={{ margin: "0 0 10px" }}>Awaiting {rfiOpen.rfi.consultantCompany || "the consultant"}. They can answer from the link in the email - it lands in this thread and stops their clock. Got the answer another way? Log it below.</p>
                              {rfiOpen.rfi.status === "open" && <button className="lg-btn primary" style={{ height: 38, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} onClick={() => setAnsOpen(true)}>Log the answer</button>}
                            </div>
                          )
                        ) : (
                          <>
                            {rfiOpen.messages.filter((m) => m.type === "official_answer").map((m, i, arr) => (
                              <div key={m.id} style={{ marginBottom: i < arr.length - 1 ? 12 : 0 }}>
                                <div className="rf-anstext">{m.body}</div>
                                <div className="rf-ansmeta">{m.authorName ?? "Consultant"} · {new Date(m.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</div>
                              </div>
                            ))}
                            {rfiOpen.rfi.status === "answered" && (
                              <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                                {!rfiOpen.ci && (ciOpen ? (
                                  <div style={{ width: "100%" }}>
                                    <input className="ev-in" value={ciTitle} placeholder="CI title, e.g. Revise A-201 wall thickness to 190" onChange={(e) => setCiTitle(e.target.value)} />
                                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                                      <button className="lg-btn primary" style={{ height: 38, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} disabled={rfiBusy || !ciTitle.trim()} onClick={async () => { if (await rfiAction(rfiOpen.rfi.id, "create_ci", { title: ciTitle })) { setCiOpen(false); setCiTitle(""); } }}>Create the CI</button>
                                      <button className="lg-btn" style={{ height: 38, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} onClick={() => setCiOpen(false)}>Cancel</button>
                                    </div>
                                  </div>
                                ) : (
                                  <button className="lg-btn" style={{ height: 38, margin: 0, width: "auto", padding: "0 14px", fontSize: 13, color: "#0E7A55", borderColor: "rgba(16,185,129,.4)" }} onClick={() => setCiOpen(true)}>This changes the works - create CI</button>
                                ))}
                                <button className="lg-btn primary" style={{ height: 38, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} disabled={rfiBusy} onClick={() => void rfiAction(rfiOpen.rfi.id, "close")}>Accept + close</button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {rfiOpen.ci && (
                      <div className="rf-ciband">✅ Answer spawned CI-{String(rfiOpen.ci.number).padStart(3, "0")} · {rfiOpen.ci.title}. The assistant treats the CI as governing the drawing it amends.</div>
                    )}

                    {rfiOpen.messages.filter((m) => m.type === "followup").map((m) => (
                      <div className="rf-fu" key={m.id}>
                        <div className="who">{m.authorName ?? (m.authorSide === "consultant" ? "Consultant" : "Us")} · {new Date(m.createdAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</div>
                        <div className="body">{m.body}</div>
                      </div>
                    ))}

                    {rfiOpen.rfi.status !== "draft" && rfiOpen.rfi.status !== "void" && (
                      <div className="rf-card">
                        <div className="k">Follow-up</div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <input className="ev-in" style={{ flex: 1 }} value={fuText} placeholder={rfiOpen.rfi.status === "answered" ? "Ask a follow-up - it reopens the RFI and the consultant clock" : "Add context to the thread"} onChange={(e) => setFuText(e.target.value)} />
                          <button className="lg-btn" style={{ height: 42, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} disabled={rfiBusy || !fuText.trim()} onClick={async () => { if (await rfiAction(rfiOpen.rfi.id, "followup", { body: fuText, bounce: rfiOpen.rfi.status === "answered" })) setFuText(""); }}>Send</button>
                        </div>
                        {rfiOpen.rfi.status === "closed" && (
                          <button className="lg-btn" style={{ height: 36, margin: "10px 0 0", width: "auto", padding: "0 14px", fontSize: 12.5 }} disabled={rfiBusy} onClick={() => void rfiAction(rfiOpen.rfi.id, "reopen")}>Reopen this RFI</button>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="rf-rail">
                    <div className="rf-card">
                      <div className="k">Details</div>
                      <div className="rf-kv"><span className="k2">Assigned to</span><span className="v">{[rfiOpen.rfi.consultantName, rfiOpen.rfi.consultantCompany].filter(Boolean).join(" · ") || "-"}</span></div>
                      <div className="rf-kv"><span className="k2">Raised by</span><span className="v">{rfiOpen.rfi.raisedByName ?? "-"}</span></div>
                      <div className="rf-kv"><span className="k2">Priority</span><span className="v">{rfiOpen.rfi.priority}</span></div>
                      <div className="rf-kv"><span className="k2">Location</span><span className="v">{rfiOpen.rfi.location ?? "-"}</span></div>
                      <div className="rf-kv"><span className="k2">Cost impact</span><span className={"v" + (rfiOpen.rfi.costImpact !== "none" ? " warn" : "")}>{rfiOpen.rfi.costImpact}{rfiOpen.rfi.costEstimate ? ` · ${rfiOpen.rfi.costEstimate}` : ""}</span></div>
                      <div className="rf-kv"><span className="k2">Programme</span><span className={"v" + (rfiOpen.rfi.programmeImpact !== "none" ? " warn" : "")}>{rfiOpen.rfi.programmeImpact}{rfiOpen.rfi.programmeDays ? ` · est ${rfiOpen.rfi.programmeDays} days` : ""}</span></div>
                      {rfiOpen.rfi.status !== "void" && (
                        <div className="rf-kv">
                          <span className="k2">Critical path</span>
                          <button
                            className={"rf-cptoggle" + (rfiOpen.rfi.criticalPath ? " on" : "")}
                            disabled={rfiBusy}
                            title="Flag when this RFI is holding up work that sets the finish date"
                            onClick={() => void rfiAction(rfiOpen.rfi.id, "update_impact", { criticalPath: !rfiOpen.rfi.criticalPath })}
                          >
                            {rfiOpen.rfi.criticalPath ? "⚑ On the critical path" : "Flag as critical path"}
                          </button>
                        </div>
                      )}
                      {rfiOpen.rfi.dateRequiredBy && <div className="rf-kv"><span className="k2">Required by</span><span className="v">{new Date(rfiOpen.rfi.dateRequiredBy).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</span></div>}
                      {rfiOpen.rfi.dateAnswered && <div className="rf-kv"><span className="k2">Answered</span><span className="v">{new Date(rfiOpen.rfi.dateAnswered).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}</span></div>}
                    </div>
                    <div className="rf-card">
                      <div className="k">Activity (the audit trail)</div>
                      {rfiOpen.transitions.length === 0 && <div className="page-sub" style={{ margin: 0 }}>Nothing yet.</div>}
                      {rfiOpen.transitions.map((t) => (
                        <div className="rf-aud" key={t.id}>
                          <b>{t.fromStatus ?? "·"} → {t.toStatus}</b>{t.comment ? ` · ${t.comment}` : ""}
                          <small>{t.byName ?? "system"} · {new Date(t.at).toLocaleString("en-NZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
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
            </div>

            {!insightsLoaded ? (
              <div className="page-sub" style={{ marginTop: 18 }}>Loading…</div>
            ) : (insights?.summary.inspections ?? 0) === 0 ? (
              <div className="cal-card" style={{ marginTop: 18 }}>
                <b style={{ color: "var(--navy)" }}>Nothing to learn from yet.</b>
                <p className="page-sub" style={{ margin: "6px 0 12px" }}>Add your council and consultant reports on the Inspections tab. Once a handful are in, this shows what your crew keeps getting pulled up on across every report.</p>
                <button className="lg-btn primary" style={{ height: 42, margin: 0, width: "auto", padding: "0 18px" }} onClick={() => setTab("inspections")}>Go to Inspections</button>
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
                                  {/* The span an item stayed open matters more than its
                                      count — open time is what delays the CCC. Only shown
                                      when it genuinely spans more than one date. */}
                                  {t.firstSeen && t.lastSeen && t.firstSeen !== t.lastSeen && (
                                    <div className="iz-ispan">open {t.firstSeen} → {t.lastSeen}</div>
                                  )}
                                  <div className="iz-itk"><div className="iz-itf" style={{ width: `${Math.round((t.count / maxN) * 100)}%`, background: catColor(selCat) }} /></div>
                                </div>
                                <div className="iz-ic">{t.count}<small>×</small></div>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="iz-ddf"><span className="more">{more > 0 ? `+ ${more} more ${selCat} item${more === 1 ? "" : "s"}` : "All items shown"}</span><span>the number is how many inspections it came up on</span></div>
                      </div>
                    </div>
                  );
                })()}
                </>
                )}

              </>
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
                      `/api/doc-page?m=${encodeURIComponent(sheet.mfr)}&doc=${encodeURIComponent(sheet.doc)}&p=${sheet.page}&v=3`
                    : null
                  : sheet.kind === "determination"
                    ? sheet.ref && sheet.page
                      ? `/api/determination-page?ref=${encodeURIComponent(sheet.ref)}&p=${sheet.page}`
                      : null
                    : sheet.kind === "standard"
                      ? sheet.stdSlug && sheet.page
                        ? `/api/standard-page?ref=${encodeURIComponent(sheet.stdSlug)}&p=${sheet.page}`
                        : null
                      : sheet.kind === "code"
                        ? // Pre-rendered Code pages. Where a page has no stored
                          // render this 404s, the image is hidden, and the
                          // building.govt.nz link below carries the citation —
                          // which is what a Code chip always used to do.
                          sheet.doc && sheet.page
                          ? `/api/code-page?doc=${encodeURIComponent(sheet.doc)}&p=${sheet.page}`
                          : null
                      : projectId && sheet.doc && sheet.page
                        ? `/api/plan-page?project=${encodeURIComponent(projectId)}&doc=${encodeURIComponent(sheet.doc)}&p=${sheet.page}`
                        : null;
              const isMfr = sheet.kind === "manufacturer" || sheet.kind === "determination" || sheet.kind === "standard" || sheet.kind === "code";
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
                      // A Code page we have not rendered yet is an ABSENCE, not
                      // a failure, and the Code is free to read at the source —
                      // so don't tell someone something broke when the honest
                      // thing is "here it is, on MBIE". Every other kind keeps
                      // the error wording, because there the image should have
                      // been there.
                      <div className="sh-msg">
                        {sheet.kind === "code"
                          ? "This clause is published free by MBIE."
                          : `Couldn't load the ${isMfr ? "page" : "sheet"} preview.`}
                        {isMfr && sheet.url && (
                          <><br /><a href={sheet.url} target="_blank" rel="noopener noreferrer">{openLabel(sheet.kind)} ↗</a></>
                        )}
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
                    <div className="src">
                      {sheet.kind === "manufacturer"
                        ? `📕 FROM ${(sheet.mfr || "THE MANUFACTURER").toUpperCase()}’S MANUAL`
                        : sheet.kind === "determination"
                          ? "⚖️ FROM AN MBIE DETERMINATION"
                          : sheet.kind === "standard"
                            ? `📘 FROM ${(sheet.code || "THE NZS STANDARD").toUpperCase()}`
                            : sheet.kind === "code"
                              ? "📖 FROM THE NZ BUILDING CODE"
                              : "📐 ANSWER FROM THIS SHEET"}
                    </div>
                    <p dangerouslySetInnerHTML={{ __html: sheet.ans }} />
                    {isMfr && sheet.url && (
                      <a className="sh-open" href={sheet.url} target="_blank" rel="noopener noreferrer">
                        {openLabel(sheet.kind)}{sheet.kind === "code" ? "" : ` on ${hostOf(sheet.url)}`} ↗
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
      {/* ─── pin stage: full-screen sheet browser (Foundation 2). From Plans it
           is also the QA-flag surface (Feature 7): tap to pin a mistake, tap a
           flag pin to open its card. ─── */}
      {pinStage && projectId && (
        <PinStage
          key={pinStage.doc}
          projectId={projectId}
          doc={pinStage.doc}
          page={pinStage.page}
          npages={pinStage.npages}
          sheets={docs.map((d) => ({ doc: d.doc, npages: Math.max(d.indexed, 1) }))}
          onSwitchSheet={(doc, npages) => setPinStage({ doc, page: 1, npages })}
          onClose={() => setPinStage(null)}
          fetchApi={apiFetch}
          refresh={pinRefresh}
          onDrop={(at) => void dropFlag(at)}
          onPinClick={(pin) => { if (pin.recordType === "qa_flag") void openFlagById(pin.recordId); }}
        />
      )}

      {/* ─── new QA flag (Feature 7): dropped a pin, describe the issue ─── */}
      {flagAt && pinStage && (
        <div className="scrim" style={{ zIndex: 130 }} onClick={() => { if (!flagBusy) setFlagAt(null); }}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New flag</b><small>{pinStage.doc} · p{flagAt.page}</small></div>
              {!flagBusy && <button className="sh-x" onClick={() => setFlagAt(null)}>✕</button>}
            </div>
            <div className="form-body">
              <label className="ev-lbl">What&apos;s the issue</label>
              <input className="ev-in" autoFocus value={flTitle} placeholder="e.g. Fire collar not installed properly" onChange={(e) => setFlTitle(e.target.value)} />
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Trade</label>
                  <select className="ev-in" value={flTrade} onChange={(e) => setFlTrade(e.target.value)}>
                    <option value="">Pick one…</option>
                    {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Assign to sub</label>
                  <select className="ev-in" value={flSub} onChange={(e) => setFlSub(e.target.value)}>
                    <option value="">Decide later</option>
                    {subsList.map((s) => <option key={s.id} value={s.id}>{s.name}{s.trade ? ` (${s.trade})` : ""}</option>)}
                  </select>
                </div>
              </div>
              <label className="ev-lbl" style={{ marginTop: 12 }}>Note</label>
              <textarea className="ev-in" rows={2} value={flNote} placeholder="What needs doing, and where." onChange={(e) => setFlNote(e.target.value)} />
              {flagErr && <div className="ev-err">{flagErr}</div>}
              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={flagBusy || !flTitle.trim()} onClick={() => void saveFlag()}>
                  {flagBusy ? "Saving…" : "Save flag"}
                </button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={flagBusy} onClick={() => setFlagAt(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── flag card (Feature 7): the pinned issue + its actions ─── */}
      {flagView && (
        <div className="scrim" style={{ zIndex: 130 }} onClick={() => { if (!flagBusy) setFlagView(null); }}>
          <div className="sheet" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>Flag {flagView.n} · {flagView.title}</b>
                <small>{[flagView.trade, `${flagView.doc} · p${flagView.page}`].filter(Boolean).join(" · ")}</small>
              </div>
              {!flagBusy && <button className="sh-x" onClick={() => setFlagView(null)}>✕</button>}
            </div>
            <div className="form-body">
              {flagNotice && <div className="ck-notice" onClick={() => setFlagNotice(null)}>{flagNotice}</div>}
              {flagView.note && <p className="page-sub" style={{ margin: "0 0 12px" }}>{flagView.note}</p>}
              <div className="rf-kv"><span className="k2">Status</span><span className="v">{flagView.status === "done" ? `Fixed${flagView.fixedAt ? ` · ${new Date(flagView.fixedAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : ""}` : flagView.status === "sent" ? "Sent · awaiting fix" : "Not sent"}</span></div>
              {flagView.subName && (
                <div className="rf-kv"><span className="k2">{flagView.sentAt ? (flagView.sentStatus === "sent" ? "Emailed to" : "Recorded for") : "Assigned to"}</span><span className="v">{flagView.subName}{flagView.sentAt ? ` · ${new Date(flagView.sentAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : ""}</span></div>
              )}
              {!flagView.subName && flagView.status !== "done" && (
                <div style={{ marginTop: 10 }}>
                  <label className="ev-lbl">Send to</label>
                  <select className="ev-in" value={flagSendSub} onChange={(e) => setFlagSendSub(e.target.value)}>
                    <option value="">Pick the sub…</option>
                    {subsList.map((s) => <option key={s.id} value={s.id}>{s.name}{s.trade ? ` (${s.trade})` : ""}</option>)}
                  </select>
                  <div style={{ marginTop: 8 }}>
                    {flagNewSubOpen ? (
                      <div className="dir-add" style={{ marginBottom: 0 }}>
                        <div className="dir-grid">
                          <input className="ev-in" autoFocus value={fns.name} placeholder="Fire Protection Ltd" onChange={(e) => setFns((v) => ({ ...v, name: e.target.value }))} />
                          <select className="ev-in" value={fns.trade} onChange={(e) => setFns((v) => ({ ...v, trade: e.target.value }))}>
                            <option value="">Trade…</option>
                            {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input className="ev-in" type="email" value={fns.email} placeholder="office@fireprotection.co.nz" onChange={(e) => setFns((v) => ({ ...v, email: e.target.value }))} />
                        </div>
                        {fnsErr && <div className="ev-err">{fnsErr}</div>}
                        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                          <button className="dir-act" disabled={fnsBusy || !fns.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fns.email.trim())} onClick={() => void addFlagSub()}>{fnsBusy ? "Saving…" : "Save sub"}</button>
                          <button className="dir-act" disabled={fnsBusy} onClick={() => setFlagNewSubOpen(false)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="dir-link" onClick={() => { setFnsErr(null); setFns({ name: "", trade: flagView.trade ?? "", email: "" }); setFlagNewSubOpen(true); }}>+ New sub</button>
                    )}
                  </div>
                </div>
              )}
              {flagErr && <div className="ev-err">{flagErr}</div>}
              <div className="form-actions" style={{ flexWrap: "wrap" }}>
                {flagView.status !== "done" && (
                  <button className="lg-btn primary" style={{ height: 44, margin: 0, flex: 1, minWidth: 150 }} disabled={flagBusy || (!flagView.subName && !flagSendSub)}
                    onClick={() => void flagAction(flagView.id, "send", flagSendSub ? { subId: flagSendSub } : {})}>
                    {flagBusy ? "Sending…" : flagView.sentAt ? "Resend / remind" : "Send to sub + record"}
                  </button>
                )}
                {flagView.status !== "done" ? (
                  <button className="lg-btn" style={{ height: 44, margin: 0, width: "auto", padding: "0 16px" }} disabled={flagBusy} onClick={() => void flagAction(flagView.id, "done")}>Mark fixed</button>
                ) : (
                  <button className="lg-btn" style={{ height: 44, margin: 0, width: "auto", padding: "0 16px" }} disabled={flagBusy} onClick={() => void flagAction(flagView.id, "reopen")}>Reopen</button>
                )}
                <button className="lg-btn" style={{ height: 44, margin: 0, width: "auto", padding: "0 14px", color: "var(--red)" }} disabled={flagBusy}
                  onClick={async () => {
                    if (!window.confirm("Delete this flag and its pin?")) return;
                    const r = await apiFetch(`/api/flags?id=${encodeURIComponent(flagView.id)}`, { method: "DELETE" });
                    if (r.ok) { setFlagView(null); setPinRefresh((n) => n + 1); }
                    else setFlagErr("Couldn't delete it just now.");
                  }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── send failed inspection items to subs (Feature 6) ─── */}
      {insSendOpen && openInspection && (
        <div className="scrim" style={{ zIndex: 130 }} onClick={() => { if (!insBusy) setInsSendOpen(false); }}>
          {/* zIndex 130: this modal sits in the DOM before the inspection dialog
              it opens FROM, so at the shared .scrim level it painted underneath
              and the button looked dead. Matches the flag modals' layer. */}
          <div className="sheet" style={{ maxWidth: 530, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>Send failed items to subs</b><small>{openInspection.inspection.inspectionType || openInspection.inspection.doc}</small></div>
              {!insBusy && <button className="sh-x" onClick={() => setInsSendOpen(false)}>✕</button>}
            </div>
            <div className="form-body">
              {openInspection.items.map((it, i) => (it.workStatus ?? "not_done") !== "done" ? (
                <div key={it.id} className="sf-row">
                  <div className="sf-txt">
                    <b>{i + 1}. {it.title}</b>
                    <small>{[it.category, it.location].filter(Boolean).join(" · ") || "inspection item"}</small>
                  </div>
                </div>
              ) : null)}

              {renderRecipients()}

              <label className="ev-lbl" style={{ marginTop: 14 }}>Message (top of the email)</label>
              <textarea
                className="ev-in" rows={2} value={insSendMsg}
                placeholder="The inspection failed these items - please work through the list and reply when each is done."
                onChange={(e) => setInsSendMsg(e.target.value)}
              />
              <p className="page-sub" style={{ margin: "10px 0 0" }}>
                Everyone picked gets the full list in one email, in the inspector&apos;s own words. Every send is recorded on the items and the project log.
              </p>
              {insErr && <div className="ev-err">{insErr}</div>}
              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={insBusy} onClick={() => void sendInsItems()}>
                  {insBusy ? "Sending…" : "Send + record"}
                </button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={insBusy} onClick={() => setInsSendOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── New RFI (Feature 5) ─── */}
      {newRfiOpen && (
        <div className="scrim" onClick={() => { if (!rfiBusy) setNewRfiOpen(false); }}>
          <div className="sheet" style={{ maxWidth: 600, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New RFI</b><small>{projName}</small></div>
              {!rfiBusy && <button className="sh-x" onClick={() => setNewRfiOpen(false)}>✕</button>}
            </div>
            <div className="form-body">
              <div className="fld" style={{ marginBottom: 12 }}>
                <label className="ev-lbl">Subject</label>
                <input className="ev-in" value={nr.subject} placeholder="e.g. Lintel fixing at grid C3, Level 1" onChange={(e) => setNr((v) => ({ ...v, subject: e.target.value }))} />
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Discipline</label>
                  <select className="ev-in" value={nr.discipline} onChange={(e) => setNr((v) => ({ ...v, discipline: e.target.value }))}>
                    <option value="">Pick one…</option>
                    {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Priority</label>
                  <select className="ev-in" value={nr.priority} onChange={(e) => setNr((v) => ({ ...v, priority: e.target.value }))}>
                    <option value="normal">Normal</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Location</label>
                  <input className="ev-in" value={nr.location} placeholder="Level 1 · grid C3" onChange={(e) => setNr((v) => ({ ...v, location: e.target.value }))} />
                </div>
              </div>
              <label className="ev-lbl" style={{ marginTop: 14, fontSize: 12.5, color: "var(--navy)" }}>The question</label>
              <textarea className="ev-in" rows={7} style={{ fontSize: 15, lineHeight: 1.5 }} value={nr.question} placeholder="What needs answering? Put the drawing and any figures right in the text." onChange={(e) => setNr((v) => ({ ...v, question: e.target.value }))} />
              {/* Saved-consultant picker (the Directory). Picking fills the free-text
                  fields below; typing fresh details still works, and whoever the RFI
                  is sent to is saved back into the Directory automatically. */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <label className="ev-lbl" style={{ margin: 0 }}>Consultant</label>
                <button type="button" className="dir-link" style={{ marginLeft: "auto" }} onClick={() => openDirectory("consultants")}>Manage directory</button>
              </div>
              {conList.length > 0 && (
                <select className="ev-in" style={{ marginTop: 6 }} value={nrCon} onChange={(e) => {
                  setNrCon(e.target.value);
                  const c = conList.find((x) => x.id === e.target.value);
                  if (c) setNr((v) => ({ ...v, consultantName: c.name ?? "", consultantCompany: c.company ?? "", consultantEmail: c.email, discipline: c.discipline ?? v.discipline }));
                }}>
                  <option value="">Pick a saved consultant - fills the fields below…</option>
                  {conList.map((c) => <option key={c.id} value={c.id}>{[c.name, c.company, c.discipline].filter(Boolean).join(" - ") || c.email}</option>)}
                </select>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Assign to</label>
                  <input className="ev-in" value={nr.consultantName} placeholder="Jane Smith" onChange={(e) => setNr((v) => ({ ...v, consultantName: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Their company</label>
                  <input className="ev-in" value={nr.consultantCompany} placeholder="Holmes Structural" onChange={(e) => setNr((v) => ({ ...v, consultantCompany: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Their email</label>
                  <input className="ev-in" type="email" value={nr.consultantEmail} placeholder="jane@holmes.co.nz" onChange={(e) => setNr((v) => ({ ...v, consultantEmail: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Cc</label>
                  <input className="ev-in" value={nr.cc} placeholder="everyone else who should know" onChange={(e) => setNr((v) => ({ ...v, cc: e.target.value }))} />
                </div>
              </div>

              <label className="ev-lbl" style={{ marginTop: 14 }}>Impact <span style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500, color: "var(--mut)" }}>· drives the tracking and the EOT pack</span></label>
              <div style={{ display: "flex", gap: 10 }}>
                <select className="ev-in" style={{ flex: 1 }} value={nr.costImpact} onChange={(e) => setNr((v) => ({ ...v, costImpact: e.target.value }))}>
                  <option value="none">Cost impact: none</option>
                  <option value="unknown">Cost impact: unknown</option>
                  <option value="yes">Cost impact: yes</option>
                </select>
                <select className="ev-in" style={{ flex: 1 }} value={nr.programmeImpact} onChange={(e) => setNr((v) => ({ ...v, programmeImpact: e.target.value }))}>
                  <option value="none">Programme impact: none</option>
                  <option value="unknown">Programme impact: unknown</option>
                  <option value="yes">Programme impact: yes</option>
                </select>
              </div>
              {(nr.costImpact === "yes" || nr.programmeImpact === "yes") && (
                <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
                  {nr.costImpact === "yes" && <input className="ev-in" style={{ flex: 1 }} value={nr.costEstimate} placeholder="Cost estimate, e.g. ~$8,500" onChange={(e) => setNr((v) => ({ ...v, costEstimate: e.target.value }))} />}
                  {nr.programmeImpact === "yes" && <input className="ev-in" style={{ flex: 1 }} type="number" min="1" value={nr.programmeDays} placeholder="Days lost, e.g. 3" onChange={(e) => setNr((v) => ({ ...v, programmeDays: e.target.value }))} />}
                </div>
              )}
              <label className={"rf-cpbox" + (nr.criticalPath ? " on" : "")} style={{ marginTop: 10 }}>
                <input type="checkbox" checked={nr.criticalPath} onChange={(e) => setNr((v) => ({ ...v, criticalPath: e.target.checked }))} />
                <span><b>Critical path</b> - this RFI is holding up work that sets the project finish date. Flags it for the EOT evidence pack.</span>
              </label>

              <p className="page-sub" style={{ margin: "12px 0 0" }}>
                The person you assign is who the response clock and the consultant scorecard count against. Cc is just kept in the loop. Send burns the next RFI number, emails the assignee from this site&apos;s Soterra address (replies land in your inbox), starts the 7 working-day clock, and writes the audit line. A draft burns nothing. Pin a drawing from the RFI once it&apos;s created.
              </p>
              {rfiErr && <div className="ev-err">{rfiErr}</div>}
              <div className="form-actions">
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 18px" }} disabled={rfiBusy || !nr.subject.trim() || !nr.question.trim()} onClick={() => void createRfi(false)}>Save draft</button>
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={rfiBusy || !nr.subject.trim() || !nr.question.trim() || !nr.consultantEmail.trim()} onClick={() => void createRfi(true)}>
                  {rfiBusy ? "Sending…" : "Send RFI"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── the Directory (address book): consultants + subs, edit in place ─── */}
      {dirOpen && (
        <div className="scrim" style={{ zIndex: 140 }} onClick={() => { if (!dirBusy) setDirOpen(false); }}>
          {/* zIndex 140: opens on top of the New RFI form and the flag card. */}
          <div className="sheet" style={{ maxWidth: 560, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>Directory</b><small>Company-wide - saved once, used on every site</small></div>
              {!dirBusy && <button className="sh-x" onClick={() => setDirOpen(false)}>✕</button>}
            </div>
            <div className="form-body">
              <div className="rf-vs" style={{ marginBottom: 14 }}>
                <button className={"rf-vsb" + (dirTab === "consultants" ? " act" : "")} onClick={() => { setDirTab("consultants"); setDirEdit(null); setDirErr(null); }}>Consultants</button>
                <button className={"rf-vsb" + (dirTab === "subs" ? " act" : "")} onClick={() => { setDirTab("subs"); setDirEdit(null); setDirErr(null); }}>Subs</button>
              </div>

              <div className="dir-add">
                <div className="dir-grid">
                  <input className="ev-in" value={dirForm.name} placeholder={dirTab === "consultants" ? "Jane Smith" : "Fire Protection Ltd"} onChange={(e) => setDirForm((v) => ({ ...v, name: e.target.value }))} />
                  {dirTab === "consultants" && (
                    <input className="ev-in" value={dirForm.company} placeholder="Holmes Structural" onChange={(e) => setDirForm((v) => ({ ...v, company: e.target.value }))} />
                  )}
                  {dirTab === "consultants" ? (
                    <select className="ev-in" value={dirForm.discipline} onChange={(e) => setDirForm((v) => ({ ...v, discipline: e.target.value }))}>
                      <option value="">Discipline…</option>
                      {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <select className="ev-in" value={dirForm.trade} onChange={(e) => setDirForm((v) => ({ ...v, trade: e.target.value }))}>
                      <option value="">Trade…</option>
                      {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  <input className="ev-in" type="email" value={dirForm.email} placeholder={dirTab === "consultants" ? "jane@holmes.co.nz" : "office@fireprotection.co.nz"} onChange={(e) => setDirForm((v) => ({ ...v, email: e.target.value }))} />
                </div>
                <button
                  className="lg-btn primary" style={{ height: 40, margin: "10px 0 0", fontSize: 13.5 }}
                  disabled={dirBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dirForm.email.trim()) || (dirTab === "subs" && !dirForm.name.trim())}
                  onClick={() => void dirCreate()}
                >
                  {dirTab === "consultants" ? "Add consultant" : "Add sub"}
                </button>
              </div>

              {dirErr && <div className="ev-err" style={{ marginTop: 0, marginBottom: 12 }}>{dirErr}</div>}

              {dirTab === "consultants" && conList.length === 0 && (
                <p className="page-sub" style={{ margin: 0 }}>No consultants saved yet. Add one above - or just send an RFI: whoever you send to is saved here automatically.</p>
              )}
              {dirTab === "subs" && subsList.length === 0 && (
                <p className="page-sub" style={{ margin: 0 }}>No subs saved yet - add the first one above.</p>
              )}

              {dirTab === "consultants" && conList.map((c) => dirEdit?.id === c.id ? (
                <div key={c.id} className="dir-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dir-grid">
                      <input className="ev-in" value={dirEdit.name} placeholder="Jane Smith" onChange={(e) => setDirEdit((v) => v && { ...v, name: e.target.value })} />
                      <input className="ev-in" value={dirEdit.company} placeholder="Holmes Structural" onChange={(e) => setDirEdit((v) => v && { ...v, company: e.target.value })} />
                      <select className="ev-in" value={dirEdit.discipline} onChange={(e) => setDirEdit((v) => v && { ...v, discipline: e.target.value })}>
                        <option value="">Discipline…</option>
                        {DISCIPLINES.map((d) => <option key={d} value={d}>{d}</option>)}
                      </select>
                      <input className="ev-in" type="email" value={dirEdit.email} placeholder="jane@holmes.co.nz" onChange={(e) => setDirEdit((v) => v && { ...v, email: e.target.value })} />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button className="dir-act" disabled={dirBusy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dirEdit.email.trim())} onClick={() => void dirSaveEdit()}>{dirBusy ? "Saving…" : "Save"}</button>
                      <button className="dir-act" disabled={dirBusy} onClick={() => setDirEdit(null)}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={c.id} className="dir-row">
                  <div className="dir-txt">
                    <b>{c.name || c.email}</b>
                    <small>{[c.company, c.discipline, c.email].filter(Boolean).join(" · ")}</small>
                  </div>
                  <button className="dir-act" disabled={dirBusy} onClick={() => setDirEdit({ id: c.id, name: c.name ?? "", company: c.company ?? "", discipline: c.discipline ?? "", trade: "", email: c.email })}>Edit</button>
                  <button className="dir-act del" disabled={dirBusy} onClick={() => void dirDelete(c.id, c.name || c.email)}>Remove</button>
                </div>
              ))}

              {dirTab === "subs" && subsList.map((s) => dirEdit?.id === s.id ? (
                <div key={s.id} className="dir-row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="dir-grid">
                      <input className="ev-in" value={dirEdit.name} placeholder="Fire Protection Ltd" onChange={(e) => setDirEdit((v) => v && { ...v, name: e.target.value })} />
                      <select className="ev-in" value={dirEdit.trade} onChange={(e) => setDirEdit((v) => v && { ...v, trade: e.target.value })}>
                        <option value="">Trade…</option>
                        {TRADES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input className="ev-in" type="email" value={dirEdit.email} placeholder="office@fireprotection.co.nz" onChange={(e) => setDirEdit((v) => v && { ...v, email: e.target.value })} />
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button className="dir-act" disabled={dirBusy || !dirEdit.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dirEdit.email.trim())} onClick={() => void dirSaveEdit()}>{dirBusy ? "Saving…" : "Save"}</button>
                      <button className="dir-act" disabled={dirBusy} onClick={() => setDirEdit(null)}>Cancel</button>
                    </div>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="dir-row">
                  <div className="dir-txt">
                    <b>{s.name}</b>
                    <small>{[s.trade, s.email].filter(Boolean).join(" · ")}</small>
                  </div>
                  <button className="dir-act" disabled={dirBusy} onClick={() => setDirEdit({ id: s.id, name: s.name, company: "", discipline: "", trade: s.trade ?? "", email: s.email })}>Edit</button>
                  <button className="dir-act del" disabled={dirBusy} onClick={() => void dirDelete(s.id, s.name)}>Remove</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── send the Needs-fixing items to subs (Feature 4 finish) ─── */}
      {sendOpen && openChecklist && (
        <div className="scrim" style={{ zIndex: 130 }} onClick={() => { if (!sendBusy) setSendOpen(false); }}>
          {/* zIndex 130: same stacking fix as the inspection send modal. */}
          <div className="sheet" style={{ maxWidth: 530, maxHeight: "88vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>Send fixes to subs</b><small>{openChecklist.checklist.title}</small></div>
              {!sendBusy && <button className="sh-x" onClick={() => setSendOpen(false)}>✕</button>}
            </div>
            <div className="form-body">
              {openChecklist.items.map((it, i) => it.status === "issue" ? (
                <div key={it.id} className="sf-row">
                  <div className="sf-txt">
                    <b>{i + 1}. {it.title}</b>
                    <small>{[it.category, it.pins?.length ? "📍 pinned" : null, it.photos.length ? `${it.photos.length} photo${it.photos.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || "no extras"}</small>
                  </div>
                </div>
              ) : null)}

              {renderRecipients()}

              <label className="ev-lbl" style={{ marginTop: 14 }}>Message (top of the email)</label>
              <textarea
                className="ev-in" rows={2} value={sendMsg}
                placeholder={`Hi team, these came up on today's ${openChecklist.checklist.title}. Please put them right and reply with a photo when done.`}
                onChange={(e) => setSendMsg(e.target.value)}
              />
              <p className="page-sub" style={{ margin: "10px 0 0" }}>
                Everyone picked gets the full list in one email, from {projName ? `your ${projName}` : "this site's"} Soterra address - pins, photos and notes ride along, and replies land in your own inbox. Every send is recorded on the items and the project log.
              </p>

              {sendErr && <div className="ev-err">{sendErr}</div>}

              <div className="form-actions">
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={sendBusy} onClick={() => void sendFixes()}>
                  {sendBusy ? "Sending…" : "Send + record"}
                </button>
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 20px" }} disabled={sendBusy} onClick={() => setSendOpen(false)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── pinning a checklist item on its drawing (Feature 4) ─── */}
      {pinFor && projectId && (
        <PinStage
          key={"pin-" + pinFor.itemId}
          projectId={projectId}
          doc={pinFor.doc}
          page={pinFor.page}
          npages={pinFor.npages}
          sheets={pinFor.sheets}
          onSwitchSheet={(doc, npages) => setPinFor((f) => (f ? { ...f, doc, page: 1, npages } : f))}
          onClose={() => setPinFor(null)}
          fetchApi={apiFetch}
          onDrop={async (at) => {
            const target = pinFor;
            try {
              const res = await apiFetch("/api/pins", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ doc: target.doc, page: at.page, x: at.x, y: at.y, recordType: "checklist_item", recordId: target.itemId, label: target.label }),
              });
              if (!res.ok) throw new Error();
              setPinFor(null);
              if (openChecklist) openChecklistById(openChecklist.checklist.id);
            } catch {
              setClErr("Couldn't save the pin — try again.");
              setPinFor(null);
            }
          }}
        />
      )}

      {zoomImg && (
        <div ref={zoomScrimRef} className="zoomscrim" onClick={() => { setZoomImg(null); setZoomScale(1); }}
          onPointerDown={(e) => {
            // Drag to pan when zoomed in. Scrollbars alone are painful on a
            // laptop, and this is the screen where someone reads fine print.
            if (zoomScale === 1 || e.button !== 0) return;
            const el = zoomScrimRef.current;
            if (!el) return;
            const sx = e.clientX, sy = e.clientY;
            const l0 = el.scrollLeft, t0 = el.scrollTop;
            let moved = false;
            const move = (m: PointerEvent) => {
              if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 3) moved = true;
              el.scrollLeft = l0 - (m.clientX - sx);
              el.scrollTop = t0 - (m.clientY - sy);
            };
            const up = () => {
              window.removeEventListener("pointermove", move);
              window.removeEventListener("pointerup", up);
              // A drag must not also register as the click that closes or
              // toggles zoom, so swallow the next click only if we moved.
              if (moved) window.addEventListener("click", (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
            };
            window.addEventListener("pointermove", move);
            window.addEventListener("pointerup", up);
          }}
        >
          {/* Scroll or pinch to zoom smoothly; tap steps in and back to fit.
              When zoomed, drag to pan around the fine print. */}
          <img
            className="zoomimg"
            src={zoomImg}
            alt="Full page"
            draggable={false}
            style={zoomScale === 1
              ? { maxWidth: "100%", maxHeight: "calc(100vh - 96px)", cursor: "zoom-in" }
              : { width: `${zoomScale * 100}%`, maxWidth: "none", maxHeight: "none", cursor: "grab" }}
            onClick={(e) => { e.stopPropagation(); setZoomScale((s) => (s >= 3 ? 1 : s + 0.5)); }}
          />
          <div className="zoomctl" onClick={(e) => e.stopPropagation()}>
            <button aria-label="Zoom out" onClick={() => setZoomScale((s) => Math.max(1, Math.round((s - 0.25) * 100) / 100))}>−</button>
            <span>{Math.round(zoomScale * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => setZoomScale((s) => Math.min(6, Math.round((s + 0.25) * 100) / 100))}>+</button>
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
                {curProject?.role === "admin" && (
                  <button className="lg-btn" style={{ height: 48, margin: 0, width: "auto", padding: "0 14px" }} title="Get a new code — the old one stops working" onClick={rotateCode}>New code</button>
                )}
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
                    {/* Admin-only crew controls. The server re-checks the role and
                        refuses to strand the site without an admin, so these can
                        afford to be plain buttons. Not shown on your own row:
                        removing yourself or demoting yourself is how a site gets
                        orphaned in a hurry. */}
                    {curProject?.role === "admin" && !m.isMe && (
                      <>
                        {/* Its own class, not row-x: that one's hover is a
                            destructive red, which is the wrong colour to show
                            on "Make admin", and its zeroed padding left an
                            11px tap target. */}
                        <button className="crew-role" title={m.role === "admin" ? "Make crew" : "Make admin"} onClick={() => toggleRole(m)}>
                          {m.role === "admin" ? "Make crew" : "Make admin"}
                        </button>
                        <button className="row-x" style={{ opacity: 1 }} title={`Remove ${m.name} from this site`} onClick={() => removeMember(m)}>✕</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
              {crewErr && <div className="ev-err" style={{ marginTop: 10 }}>{crewErr}</div>}
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
                  <label className="ev-lbl" style={{ marginTop: 14 }}>Where are you checking</label>
                  <div className="loc-pick">
                    <button type="button" className={"loc-chip" + (newClLoc === null ? " act" : "")} onClick={() => { setNewClLoc(null); setNewClLocCustom(""); }}>Whole job</button>
                    {newClLocs.map((l) => (
                      <button type="button" key={l.label} className={"loc-chip" + (newClLoc === l.label ? " act" : "")} onClick={() => { setNewClLoc(l.label); setNewClLocCustom(""); }}>
                        {l.label}
                        {l.drawings.length > 0 ? <small> · {l.drawings.length} dwg{l.drawings.length === 1 ? "" : "s"}</small> : l.source === "user" ? <small> · yours</small> : null}
                      </button>
                    ))}
                  </div>
                  <input
                    className="ev-in"
                    style={{ marginTop: 8 }}
                    value={newClLocCustom}
                    placeholder="…or type your own zone (e.g. east corridor)"
                    onChange={(e) => { setNewClLocCustom(e.target.value); setNewClLoc(e.target.value.trim() || null); }}
                  />
                  <p className="page-sub" style={{ margin: "12px 0 0" }}>
                    {newClLocs.length > 0
                      ? "Locations come from the names of your uploaded drawings. Pick one and the check scopes to that location's sheets — and the report is titled by it."
                      : "Soterra writes the check from three places: this site's drawings, the Building Code, and what your company has already been failed on. Every item says where it came from, and anything it can't back up gets left out."}
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
          {/* maxHeight left to .sheet, which subtracts the iPhone safe areas. */}
          <div className="sheet" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>{openChecklist.checklist.title}</b>
                <small>{openChecklist.checklist.status === "done" ? "✓ Marked done · saved under Insights › Checks · " : ""}{openChecklist.items.filter((i) => i.status !== "pending").length} of {openChecklist.items.length} done{openChecklist.items.some((i) => i.status === "issue") ? ` · ${openChecklist.items.filter((i) => i.status === "issue").length} to fix` : ""}</small>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button className="lg-btn" style={{ height: 34, margin: 0, width: "auto", padding: "0 12px", fontSize: 12.5 }} onClick={downloadChecklistPdf} title="Download this as a PDF">⬇ PDF</button>
                <button className="sh-x" onClick={() => setOpenChecklist(null)}>✕</button>
              </div>
            </div>
            <div className="dm-body">
              {clErr && <div className="ev-err" style={{ marginBottom: 12 }}>{clErr}</div>}
              {sendNotice && <div className="ck-notice" onClick={() => setSendNotice(null)}>{sendNotice}</div>}
              {openChecklist.items.map((it, itIdx) => (
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
                    <button type="button" className={"ev-kind" + (it.status === "ok" ? " act" : "")} onClick={() => setItemStatus(it.id, it.status === "ok" ? "pending" : "ok")}>{openChecklist.checklist.kind === "swms" ? "✓ In place" : "✓ Good"}</button>
                    <button type="button" className={"ev-kind" + (it.status === "issue" ? " act" : "")} onClick={() => setItemStatus(it.id, it.status === "issue" ? "pending" : "issue")}>{openChecklist.checklist.kind === "swms" ? "Not yet" : "Needs fixing"}</button>
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
                    {openChecklist.checklist.kind !== "swms" && (
                      <button onClick={() => void openPinFor(it, itIdx + 1)}>📍 {it.pins?.length ? `Pinned (${it.pins.length})` : "Pin on drawing"}</button>
                    )}
                    {it.checkedByName && <span className="ck-by">{it.checkedByName}</span>}
                  </div>
                  {it.sentTo && (
                    <div className="ck-sent" style={it.sentStatus !== "sent" ? { color: "var(--slate)" } : undefined}>
                      {it.sentStatus === "sent" ? "✉ Sent to" : "🕓 Recorded for"} {it.sentTo}
                      {it.sentAt ? ` · ${new Date(it.sentAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : ""}
                      {it.sentStatus === "sent" ? " · recorded" : " · emails when sending goes live"}
                    </div>
                  )}
                </div>
              ))}
              {openChecklist.items.length === 0 && <div className="page-sub" style={{ marginBottom: 0 }}>This check has no items.</div>}
              {openChecklist.checklist.kind !== "swms" && openChecklist.items.some((i) => i.status === "issue") && (
                <div className="ck-sendbar">
                  <div className="cs-txt">
                    <b>{openChecklist.items.filter((i) => i.status === "issue").length} need{openChecklist.items.filter((i) => i.status === "issue").length === 1 ? "s" : ""} fixing</b>
                    <small>Email each one to the sub responsible. Pins, photos and notes ride along, and it&apos;s recorded on the item.</small>
                  </div>
                  <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 16px", fontSize: 13.5, flexShrink: 0 }} onClick={() => void openSendFixes()}>Send to subs</button>
                </div>
              )}
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
      <input ref={photoInputRef} type="file" accept="image/*" capture="environment" style={HIDDEN_INPUT}
        onChange={(e) => { const f = filesFrom(e.target)[0]; if (photoInputRef.current) photoInputRef.current.value = ""; if (f) onPhotoPicked(f); }} />

      {/* ─── one past inspection, and what it picked up ─── */}
      {openInspection && (
        <div className="scrim" onClick={() => setOpenInspection(null)}>
          {/* maxHeight left to .sheet, which subtracts the iPhone safe areas. */}
          <div className="sheet" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti">
                <b>{openInspection.inspection.inspectionType || openInspection.inspection.doc}</b>
                <small>{[openInspection.inspection.inspectedOn, openInspection.inspection.projectName, outcomeChip(openInspection.inspection.source, openInspection.inspection.outcome, openInspection.inspection.itemCount).label].filter(Boolean).join(" · ")}</small>
              </div>
              <button className="sh-x" onClick={() => setOpenInspection(null)}>✕</button>
            </div>
            <div className="dm-body">
              {insNotice && <div className="ck-notice" onClick={() => setInsNotice(null)}>{insNotice}</div>}
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
                      <div className="ins-work">
                        {(["not_done", "in_progress", "done"] as const).map((ws) => (
                          <button key={ws} className={"ins-ws" + ((it.workStatus ?? "not_done") === ws ? " act " + ws : "")} onClick={() => void setInsItemStatus(it.id, ws)}>
                            {ws === "not_done" ? "Not done" : ws === "in_progress" ? "In progress" : "Done"}
                          </button>
                        ))}
                      </div>
                      {it.sentTo && (
                        <div className="ck-sent" style={it.sentStatus !== "sent" ? { color: "var(--slate)" } : undefined}>
                          {it.sentStatus === "sent" ? "✉ Sent to" : "🕓 Recorded for"} {it.sentTo}
                          {it.sentAt ? ` · ${new Date(it.sentAt).toLocaleDateString("en-NZ", { day: "numeric", month: "short" })}` : ""}
                          {it.sentStatus === "sent" ? "" : " · emails when sending goes live"}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {openInspection.items.some((i) => (i.workStatus ?? "not_done") !== "done") && (
                <div className="ck-sendbar">
                  <div className="cs-txt">
                    <b>{openInspection.items.filter((i) => (i.workStatus ?? "not_done") !== "done").length} still to close out</b>
                    <small>Email each failed item to the sub responsible, in the inspector&apos;s own words. Recorded on the item until it&apos;s done.</small>
                  </div>
                  <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 16px", fontSize: 13.5, flexShrink: 0 }} onClick={() => void openInsSend()}>Send to subs</button>
                </div>
              )}
              {/* A badly-read report used to be permanent — the only correction
                  was re-uploading a file with the same name. Delete + re-upload
                  is the honest fix, and its items leave the counts with it. */}
              <div className="form-actions" style={{ marginTop: 14 }}>
                <button
                  className="lg-btn"
                  style={{ height: 44, margin: 0, width: "auto", padding: "0 18px" }}
                  onClick={async () => {
                    if (!window.confirm("Delete this report from the history? Its items come out of the counts too. Re-upload the PDF to file it again.")) return;
                    const res = await apiFetch(`/api/inspections?id=${encodeURIComponent(openInspection.inspection.id)}`, { method: "DELETE" });
                    if (res.ok) {
                      setOpenInspection(null);
                      loadInsights(catFilter);
                    } else {
                      // Every other mutation surfaces its failure; a delete that
                      // silently does nothing reads as a broken button.
                      window.alert("Couldn't delete that report just now — try again.");
                    }
                  }}
                >
                  Delete report
                </button>
              </div>
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
  access: string; setAccess: (v: string) => void;
  /** Only the first site names the company — later ones inherit it, and only
   *  the first (a brand-new company) needs the access code. */
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
  /** The free look-around door — only offered to a brand-new user (mandatory
   *  setup, no company yet). */
  onTryFree?: () => void;
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

              {/* The no-code path sits ABOVE the form on purpose: creating a site
                  needs an access code, so a cold visitor who has neither a code
                  nor a join code would otherwise find no way in and bounce. */}
              {p.onTryFree && (
                <button type="button" className="ft-door" style={{ marginBottom: 18 }} onClick={p.onTryFree}>
                  <b>No code yet? Try the assistant free</b>
                  <small>5 questions on the Building Code, NZ Standards and manufacturer specs - no setup, nothing to enter.</small>
                </button>
              )}

              {p.mode === "create" ? (
                <>
                  {p.showCompany && (
                    <>
                      <label className="ev-lbl">Your company</label>
                      {/* ⚠️ No named example here, ever. This used to read "e.g.
                          Kalmar Construction" — a real Auckland commercial
                          builder whose sectors (retirement, apartments,
                          heritage, seismic, healthcare) are the same ones our
                          prospects work in, so we were showing customers a
                          competitor's name in their own signup form. Every
                          plausible NZ construction name turns out to belong to
                          somebody; the label already says "Your company", so
                          the field needs a prompt, not an example. */}
                      <input className="ev-in" value={p.company} autoFocus onChange={(e) => p.setCompany(e.target.value)} placeholder="Your company's name"
                        onKeyDown={(e) => { if (e.key === "Enter") p.onCreate(); }} />
                      <label className="ev-lbl">Access code</label>
                      <input className="ev-in" value={p.access} onChange={(e) => p.setAccess(e.target.value)} placeholder="The code we gave you"
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

// ─── Free look-around mode: the 5-question trial screen ──────────────────
// Deliberately its own tiny surface, not the main app: a trial user has no
// project, and every screen below the SiteSetup gate assumes one. The client
// carries the short conversation itself (no threads); the server meters.
function FreeTrial(p: { onSetUp: () => void; onSignOut: () => void }) {
  const [msgs, setMsgs] = useState<{ role: "user" | "assistant"; text: string; cards?: { ref: string; title: string; sub: string; url: string }[] }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState(0);
  const [walled, setWalled] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [leadEmail, setLeadEmail] = useState("");
  const [leadName, setLeadName] = useState("");
  const [leadCompany, setLeadCompany] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadDone, setLeadDone] = useState(false);
  const [leadErr, setLeadErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy, walled]);

  const ask = async () => {
    const q = input.trim();
    if (!q || busy || walled) return;
    setInput(""); setErr(null); setBusy(true);
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: q }]);
    try {
      const r = await fetch("/api/trial-ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, history }) });
      const d = await r.json();
      if (d.walled) { setWalled(true); setUsed(Number(d.limit) || 5); return; }
      if (!r.ok) throw new Error(d.error || "Couldn't reach the assistant just now - that question wasn't counted. Try again.");
      const cards = (Array.isArray(d.cards) ? d.cards : [])
        .filter((c: Record<string, unknown>) => c && typeof c === "object" && (c as { std?: unknown }).std)
        .map((c: { std: { ref?: string; title?: string; holds?: string; url?: string } }) => ({
          ref: String(c.std.ref || ""), title: String(c.std.title || ""), sub: String(c.std.holds || ""), url: String(c.std.url || ""),
        }));
      setMsgs((m) => [...m, { role: "assistant", text: String(d.answer || ""), cards }]);
      const u = Number(d.used) || 0;
      setUsed(u);
      if (u >= (Number(d.limit) || 5)) setWalled(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't reach the assistant just now - that question wasn't counted.");
    } finally {
      setBusy(false);
    }
  };

  const sendLead = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail.trim())) { setLeadErr("Enter the email address you want us to reach you on."); return; }
    setLeadBusy(true); setLeadErr(null);
    try {
      const r = await fetch("/api/leads", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: leadEmail.trim(), name: leadName.trim() || undefined, company: leadCompany.trim() || undefined }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save that just now.");
      setLeadDone(true);
    } catch (e) {
      setLeadErr(e instanceof Error ? e.message : "Couldn't save that just now - email adam@soterra.co.nz instead.");
    } finally {
      setLeadBusy(false);
    }
  };

  return (
    <div className="ft-wrap">
      <div className="ft-top">
        <b className="ft-brand">Soterra</b>
        <span className="ft-mode">Free look-around</span>
        <span className="ft-count">{Math.min(used, 5)} of 5 free questions</span>
        <button className="ft-setup" onClick={p.onSetUp}>Set up your site</button>
        <button className="ft-out" onClick={p.onSignOut}>Sign out</button>
      </div>
      <div className="ft-scroll" ref={scrollRef}>
        <div className="ft-inner">
          {msgs.length === 0 && !walled && (
            <div className="ft-hello">
              <b>Ask me anything about NZ construction.</b>
              <p>I answer from the Building Code, MBIE determinations, NZ Standards handling and the manufacturers&apos; own manuals - GIB, Ryanfire, Resene, Thermakraft and more. Five questions on the house.</p>
              <div className="ft-eg">
                {["What clearance does cladding need to finished ground level?", "GIB Aqualine fixing centres in a wet area?", "Can the council refuse a CCC over a missing producer statement?"].map((q) => (
                  <button key={q} onClick={() => { setInput(q); }}>{q}</button>
                ))}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={"ft-msg " + m.role}>
              <div className="ft-bubble" dangerouslySetInnerHTML={{ __html: fmt(m.text) }} />
              {m.cards?.map((c) => (
                <a key={c.ref} className="ft-std" href={c.url} target="_blank" rel="noreferrer">
                  <b>{c.ref}</b>
                  <small>{c.title}{c.sub ? ` - holds ${c.sub}` : ""} · free download ›</small>
                </a>
              ))}
            </div>
          ))}
          {busy && <div className="ft-msg assistant"><div className="ft-bubble ft-thinking">Looking that up…</div></div>}
          {err && <div className="ev-err" style={{ marginTop: 10 }}>{err}</div>}
          {walled && (
            <div className="ft-wall">
              <b>That&apos;s your 5 free questions.</b>
              <p>Like what you saw? With your site set up, Soterra reads your own drawings and specs, answers with the sheet it found, builds pre-inspection checklists and tracks your RFIs. We set new companies up personally.</p>
              {leadDone ? (
                <p className="ft-lead-done">Got it - we&apos;ll be in touch shortly. You can also email <a href="mailto:adam@soterra.co.nz">adam@soterra.co.nz</a> directly.</p>
              ) : (
                <>
                  <div className="ft-lead">
                    <input className="ev-in" type="email" placeholder="Your work email" value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} />
                    <input className="ev-in" placeholder="Name (optional)" value={leadName} onChange={(e) => setLeadName(e.target.value)} />
                    <input className="ev-in" placeholder="Company (optional)" value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} />
                    <button className="lg-btn primary" style={{ height: 44, margin: 0 }} disabled={leadBusy} onClick={() => void sendLead()}>{leadBusy ? "Sending…" : "Set me up"}</button>
                  </div>
                  {leadErr && <div className="ev-err">{leadErr}</div>}
                  <p className="ft-alt">Or email <a href="mailto:adam@soterra.co.nz">adam@soterra.co.nz</a> - same result, human included.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {!walled && (
        <div className="ft-compose">
          <div className="ft-cbox">
            <textarea
              rows={1}
              value={input}
              placeholder="Ask about the Building Code, a product spec, an inspection call…"
              onChange={(e) => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px"; }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
            />
            <button className="send" disabled={busy || !input.trim()} onClick={() => void ask()} aria-label="Send">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
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
    // A standard citation is already carried by the standards_handoff card
    // beside the answer, which renders the real page images (demo account) or
    // the free-to-download pointer (customer). The inline chip is pure
    // duplication, and when the Source line names the standard without a Table
    // number it has no page to render and falls back to a blank placeholder
    // stamped with the project name. Drop it — the handoff card is canonical.
    if (c.kind === "standard") continue;
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
          : first.kind === "standard"
            ? `📘 FROM ${(first.code || "THE NZS STANDARD").toUpperCase()}`
            : first.kind === "code"
              ? "📖 FROM THE BUILDING CODE"
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
const KNOWN_MFRS = new Set(["gib", "kingspan thermakraft", "boss fire", "james hardie", "rondo", "ryanfire", "resene", "colorsteel", "concrete nz", "allproof", "apl", "roofing industries", "dimond"]);

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

  // NZS / AS/NZS standard citation (e.g. "NZS 3604:2011, Tables 4.1 and 4.3").
  // Without this branch it falls through to the plans default and shows the wrong
  // "FROM YOUR PLANS" label. The standards_handoff card beside the answer carries
  // the tappable pages; this makes the inline citation label correctly, and for a
  // demo account it opens the same page when the Source names a known table.
  const stdRef = parts[0]?.match(/^((?:AS\/)?NZS\s*\d{3,4}(?:\.\d+)?(?::\s*\d{4})?)/i);
  if (stdRef) {
    const ref = stdRef[1].replace(/\s+/g, " ").trim();
    const tbl = sourceLine.match(/\b(?:Table|Clause)\s+(\d+\.\d+(?:\.\d+)?)/i)?.[1];
    const TBL_PAGE: Record<string, number> = { "4.1": 71, "4.3": 72, "8.8": 209, "8.9": 210, "8.10": 211, "4.5.1": 73 };
    const pg = tbl ? TBL_PAGE[tbl] : undefined;
    const rest = parts.slice(1).filter((p) => p !== ref).join(" · ");
    return {
      code: ref,
      title: rest,
      sub: "NZS standard",
      ans: fmt(body),
      hlTag: ref,
      kind: "standard",
      stdSlug: /3604/.test(ref) ? "nzs-3604-2011" : undefined,
      page: pg,
      url: /3604/.test(ref) ? "https://www.standards.govt.nz/shop/nzs-36042011" : "https://www.standards.govt.nz/",
    };
  }

  // Building Code / Acceptable Solution citation (e.g. "B2 Durability AS1 (third
  // edition) · … · page 12 of 40"). We hold no rendered Code pages, so unlike a
  // plan sheet this must NOT fall through to the plans viewer (a blank card) or
  // the "FROM YOUR PLANS" label. Identify it by the Acceptable Solution /
  // Verification Method marker every Code doc carries (AS1, VM1, /AS2) — which a
  // plan sheet name never does — and link out to the free Code on building.govt.nz.
  const codeDoc = parts[0] || "";
  // A clause document is a clause letter, then WHITESPACE, then a word: "F2
  // Hazardous Building Materials", "E2 External Moisture AS1". The whitespace is
  // what separates it from a plan sheet like "A3-00-0090-GENERAL-NOTES" or
  // "GNL650-CONSTRUCTION-DETAILS", which are hyphenated and must NOT be treated
  // as Code. The old test demanded an AS/VM marker to make that distinction,
  // which quietly excluded every clause document that has no Acceptable
  // Solution in its name — F2, B1, G12, D1 — and sent them to the plans branch
  // to be labelled "FROM YOUR PLANS". The second test catches the Crown
  // documents that carry no clause letter at all.
  const isCodeDoc =
    /^(?:NZBC\s+)?[A-H]\d{0,2}\s+[A-Za-z]/.test(codeDoc) ||
    /building code handbook|^building act|^building regulations|acceptable solution|verification method/i.test(codeDoc);
  if (isCodeDoc) {
    // Carry the document and page so the viewer can render the real Code page.
    // Where we have no stored render, /api/code-page 404s and the sheet falls
    // back to the building.govt.nz link, which is what every Code citation did
    // before there were any rendered pages at all.
    const pageSeg = parts.find((p) => /^page\s/i.test(p)) || "";
    const pageNum = pageSeg.match(/\d+/);
    return {
      code: codeDoc,
      title: "",
      sub: "NZ Building Code",
      ans: fmt(body),
      hlTag: pageSeg || codeDoc,
      kind: "code",
      doc: codeDoc,
      page: pageNum ? parseInt(pageNum[0], 10) : undefined,
      url: "https://www.building.govt.nz/building-code-compliance/",
    };
  }

  // Plan citation. Carry doc + page so the viewer can render the actual uploaded
  // sheet (a plan page has a private blob behind it).
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

// What the "open the original" link should call the source. Kept in one place
// because it is needed twice — in the viewer footer and in the canvas when no
// image loads — and the two had drifted, so a Building Code page was offering
// to open "the full manual".
function openLabel(kind: Cite["kind"]): string {
  return kind === "standard" ? "Open the full standard"
    : kind === "determination" ? "Open the full determination"
    : kind === "code" ? "Open it on building.govt.nz"
    : "Open the full manual";
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

// ─── Pin stage (Foundation 2) ─────────────────────────────────────────────
// Full-screen browser for one uploaded drawing: page nav, wheel/button zoom,
// drag pan, and the pin overlay from plan-pinning-mock.html. Pins are stored
// as % of the sheet so they stay glued to the drawing at any zoom.
// Read-only by default; a feature (QA check, RFI, flag-to-sub) passes onDrop
// to enable click-to-pin and onPinClick to open the pinned record.
type PinRow = { id: string; doc: string; page: number; x: number; y: number; recordType: string; recordId: string; label: string | null };

function PinStage(p: {
  projectId: string;
  doc: string;
  page: number;
  npages: number;
  onClose: () => void;
  fetchApi: (path: string, init?: RequestInit) => Promise<Response>;
  onDrop?: (at: { x: number; y: number; page: number }) => void;
  onPinClick?: (pin: PinRow) => void;
  /** Bump to refetch the pins (e.g. after a flag was created or deleted). */
  refresh?: number;
  /** Sheets this stage may flip between (the location's drawings, or the whole
   *  set). With 2+ the title becomes a switcher; the parent owns the doc. */
  sheets?: { doc: string; npages: number }[];
  onSwitchSheet?: (doc: string, npages: number) => void;
}) {
  const [page, setPage] = useState(p.page);
  // The parent swaps p.doc on a sheet switch (same mounted instance) — follow
  // it back to the page the parent asked for, not the old sheet's page.
  const lastDocRef = useRef(p.doc);
  useEffect(() => {
    if (lastDocRef.current !== p.doc) { lastDocRef.current = p.doc; setPage(p.page); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doc]);
  const [pins, setPins] = useState<PinRow[]>([]);
  const [img, setImg] = useState<"loading" | "ok" | "error">("loading");
  const [scale, setScale] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  useEffect(() => { scaleRef.current = scale; }, [scale]);
  useEffect(() => { setImg("loading"); setSel(null); }, [page]);

  // The page's pins. fetchApi is recreated each parent render, so it is
  // deliberately not a dependency — doc/page changing is what matters.
  useEffect(() => {
    let live = true;
    p.fetchApi(`/api/pins?doc=${encodeURIComponent(p.doc)}&page=${page}`)
      .then((r) => (r.ok ? r.json() : { pins: [] }))
      .then((d) => { if (live) setPins(Array.isArray(d?.pins) ? d.pins : []); })
      .catch(() => { if (live) setPins([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doc, page, p.refresh]);

  // Wheel / trackpad-pinch zoom anchored on the pointer — same approach as the
  // full-screen citation zoom (native listener; React's onWheel is passive).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const prev = scaleRef.current;
      const next = Math.min(6, Math.max(1, prev * Math.exp(-e.deltaY * 0.0015)));
      if (Math.abs(next - prev) < 0.001) return;
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const cx = el.scrollLeft + px;
      const cy = el.scrollTop + py;
      const ratio = next / prev;
      scaleRef.current = next;
      setScale(next);
      requestAnimationFrame(() => {
        el.scrollLeft = cx * ratio - px;
        el.scrollTop = cy * ratio - py;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const src = `/api/plan-page?project=${encodeURIComponent(p.projectId)}&doc=${encodeURIComponent(p.doc)}&p=${page}`;
  return (
    <div className="ps-scrim">
      <div className="ps-top">
        <div className="ti">
          {p.sheets && p.sheets.length > 1 && p.onSwitchSheet ? (
            <select
              className="ps-sheet"
              value={p.doc}
              title="Switch sheet"
              onChange={(e) => {
                const nd = p.sheets!.find((s) => s.doc === e.target.value);
                if (nd && nd.doc !== p.doc) p.onSwitchSheet!(nd.doc, nd.npages);
              }}
            >
              {p.sheets.map((s) => <option key={s.doc} value={s.doc}>{s.doc}</option>)}
            </select>
          ) : (
            <b>{p.doc}</b>
          )}
          <small>{pins.length ? `${pins.length} pin${pins.length === 1 ? "" : "s"} on this page` : "No pins on this page"}</small>
        </div>
        <div className="ps-nav">
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>page {page} / {p.npages}</span>
          <button disabled={page >= p.npages} onClick={() => setPage(page + 1)}>›</button>
        </div>
        <button className="ps-x" onClick={p.onClose}>✕</button>
      </div>
      <div
        className="ps-canvas"
        ref={canvasRef}
        onPointerDown={(e) => {
          // Drag to pan. Skip pins (they take the click) and non-primary buttons.
          if (e.button !== 0 || (e.target as HTMLElement).closest(".ps-pin")) return;
          const el = canvasRef.current;
          if (!el) return;
          const sx = e.clientX, sy = e.clientY;
          const l0 = el.scrollLeft, t0 = el.scrollTop;
          let moved = false;
          const move = (m: PointerEvent) => {
            if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) > 3) moved = true;
            el.scrollLeft = l0 - (m.clientX - sx);
            el.scrollTop = t0 - (m.clientY - sy);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            // A drag must not also count as a click (which would drop a pin).
            if (moved) window.addEventListener("click", (c) => { c.stopPropagation(); c.preventDefault(); }, { capture: true, once: true });
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      >
        {img === "error" ? (
          <div className="ps-msg">Couldn&apos;t load this sheet.</div>
        ) : (
          <div className="ps-fit" style={{ width: scale === 1 ? "min(100%, 1100px)" : `${scale * 100}%` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={`${p.doc} page ${page}`}
              draggable={false}
              style={{ opacity: img === "ok" ? 1 : 0 }}
              onLoad={() => setImg("ok")}
              onError={() => setImg("error")}
            />
            {img === "ok" && (
              <div
                className="ps-pinlayer"
                style={p.onDrop ? { cursor: "crosshair" } : undefined}
                onClick={(e) => {
                  if (!p.onDrop) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0.5, Math.min(99.5, ((e.clientX - rect.left) / rect.width) * 100));
                  const y = Math.max(0.5, Math.min(99.5, ((e.clientY - rect.top) / rect.height) * 100));
                  p.onDrop({ x, y, page });
                }}
              >
                {pins.map((pin) => (
                  <div
                    key={pin.id}
                    className={"ps-pin " + pin.recordType + (sel === pin.id ? " sel" : "")}
                    style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
                    onClick={(e) => { e.stopPropagation(); setSel(pin.id); p.onPinClick?.(pin); }}
                  >
                    <div className="head"><b>{pin.label || "•"}</b></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {img === "loading" && (
          <div className="ps-msg" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            Loading the sheet…
          </div>
        )}
      </div>
      {p.onDrop && img === "ok" && <div className="ps-hint">📌 Tap the drawing to drop a pin</div>}
      <div className="zoomctl">
        <button onClick={() => setScale((s) => Math.max(1, +(s - 0.4).toFixed(2)))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => Math.min(6, +(s + 0.4).toFixed(2)))}>+</button>
      </div>
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
