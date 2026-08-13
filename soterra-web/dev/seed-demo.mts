// ─── Demo data seed for the Kauri Tower / domokadam43 account ─────────────
//
// Populates the LIVE account with realistic, entirely FICTIONAL demo data so a
// prospect sees a full app: ~20 RFIs (a designed consultant scorecard with a
// clear worst offender, a star, overdue rows, reopens and 2 EOT rows), ~40
// made-up inspection reports (failure themes clustered so Insights ranks), plus
// subs, a few checklists and pinned QA flags.
//
// Idempotent: clears this project's demo tables then re-seeds, so it can be
// re-run any time (e.g. to refresh the backdated dates before a demo).
//
//   npx tsx dev/seed-demo.mts
//
// Real drawings (120 plan pages) are NOT touched. Consultant/company/site names
// are invented on purpose — no real firm should look like the villain in a demo.

import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const {
  rfis, rfiMessages, rfiTransitions, contractInstructions,
  inspections, inspectionItems, subs, checklists, checklistItems,
  qaFlags, planPins, planPages, emailLog,
} = await import("../lib/schema.ts");
const { addWorkingDays } = await import("../lib/rfi.ts");
const { and, eq } = await import("drizzle-orm");

// ── verified ids (dev/_probe-demo-account.mts) ──
const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower
const CID = "e9210ba0-b03b-402b-8cfa-e6fa66d39055";
const UID = "user_3GcPx9L3pXhpSe20wl9H5rTuS8E"; // Adam Domok (admin)
const UNAME = "Adam Domok";

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function reset() {
  // Only this project's / company's demo rows. The account has no real RFIs,
  // inspections, subs, checklists or flags, so a full clear here is safe.
  await db.delete(rfiMessages).where(eq(rfiMessages.projectId, PID));
  await db.delete(rfiTransitions).where(eq(rfiTransitions.projectId, PID));
  await db.delete(contractInstructions).where(eq(contractInstructions.projectId, PID));
  await db.delete(rfis).where(eq(rfis.projectId, PID));
  await db.delete(inspectionItems).where(eq(inspectionItems.projectId, PID));
  await db.delete(inspections).where(eq(inspections.projectId, PID));
  await db.delete(checklistItems).where(eq(checklistItems.projectId, PID));
  await db.delete(checklists).where(eq(checklists.projectId, PID));
  await db.delete(qaFlags).where(eq(qaFlags.projectId, PID));
  await db.delete(planPins).where(and(eq(planPins.projectId, PID), eq(planPins.recordType, "rfi")));
  await db.delete(planPins).where(and(eq(planPins.projectId, PID), eq(planPins.recordType, "qa_flag")));
  await db.delete(subs).where(eq(subs.companyId, CID));
  await db.delete(emailLog).where(eq(emailLog.companyId, CID));
}

// ── real drawing docs to pin on (so "Open on plan" works live) ──
const docRows = await db.select({ doc: planPages.doc }).from(planPages).where(eq(planPages.projectId, PID));
const realDocs = [...new Set(docRows.map((r) => r.doc))];
const pickDoc = (i: number) => realDocs[i % realDocs.length] ?? "S3.01";

// ─── SUBS (fictional subcontractors, trade = a CATEGORY) ──────────────────
const SUBS = [
  { name: "Firepoint Passive Fire Ltd", email: "jobs@firepoint.co.nz", trade: "Fire" },
  { name: "Downpipe Hydraulic Services", email: "service@downpipe.co.nz", trade: "Plumbing & Drainage" },
  { name: "Voltway Electrical", email: "site@voltway.co.nz", trade: "Electrical" },
  { name: "AirCell Mechanical", email: "install@aircell.co.nz", trade: "Mechanical" },
  { name: "Rula Ceilings & Linings", email: "office@rula.co.nz", trade: "Interior / Linings" },
  { name: "Kauri Structural Steel", email: "fab@kauristeel.co.nz", trade: "Structural" },
  { name: "Seal-Tight Waterproofing", email: "admin@sealtight.co.nz", trade: "Weathertightness / Cladding" },
  { name: "Quietline Acoustics", email: "jobs@quietline.co.nz", trade: "Acoustic" },
];

// ─── RFIs ─────────────────────────────────────────────────────────────────
// scenario: open | overdue | answered | closed | bounced | cp-late-answered |
//           cp-late-open | draft | void
type RfiSpec = {
  subject: string; discipline: string; consultant: [string, string, string]; // person, company, email
  priority?: "normal" | "high" | "critical"; location?: string;
  question: string; scenario: string; raisedDaysAgo?: number; turnaroundWd?: number; turnaround2Wd?: number;
  cost?: "none" | "unknown" | "yes"; costEst?: string; prog?: "none" | "unknown" | "yes"; progDays?: number;
  answer?: string; followup?: string; pin?: boolean; ci?: string;
};

const C = {
  totara: ["Priya Nair", "Totara Structural Consultants", "priya.nair@totarastructural.co.nz"] as [string, string, string],
  meridian: ["Grant Hollis", "Meridian Mechanical", "grant.hollis@meridianmech.co.nz"] as [string, string, string],
  kahikatea: ["Sam Whitiora", "Kahikatea Fire Engineering", "sam.whitiora@kahikateafire.co.nz"] as [string, string, string],
  southern: ["Lena Fraser", "Southern Facade Group", "lena.fraser@southernfacade.co.nz"] as [string, string, string],
  harbourline: ["Tama Reweti", "Harbourline Civil", "tama.reweti@harbourlinecivil.co.nz"] as [string, string, string],
  aria: ["Meg Sinclair", "Aria Architects", "meg.sinclair@ariaarchitects.co.nz"] as [string, string, string],
  voltway: ["Rob Deen", "Voltway Electrical Design", "rob.deen@voltwaydesign.co.nz"] as [string, string, string],
};

const RFI_SPECS: RfiSpec[] = [
  // ── Totara Structural = the STAR (fast, within SLA) ──
  { subject: "Lintel fixing at grid C3, Level 1", discipline: "Structural", consultant: C.totara, location: "Level 1 · grid C3",
    question: "S3.01 Rev C calls for M12 bolts at 600 crs fixing the L1 lintel at grid C3, but the wall shows as 140 on A-201 Rev C at the same line. Please confirm wall thickness and required fixing.",
    scenario: "closed", raisedDaysAgo: 34, turnaroundWd: 4, cost: "none", prog: "none",
    answer: "Confirmed: wall at grid C3 is 190 series as per S3.01. Lintel fixing M12 at 600 crs stands. A-201 to be revised to 190 at next issue.", pin: true, ci: "Revise A-201 wall thickness at grid C3 to 190 series" },
  { subject: "Pile depth at boundary retaining wall", discipline: "Structural", consultant: C.totara, location: "Site · east boundary",
    question: "Geotech report calls up 3.0 m bored piles at the east retaining wall; the structural set shows 2.4 m. Which governs?",
    scenario: "answered", raisedDaysAgo: 22, turnaroundWd: 5, cost: "unknown", prog: "none",
    answer: "Follow the geotech: 3.0 m bored piles at the east retaining wall. Structural sheet will be updated to suit." },
  { subject: "Steel beam connection at grid F2", discipline: "Structural", consultant: C.totara, location: "Level 2 · grid F2",
    question: "Connection detail 7/S5.02 shows an 8mm cleat; the beam reaction on the schedule needs a 10mm cleat. Please confirm.",
    scenario: "closed", raisedDaysAgo: 41, turnaroundWd: 6, cost: "yes", costEst: "~$1,200", prog: "none",
    answer: "Use the 10mm cleat with 4/M20 bolts as per the reaction. Detail 7/S5.02 to be corrected." },
  { subject: "Slab step detail at lift pit", discipline: "Structural", consultant: C.totara, location: "Basement · lift pit",
    question: "No step detail provided where the basement slab meets the lift pit wall. Please issue the reinforcing at the step.",
    scenario: "open", raisedDaysAgo: 3, cost: "unknown", prog: "unknown" },

  // ── Meridian Mechanical = the WORST offender (slow, overdue, reopens, EOT) ──
  { subject: "Kitchen extract duct route clash with beam, Level 1", discipline: "Mechanical", consultant: C.meridian, priority: "high", location: "Level 1 · grid B4",
    question: "The kitchen extract duct on M2.03 clashes with the L1 transfer beam at grid B4. There is no room to drop below. Please advise a coordinated route.",
    scenario: "cp-late-answered", raisedDaysAgo: 44, turnaroundWd: 16, cost: "yes", costEst: "~$8,500", prog: "yes", progDays: 6,
    answer: "Reroute the extract to the north riser and bulkhead down at grid B5. Revised M2.03 to follow. This holds up the L1 ceiling line." },
  { subject: "Fire damper access panel location", discipline: "Mechanical", consultant: C.meridian, location: "Level 2 · corridor",
    question: "Fire dampers to the L2 corridor have no access panels shown. Please confirm panel locations so the ceiling grid can be set out.",
    scenario: "overdue", raisedDaysAgo: 21, cost: "none", prog: "yes", progDays: 2 },
  { subject: "AHU plant deck loading", discipline: "Mechanical", consultant: C.meridian, location: "Roof · plant deck",
    question: "AHU-1 weight on the mech schedule exceeds the plant deck design load on S6.01. Please confirm the deck can take it or advise.",
    scenario: "overdue", raisedDaysAgo: 26, cost: "unknown", prog: "unknown" },
  { subject: "Ductwork penetration fire rating, basement", discipline: "Mechanical", consultant: C.meridian, location: "Basement · riser wall",
    question: "The supply duct penetrating the basement riser wall has no fire rating called up. Please confirm the required rating and treatment.",
    scenario: "bounced", raisedDaysAgo: 37, turnaroundWd: 8, turnaround2Wd: 6, cost: "unknown", prog: "none",
    answer: "Penetration to be fire-stopped to the wall's FRR.", followup: "Which FRR though — the wall is shown as both 60/60/60 and 90/90/90 on different sheets. Please confirm.", },

  // ── Kahikatea Fire = middling ──
  { subject: "Sprinkler head clearance to Fyreline bulkhead, Level 2", discipline: "Fire", consultant: C.kahikatea, location: "Level 2 · lobby",
    question: "Sprinkler heads sit within 300mm of the new Fyreline bulkhead in the L2 lobby. Please confirm the required clearance or relocate.",
    scenario: "answered", raisedDaysAgo: 18, turnaroundWd: 8, cost: "none", prog: "none",
    answer: "Maintain 300mm minimum to the bulkhead face; relocate the two heads at grid D3 as marked up." },
  { subject: "Riser duct fire collar spec, basement", discipline: "Fire", consultant: C.kahikatea, location: "Basement · riser",
    question: "No fire collar spec given for the 100mm uPVC risers through the basement slab. Please confirm the collar product and rating.",
    scenario: "overdue", raisedDaysAgo: 15, cost: "none", prog: "yes", progDays: 1 },
  { subject: "Fire door hold-open device zoning", discipline: "Fire", consultant: C.kahikatea, location: "Levels 1-3 · corridors",
    question: "Please confirm which fire doors are on hold-open devices and their detection zoning so the electrical can be coordinated.",
    scenario: "closed", raisedDaysAgo: 30, turnaroundWd: 9, cost: "none", prog: "none",
    answer: "Hold-opens to the corridor cross-doors on L1-L3 only, zoned to the local smoke detection. Schedule attached." },

  // ── Southern Facade = one EOT, one overdue ──
  { subject: "Window head flashing at unitised facade", discipline: "Facade", consultant: C.southern, priority: "high", location: "Levels 4-6 · north facade",
    question: "The window head flashing on the unitised facade has no upstand shown where it meets the spandrel. This is on the weathertightness line. Please issue the detail.",
    scenario: "cp-late-open", raisedDaysAgo: 30, cost: "yes", costEst: "unknown", prog: "yes", progDays: 4, pin: true },
  { subject: "Curtain wall bracket embedment", discipline: "Facade", consultant: C.southern, location: "Level 3 · grid A",
    question: "Curtain wall bracket embedment into the L3 slab edge is not dimensioned. Please confirm edge distance and fixing.",
    scenario: "overdue", raisedDaysAgo: 16, cost: "unknown", prog: "unknown" },

  // ── Harbourline Civil ──
  { subject: "Stormwater connection invert level", discipline: "Civil", consultant: C.harbourline, location: "Site · SW connection",
    question: "The stormwater connection invert on C2.01 is higher than the incoming pipe. Please confirm the invert so falls can be maintained.",
    scenario: "closed", raisedDaysAgo: 28, turnaroundWd: 6, cost: "none", prog: "none",
    answer: "Drop the connection invert to RL 21.85 to maintain fall. Revised long-section to follow." },
  { subject: "Driveway crossing gradient", discipline: "Civil", consultant: C.harbourline, location: "Site · vehicle crossing",
    question: "The vehicle crossing gradient scales at 1:6 which exceeds the district plan limit. Please confirm the crossing profile.",
    scenario: "answered", raisedDaysAgo: 20, turnaroundWd: 5, cost: "none", prog: "none",
    answer: "Regrade to 1:8 maximum with a transition at the boundary; profile marked up on C1.02." },

  // ── Aria Architects ──
  { subject: "Balcony threshold waterproofing detail conflict", discipline: "Architectural", consultant: C.aria, location: "Level 5 · balconies",
    question: "The balcony threshold detail A-501 shows a 50mm step, but the accessibility set needs a level threshold. Please resolve.",
    scenario: "open", raisedDaysAgo: 4, cost: "unknown", prog: "unknown" },
  { subject: "Ceiling bulkhead setout at lobby", discipline: "Architectural", consultant: C.aria, location: "Ground · lobby",
    question: "The lobby bulkhead setout on the RCP conflicts with the sprinkler and lighting layout. Please confirm the governing setout.",
    scenario: "answered", raisedDaysAgo: 24, turnaroundWd: 10, cost: "none", prog: "none",
    answer: "Bulkhead face to hold at 2700 AFFL and align to gridline B; services to coordinate under." },
  { subject: "Tiling junction at wet area, Level 2", discipline: "Architectural", consultant: C.aria, location: "Level 2 · unit bathrooms",
    question: "The tile-to-vinyl junction at the L2 bathroom doors has no threshold detail. Please issue.",
    scenario: "bounced", raisedDaysAgo: 33, turnaroundWd: 7, turnaround2Wd: 5, cost: "none", prog: "none",
    answer: "Use a tiled hob with an aluminium angle threshold.", followup: "The unit type B doors are too narrow for a hob and stay accessible — please confirm a flush alternative for those." },
  { subject: "Signage bracket fixing to blockwork", discipline: "Architectural", consultant: C.aria, location: "Ground · entry",
    question: "Entry signage bracket fixing into the blockwork is not specified. Please confirm the fixing.",
    scenario: "draft" },

  // ── Voltway Electrical ──
  { subject: "MSB clearance to services", discipline: "Electrical", consultant: C.voltway, location: "Basement · switch room",
    question: "The main switchboard clearance clashes with a hydraulic pipe run in the basement switch room. Please confirm the required working clearance.",
    scenario: "open", raisedDaysAgo: 5, cost: "none", prog: "unknown" },

  // ── one voided (raised in error, after sending) ──
  { subject: "Louvre free area at plant room", discipline: "Mechanical", consultant: C.meridian, location: "Roof · plant room",
    question: "Please confirm the free area of the plant room louvres.",
    scenario: "void", raisedDaysAgo: 12 },
];

async function seedRfis() {
  // number the SENT ones oldest-first; drafts get no number.
  const sent = RFI_SPECS.filter((s) => s.scenario !== "draft").sort((a, b) => (b.raisedDaysAgo ?? 0) - (a.raisedDaysAgo ?? 0));
  const numberOf = new Map<RfiSpec, number>();
  sent.forEach((s, i) => numberOf.set(s, i + 1));

  let pinIdx = 0;
  for (const s of RFI_SPECS) {
    const number = numberOf.get(s) ?? null;
    const isDraft = s.scenario === "draft";
    const raised = isDraft ? null : daysAgo(s.raisedDaysAgo ?? 10);
    const requiredBy = raised ? addWorkingDays(raised, 7) : null;

    // dates + final status per scenario
    let status = "open";
    let ball = "consultant";
    let dateAnswered: Date | null = null;
    let dateClosed: Date | null = null;
    const trans: { from: string | null; to: string; ballFrom: string; ballTo: string; at: Date; comment?: string }[] = [];
    const msgs: { type: string; side: string; body: string; at: Date }[] = [];

    if (raised) {
      trans.push({ from: "draft", to: "open", ballFrom: "us", ballTo: "consultant", at: raised, comment: "sent to " + s.consultant[1] });
      msgs.push({ type: "question", side: "contractor", body: s.question, at: raised });
    } else {
      msgs.push({ type: "question", side: "contractor", body: s.question, at: NOW });
    }

    const ans1 = raised && s.turnaroundWd != null ? addWorkingDays(raised, s.turnaroundWd) : null;

    switch (s.scenario) {
      case "draft": status = "draft"; ball = "us"; break;
      case "open": case "overdue": case "cp-late-open": status = "open"; ball = "consultant"; break;
      case "answered": case "cp-late-answered":
        status = "answered"; ball = "us"; dateAnswered = ans1!;
        trans.push({ from: "open", to: "answered", ballFrom: "consultant", ballTo: "us", at: ans1! });
        msgs.push({ type: "official_answer", side: "consultant", body: s.answer!, at: ans1! });
        break;
      case "closed":
        dateAnswered = ans1!; dateClosed = plusDays(ans1!, 2); status = "closed"; ball = "none";
        trans.push({ from: "open", to: "answered", ballFrom: "consultant", ballTo: "us", at: ans1! });
        msgs.push({ type: "official_answer", side: "consultant", body: s.answer!, at: ans1! });
        trans.push({ from: "answered", to: "closed", ballFrom: "us", ballTo: "none", at: dateClosed });
        break;
      case "bounced": {
        const bounce = plusDays(ans1!, 2);
        const ans2 = addWorkingDays(bounce, s.turnaround2Wd ?? 5);
        status = "answered"; ball = "us"; dateAnswered = ans2;
        trans.push({ from: "open", to: "answered", ballFrom: "consultant", ballTo: "us", at: ans1! });
        msgs.push({ type: "official_answer", side: "consultant", body: s.answer!, at: ans1! });
        trans.push({ from: "answered", to: "open", ballFrom: "us", ballTo: "consultant", at: bounce, comment: "follow-up bounced the ball back" });
        msgs.push({ type: "followup", side: "contractor", body: s.followup!, at: bounce });
        trans.push({ from: "open", to: "answered", ballFrom: "consultant", ballTo: "us", at: ans2 });
        msgs.push({ type: "official_answer", side: "consultant", body: "Confirmed — see the marked-up detail attached.", at: ans2 });
        break;
      }
      case "void":
        status = "void"; ball = "none";
        trans.push({ from: "open", to: "void", ballFrom: "consultant", ballTo: "none", at: daysAgo((s.raisedDaysAgo ?? 12) - 2), comment: "raised in error" });
        break;
    }

    const [rfi] = await db.insert(rfis).values({
      companyId: CID, projectId: PID, number, revision: 0,
      subject: s.subject, discipline: s.discipline, status, ballParty: ball,
      priority: s.priority ?? "normal", location: s.location ?? null,
      question: s.question, proposedSolution: null,
      costImpact: s.cost ?? "unknown", costEstimate: s.costEst ?? null,
      programmeImpact: s.prog ?? "unknown", programmeDays: s.progDays ?? null,
      criticalPath: s.scenario.startsWith("cp-late"),
      raisedBy: UID, raisedByName: UNAME,
      consultantName: s.consultant[0], consultantCompany: s.consultant[1], consultantEmail: s.consultant[2],
      dateRaised: raised, dateRequiredBy: requiredBy, dateAnswered, dateClosed,
      createdAt: raised ?? NOW, updatedAt: dateAnswered ?? raised ?? NOW,
    }).returning();

    for (const m of msgs)
      await db.insert(rfiMessages).values({ companyId: CID, projectId: PID, rfiId: rfi.id, type: m.type, authorSide: m.side, authorName: m.side === "consultant" ? s.consultant[0] : UNAME, body: m.body, createdAt: m.at });
    for (const t of trans)
      await db.insert(rfiTransitions).values({ companyId: CID, projectId: PID, rfiId: rfi.id, fromStatus: t.from, toStatus: t.to, ballFrom: t.ballFrom, ballTo: t.ballTo, byUser: UID, byName: UNAME, comment: t.comment ?? null, at: t.at });

    if (s.pin && raised) {
      await db.insert(planPins).values({ companyId: CID, projectId: PID, doc: pickDoc(pinIdx), page: 1, x: 30 + pinIdx * 12, y: 42 + pinIdx * 7, recordType: "rfi", recordId: rfi.id, label: String(number), createdBy: UID });
      pinIdx++;
    }
    if (s.ci) {
      const [ci] = await db.insert(contractInstructions).values({ companyId: CID, projectId: PID, number: 1, title: s.ci, sourceRfiId: rfi.id, amendsDrawings: JSON.stringify([{ doc: "A-201", fromRev: "C", toRev: "D" }]), createdBy: UID, createdAt: dateClosed ?? NOW }).returning();
      await db.update(rfis).set({ resultingCiId: ci.id }).where(eq(rfis.id, rfi.id));
      await db.insert(rfiMessages).values({ companyId: CID, projectId: PID, rfiId: rfi.id, type: "system", authorSide: "contractor", authorName: UNAME, body: `Answer spawned CI-001 · amends A-201`, createdAt: dateClosed ?? NOW });
    }
  }
}

// ─── INSPECTIONS (fictional, failure themes clustered for Insights) ────────
type Item = { cat: string; title: string; detail: string; loc?: string };
type Insp = { doc: string; site: string; source: "council" | "consultant"; code?: string; type: string; inspector: string; outcome: "pass" | "partial" | "fail"; daysAgo: number; items: Item[] };

// re-used item builders (the clustered themes)
const firestop = (loc: string): Item => ({ cat: "Fire", title: "Passive fire stopping incomplete", detail: "Penetrations through the fire-rated wall not fire-stopped. Seal both sides to the wall FRR and label.", loc });
const firecollar = (loc: string): Item => ({ cat: "Fire", title: "Fire collar not installed correctly", detail: "Fire collar to the uPVC penetration proud of the slab and fixed one side only. Refit hard to the soffit per the manufacturer detail.", loc });
const drainfall = (loc: string): Item => ({ cat: "Plumbing & Drainage", title: "Insufficient fall to drainage penetration", detail: "Penetration set out flat; will not achieve the required fall. Reset to maintain gradient to the design.", loc });
const bracing = (loc: string): Item => ({ cat: "Structural", title: "Bracing fixing incomplete", detail: "Bracing sheet nailing does not match the bracing schedule; several fixings missing at the panel edges.", loc });
const weather = (loc: string): Item => ({ cat: "Weathertightness / Cladding", title: "Flashing junction not sealed", detail: "Head flashing junction to the cladding left open; no upstand or sealant. Rework to the weathertightness detail.", loc });
const cable = (loc: string): Item => ({ cat: "Electrical", title: "Cable segregation inadequate", detail: "Power and data cabling run together with no separation; re-run to maintain segregation.", loc });
const damper = (loc: string): Item => ({ cat: "Mechanical", title: "Fire damper access not provided", detail: "No access panel to the fire damper; provide access for testing and commissioning.", loc });
const acoustic = (loc: string): Item => ({ cat: "Acoustic", title: "Acoustic seal missing at penetration", detail: "Service penetration through the inter-tenancy wall not acoustically sealed; seal to maintain the STC rating.", loc });

const INSPECTIONS: Insp[] = [
  // ── Council statutory (mixed outcomes) ──
  { doc: "BCA IPL Post-line Level 1 partial 1", site: "14 Kowhai Lane, Papakura", source: "council", code: "IPL", type: "Post-line", inspector: "Southern Districts Council", outcome: "partial", daysAgo: 120, items: [firestop("L1 · grid C"), bracing("L1 · east wall"), { cat: "Interior / Linings", title: "Ceiling stopping incomplete", detail: "Ceiling stopping not complete at the L1 corridor; complete before line inspection re-book.", loc: "L1 corridor" }] },
  { doc: "BCA IPB Pre-line Level 1 partial 1", site: "14 Kowhai Lane, Papakura", source: "council", code: "IPB", type: "Pre-line", inspector: "Southern Districts Council", outcome: "partial", daysAgo: 128, items: [firestop("L1 · riser"), { cat: "Plumbing & Drainage", title: "Pipe not clipped at required centres", detail: "Hot and cold pipes not clipped to the required centres in the L1 wall; clip before lining.", loc: "L1 wall" }] },
  { doc: "BCA IFG Framing partial 1", site: "14 Kowhai Lane, Papakura", source: "council", code: "IFG", type: "Framing", inspector: "Southern Districts Council", outcome: "partial", daysAgo: 150, items: [bracing("Ground · south wall"), { cat: "Structural", title: "Lintel fixing not per plan", detail: "Lintel over the garage opening not fixed as per the structural detail; add the specified fixings.", loc: "Ground · garage" }] },
  { doc: "BCA ICA Cavity wrap fail 1", site: "14 Kowhai Lane, Papakura", source: "council", code: "ICA", type: "Cavity / wrap", inspector: "Southern Districts Council", outcome: "fail", daysAgo: 140, items: [weather("Level 1 · window heads"), { cat: "Weathertightness / Cladding", title: "Building wrap torn and not lapped", detail: "Wrap torn at several fixings and not lapped over the flashings; repair and re-lap before cladding.", loc: "L1 · north wall" }] },
  { doc: "BCA IPP Plumbing pass 1", site: "14 Kowhai Lane, Papakura", source: "council", code: "IPP", type: "Pre-line plumbing", inspector: "Southern Districts Council", outcome: "pass", daysAgo: 132, items: [] },
  { doc: "BCA IPL Post-line partial 2", site: "27 Rata Street, Hamilton", source: "council", code: "IPL", type: "Post-line", inspector: "Waikato City Council", outcome: "partial", daysAgo: 96, items: [firestop("L2 · grid B"), acoustic("L2 · inter-tenancy wall")] },
  { doc: "BCA IPB Pre-line partial 2", site: "27 Rata Street, Hamilton", source: "council", code: "IPB", type: "Pre-line", inspector: "Waikato City Council", outcome: "partial", daysAgo: 104, items: [firestop("L2 · riser"), drainfall("L2 · wet area")] },
  { doc: "BCA IFG Framing pass 2", site: "27 Rata Street, Hamilton", source: "council", code: "IFG", type: "Framing", inspector: "Waikato City Council", outcome: "pass", daysAgo: 118, items: [] },
  { doc: "BCA ICL Cladding partial 2", site: "27 Rata Street, Hamilton", source: "council", code: "ICL", type: "Cladding", inspector: "Waikato City Council", outcome: "partial", daysAgo: 88, items: [weather("Level 2 · sill flashings"), { cat: "Weathertightness / Cladding", title: "Insufficient ground clearance to cladding", detail: "Cladding finishes below the required clearance to finished ground level at the south elevation; trim to clearance.", loc: "Ground · south" }] },
  { doc: "BCA IDT Drainage partial 2", site: "27 Rata Street, Hamilton", source: "council", code: "IDT", type: "Drainage", inspector: "Waikato City Council", outcome: "partial", daysAgo: 100, items: [drainfall("Site · SW line"), { cat: "Plumbing & Drainage", title: "Inspection point not accessible", detail: "Drainage IP buried and not brought to surface; expose and make accessible.", loc: "Site · east" }] },
  { doc: "BCA IF1 Final residential partial 3", site: "3 Miro Place, Tauranga", source: "council", code: "IF1", type: "Final", inspector: "Bay Building Consents", outcome: "partial", daysAgo: 60, items: [{ cat: "Access & Barriers", title: "Barrier height below F4 minimum", detail: "Balustrade to the L1 balcony measures below the F4 minimum height; raise to comply.", loc: "L1 balcony" }, firecollar("L1 · riser")] },
  { doc: "BCA IPL Post-line fail 3", site: "3 Miro Place, Tauranga", source: "council", code: "IPL", type: "Post-line", inspector: "Bay Building Consents", outcome: "fail", daysAgo: 72, items: [firestop("L1 · grid D"), firecollar("L1 · grid D"), bracing("L1 · west wall")] },
  { doc: "BCA IPB Pre-line partial 3", site: "3 Miro Place, Tauranga", source: "council", code: "IPB", type: "Pre-line", inspector: "Bay Building Consents", outcome: "partial", daysAgo: 80, items: [drainfall("L1 · bathroom"), cable("L1 · wall")] },
  { doc: "BCA ISF Slab pass 4", site: "88 Totara Ave, Auckland", source: "council", code: "ISF", type: "Slab / floor", inspector: "Auckland Council", outcome: "pass", daysAgo: 175, items: [] },

  // ── Fire consultant reports (passive-fire heavy) ──
  { doc: "Fire observation report 01", site: "88 Totara Ave, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 55, items: [firestop("Basement · riser"), firecollar("Basement · grid A"), firestop("Basement · grid C")] },
  { doc: "Fire observation report 02", site: "88 Totara Ave, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 48, items: [firestop("L1 · corridor"), { cat: "Fire", title: "Fire door gap exceeds tolerance", detail: "Perimeter gap to the L1 fire door exceeds the tested tolerance; adjust the door and stops.", loc: "L1 · corridor" }] },
  { doc: "Fire observation report 03", site: "88 Totara Ave, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 40, items: [firecollar("L2 · riser"), firestop("L2 · grid B")] },
  { doc: "Fire observation report 04", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 33, items: [firestop("L3 · riser"), { cat: "Fire", title: "Intumescent sealant missing at pipe penetration", detail: "Annular gap at the 65mm penetration has no sealant; seal both sides and label.", loc: "L3 · riser" }] },
  { doc: "Fire observation report 05", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 26, items: [firestop("L4 · grid C"), firecollar("L4 · grid C")] },
  { doc: "Fire observation report 06", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 18, items: [firestop("Basement car park · grid F"), acoustic("L2 · inter-tenancy")] },

  // ── Hydraulic (drainage theme) ──
  { doc: "Hydraulic observation report 01", site: "27 Rata Street, Hamilton", source: "consultant", type: "Hydraulic", inspector: "Downpipe Consulting", outcome: "partial", daysAgo: 58, items: [drainfall("Basement · plant room"), { cat: "Plumbing & Drainage", title: "Tundish missing", detail: "Ø100mm tundish not installed at the plant room; confirm and install.", loc: "Basement · plant room" }] },
  { doc: "Hydraulic observation report 02", site: "27 Rata Street, Hamilton", source: "consultant", type: "Hydraulic", inspector: "Downpipe Consulting", outcome: "partial", daysAgo: 44, items: [drainfall("L1 · wet areas"), drainfall("L2 · wet areas")] },
  { doc: "Hydraulic observation report 03", site: "3 Miro Place, Tauranga", source: "consultant", type: "Hydraulic", inspector: "Downpipe Consulting", outcome: "partial", daysAgo: 31, items: [{ cat: "Plumbing & Drainage", title: "Penetration sleeves not installed", detail: "Sleeves for the drainage penetrations not installed before the pour; core-drill and make good.", loc: "L1 · slab" }, drainfall("L1 · shower")] },
  { doc: "Hydraulic observation report 04", site: "3 Miro Place, Tauranga", source: "consultant", type: "Hydraulic", inspector: "Downpipe Consulting", outcome: "partial", daysAgo: 20, items: [drainfall("Site · stormwater")] },

  // ── Structural (bracing/fixing) ──
  { doc: "Structural observation report 01", site: "88 Totara Ave, Auckland", source: "consultant", type: "Structural", inspector: "Totara Structural Consultants", outcome: "partial", daysAgo: 62, items: [bracing("Ground · grid 3"), { cat: "Structural", title: "Hold-down bolts not tightened", detail: "Hold-down bolts to the ground-floor bracing not tightened to spec; torque and mark.", loc: "Ground · grid 3" }] },
  { doc: "Structural observation report 02", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Structural", inspector: "Totara Structural Consultants", outcome: "partial", daysAgo: 46, items: [bracing("L1 · grid B"), { cat: "Structural", title: "Beam bearing insufficient", detail: "Transfer beam bearing at grid B less than detailed; provide the specified bearing length.", loc: "L1 · grid B" }] },
  { doc: "Structural observation report 03", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Structural", inspector: "Totara Structural Consultants", outcome: "partial", daysAgo: 28, items: [bracing("L2 · grid D")] },

  // ── Mechanical (duct/damper) ──
  { doc: "Mechanical observation report 01", site: "88 Totara Ave, Auckland", source: "consultant", type: "Mechanical", inspector: "AirCell Consulting", outcome: "partial", daysAgo: 52, items: [damper("L1 · corridor"), { cat: "Mechanical", title: "Duct support spacing exceeds spec", detail: "Supply duct supports spaced beyond the specified maximum; add supports.", loc: "L1 · ceiling" }] },
  { doc: "Mechanical observation report 02", site: "88 Totara Ave, Auckland", source: "consultant", type: "Mechanical", inspector: "AirCell Consulting", outcome: "partial", daysAgo: 36, items: [damper("L2 · corridor")] },
  { doc: "Mechanical observation report 03", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Mechanical", inspector: "AirCell Consulting", outcome: "partial", daysAgo: 22, items: [damper("L3 · corridor"), { cat: "Mechanical", title: "Flexible duct length excessive", detail: "Flexible duct to the L3 diffusers exceeds the maximum length; shorten and support.", loc: "L3 · ceiling" }] },

  // ── Electrical (cable segregation) ──
  { doc: "Electrical observation report 01", site: "27 Rata Street, Hamilton", source: "consultant", type: "Electrical", inspector: "Voltway Electrical Design", outcome: "partial", daysAgo: 50, items: [cable("L1 · riser"), { cat: "Electrical", title: "Cable tray not earthed", detail: "Cable tray section in the L1 riser not bonded; provide earth continuity.", loc: "L1 · riser" }] },
  { doc: "Electrical observation report 02", site: "27 Rata Street, Hamilton", source: "consultant", type: "Electrical", inspector: "Voltway Electrical Design", outcome: "partial", daysAgo: 34, items: [cable("L2 · ceiling")] },
  { doc: "Electrical observation report 03", site: "3 Miro Place, Tauranga", source: "consultant", type: "Electrical", inspector: "Voltway Electrical Design", outcome: "partial", daysAgo: 19, items: [cable("Basement · switch room"), { cat: "Electrical", title: "Penetration not fire-stopped", detail: "Cable penetration through the switch room wall not fire-stopped; seal to the wall FRR.", loc: "Basement · switch room" }] },

  // ── one-off variety ──
  { doc: "Acoustic observation report 01", site: "27 Rata Street, Hamilton", source: "consultant", type: "Acoustic", inspector: "Quietline Acoustics", outcome: "partial", daysAgo: 38, items: [acoustic("L2 · inter-tenancy"), acoustic("L3 · inter-tenancy")] },
  { doc: "Seismic observation report 01", site: "88 Totara Ave, Auckland", source: "consultant", type: "Seismic", inspector: "Totara Structural Consultants", outcome: "partial", daysAgo: 42, items: [{ cat: "Seismic", title: "Ceiling seismic bracing missing", detail: "Suspended ceiling in the L1 lobby has no seismic bracing; brace per the ceiling design.", loc: "L1 lobby" }, { cat: "Seismic", title: "Services restraint not installed", detail: "Large-diameter pipe runs not seismically restrained; add restraints at required centres.", loc: "Basement" }] },
  { doc: "Architectural observation report 01", site: "42 Manuka Rd, Auckland", source: "consultant", type: "Architectural", inspector: "Aria Architects", outcome: "partial", daysAgo: 30, items: [weather("L5 · balcony threshold"), { cat: "Interior / Linings", title: "Wet area substrate not suitable", detail: "Standard plasterboard used behind the shower instead of the specified wet-area board; replace.", loc: "L2 · bathroom" }] },
];

async function seedInspections() {
  let inProgressBudget = 3; // a few items marked started, to show the worklist
  for (const insp of INSPECTIONS) {
    const on = iso(daysAgo(insp.daysAgo));
    const [row] = await db.insert(inspections).values({
      companyId: CID, projectId: PID, doc: insp.doc, source: insp.source,
      inspectionCode: insp.code ?? null, inspectionType: insp.type, inspector: insp.inspector,
      outcome: insp.outcome, inspectedOn: on, itemCount: insp.items.length,
      createdBy: UID, createdAt: daysAgo(insp.daysAgo),
    }).returning();
    for (const it of insp.items) {
      let ws = "not_done";
      if (inProgressBudget > 0 && it.cat === "Fire") { ws = "in_progress"; inProgressBudget--; }
      await db.insert(inspectionItems).values({
        companyId: CID, projectId: PID, inspectionId: row.id,
        category: it.cat, title: it.title, detail: it.detail, location: it.loc ?? null,
        inspectionCode: insp.code ?? null, inspectedOn: on, workStatus: ws,
        createdAt: daysAgo(insp.daysAgo),
      });
    }
  }
}

// ─── CHECKLISTS (a couple, one walked with pins) + QA FLAGS ────────────────
async function seedExtras() {
  const subRows = await db.insert(subs).values(SUBS.map((s) => ({ companyId: CID, name: s.name, email: s.email, trade: s.trade, createdBy: UID }))).returning();

  // Checklist 1 — a completed Unit 1 fire check with 2 needs-fixing (one sent)
  const fireSub = subRows.find((s) => s.trade === "Fire");
  const [cl1] = await db.insert(checklists).values({ companyId: CID, projectId: PID, kind: "inspection", title: "Unit 1 - Fire check", inspectionCode: "IPL", location: "Unit 1", status: "open", createdBy: UID, createdByName: UNAME, createdAt: daysAgo(6), updatedAt: daysAgo(5) }).returning();
  const cl1items = [
    { cat: "Fire", title: "Fire collar to 100mm uPVC penetration", detail: "Collar fixed hard to the soffit, both sides. GIB/Ryanfire detail.", source: "manufacturer", status: "issue", note: "Collar proud of slab, fixed one side only.", sentTo: fireSub?.name, sentStatus: "recorded" },
    { cat: "Fire", title: "Intumescent sealant at pipe penetration", detail: "Annular gap sealed both sides and labelled.", source: "manufacturer", status: "issue", note: "No sealant at the 65mm penetration.", sentTo: fireSub?.name, sentStatus: "recorded" },
    { cat: "Fire", title: "Fyreline sheet fastener centres", detail: "Screws at 200 crs to the GIB fire system.", source: "manufacturer", status: "ok" },
    { cat: "Fire", title: "Back-blocking at sheet joints", detail: "Back-blocking to all butt joints per the system.", source: "manufacturer", status: "ok" },
    { cat: "Fire", title: "Penetrations labelled", detail: "Each penetration labelled with the system and date.", source: "code", status: "na" },
  ];
  for (let i = 0; i < cl1items.length; i++) {
    const it = cl1items[i];
    const [ci] = await db.insert(checklistItems).values({ companyId: CID, projectId: PID, checklistId: cl1.id, ord: i, category: it.cat, title: it.title, detail: it.detail, source: it.source, status: it.status, note: it.note ?? null, sentTo: it.sentTo ?? null, sentAt: it.sentTo ? daysAgo(5) : null, sentStatus: it.sentStatus ?? null, checkedByName: it.status !== "pending" ? UNAME : null, checkedAt: it.status !== "pending" ? daysAgo(6) : null }).returning();
    if (it.status === "issue") await db.insert(planPins).values({ companyId: CID, projectId: PID, doc: pickDoc(i + 3), page: 1, x: 26 + i * 20, y: 40 + i * 12, recordType: "checklist_item", recordId: ci.id, label: String(i + 1), createdBy: UID });
  }

  // Checklist 2 — an in-progress Level 2 waterproofing check
  const [cl2] = await db.insert(checklists).values({ companyId: CID, projectId: PID, kind: "inspection", title: "Level 2 - Waterproofing check", inspectionCode: "ITK", location: "Level 2", status: "open", createdBy: UID, createdByName: UNAME, createdAt: daysAgo(2), updatedAt: daysAgo(1) }).returning();
  const cl2items = [
    { cat: "Weathertightness / Cladding", title: "Membrane upstand 150mm min above finished level", detail: "150mm minimum upstand at all walls.", source: "code", status: "ok" },
    { cat: "Weathertightness / Cladding", title: "Bond breaker at wall/floor junction", detail: "Bond breaker tape to all internal corners.", source: "manufacturer", status: "issue", note: "Missing bond breaker at the north corner." },
    { cat: "Weathertightness / Cladding", title: "Falls to the waste", detail: "Continuous fall to the waste, no ponding.", source: "code", status: "pending" },
  ];
  for (let i = 0; i < cl2items.length; i++) {
    const it = cl2items[i];
    await db.insert(checklistItems).values({ companyId: CID, projectId: PID, checklistId: cl2.id, ord: i, category: it.cat, title: it.title, detail: it.detail, source: it.source, status: it.status, note: it.note ?? null, checkedByName: it.status !== "pending" ? UNAME : null, checkedAt: it.status !== "pending" ? daysAgo(2) : null });
  }

  // Standalone QA flags on drawings (open / sent / done) with pins
  const flagDefs = [
    { title: "Drainage penetrations too small at basement", trade: "Plumbing & Drainage", note: "Several penetrations too small or wrong location; may hinder drainage to design.", status: "sent", sub: subRows.find((s) => s.trade === "Plumbing & Drainage") },
    { title: "Cable tray clashes with sprinkler main", trade: "Electrical", note: "Cable tray at grid C clashes with the sprinkler main; re-coordinate.", status: "open", sub: undefined },
    { title: "Bulkhead framing not to setout", trade: "Interior / Linings", note: "Lobby bulkhead framing 100mm off the RCP setout.", status: "done", sub: subRows.find((s) => s.trade === "Interior / Linings") },
  ];
  for (let i = 0; i < flagDefs.length; i++) {
    const f = flagDefs[i];
    const doc = pickDoc(i);
    const [flag] = await db.insert(qaFlags).values({
      companyId: CID, projectId: PID, doc, page: 1, n: i + 1, title: f.title, trade: f.trade, note: f.note,
      status: f.status, subName: f.sub?.name ?? null, subEmail: f.sub?.email ?? null,
      sentAt: f.status !== "open" ? daysAgo(4) : null, sentStatus: f.status !== "open" ? "recorded" : null,
      fixedAt: f.status === "done" ? daysAgo(1) : null, createdBy: UID, createdByName: UNAME, createdAt: daysAgo(7),
    }).returning();
    await db.insert(planPins).values({ companyId: CID, projectId: PID, doc, page: 1, x: 35 + i * 15, y: 55 - i * 10, recordType: "qa_flag", recordId: flag.id, label: String(i + 1), createdBy: UID });
  }
}

// ── run ──
console.log("Resetting demo data for Kauri Tower…");
await reset();
console.log("Seeding subs, checklists, flags…");
await seedExtras();
console.log("Seeding RFIs…");
await seedRfis();
console.log("Seeding inspections…");
await seedInspections();

const [{ c: rc }] = await db.select({ c: (await import("drizzle-orm")).sql<number>`count(*)` }).from(rfis).where(eq(rfis.projectId, PID));
const [{ c: ic }] = await db.select({ c: (await import("drizzle-orm")).sql<number>`count(*)` }).from(inspections).where(eq(inspections.projectId, PID));
console.log(`\nDone. ${rc} RFIs, ${ic} inspection reports, ${SUBS.length} subs, 2 checklists, 3 flags seeded into Kauri Tower.`);
process.exit(0);
