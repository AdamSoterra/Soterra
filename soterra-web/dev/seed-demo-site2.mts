// ─── Demo data seed for the SECOND demo site ("Miro Lane Apartments") ──────
//
// The company-wide Insights view only earns its "across all your sites" line
// if a second site genuinely contributes reports. This seeds ~12 fictional
// inspections (council + consultant) onto the demo company's second project,
// with failure themes that OVERLAP Kauri Tower's (fire stopping, drainage
// falls, flashings, bracing) — recurring across sites is exactly the story
// Insights is meant to tell.
//
// The External pocket on each site stays that site's own (?level=project);
// Insights aggregates both.
//
// Idempotent: clears this project's inspections then re-seeds.
//   npx tsx dev/seed-demo-site2.mts
//
// All FICTIONAL: invented site, invented inspector organisations. Sub names
// never appear here at all.

import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { db } = await import("../lib/db.ts");
const { inspections, inspectionItems, projects } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");
const { firestop, firecollar, drainfall, bracing, weather, cable, damper } = await import("./demo-inspections-data.ts");
import type { Item } from "./demo-inspections-data.ts";

// ── verified ids ──
const PID = "7008f019-3076-4763-9323-cd22a3aa0cad"; // second demo project
const CID = "e9210ba0-b03b-402b-8cfa-e6fa66d39055";
const UID = "user_3GcPx9L3pXhpSe20wl9H5rTuS8E"; // Adam Domok (admin)
const SITE_NAME = "Miro Lane Apartments"; // was "Test Road 43" — a test name reads broken in a demo

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

type Insp = {
  doc: string; source: "council" | "consultant"; code?: string;
  type: string; inspector: string; outcome: "pass" | "partial" | "fail"; daysAgo: number; items: Item[];
};

const SITE2: Insp[] = [
  // ── Council statutory ──
  { doc: "BCA IFG Framing ML partial", source: "council", code: "IFG", type: "Framing", inspector: "Auckland Council", outcome: "fail", daysAgo: 34, items: [bracing("L1 · grid 3"), { cat: "Structural", title: "Bottom plate fixings over-spaced", detail: "Bottom plate fixings to the slab exceed the specified centres along the east wall; add fixings to the schedule.", loc: "L1 · east wall" }] },
  { doc: "BCA ICA Cavity wrap ML partial", source: "council", code: "ICA", type: "Cavity / wrap", inspector: "Auckland Council", outcome: "partial", daysAgo: 28, items: [weather("L2 · window heads"), { cat: "Weathertightness / Cladding", title: "Cavity closure missing at meter box", detail: "Cavity left open at the meter box penetration; fit the closure and seal to the wrap.", loc: "Ground · north" }] },
  { doc: "BCA IPP Plumbing ML partial", source: "council", code: "IPP", type: "Pre-line plumbing", inspector: "Auckland Council", outcome: "partial", daysAgo: 24, items: [{ cat: "Plumbing & Drainage", title: "Pipe not clipped at required centres", detail: "Hot and cold runs not clipped at the manufacturer's centres in the L2 wall; clip before lining.", loc: "L2 · wall" }, { cat: "Plumbing & Drainage", title: "Tempering valve not yet fitted", detail: "No tempering valve on the hot water supply to the sanitary fixtures; fit and set before final.", loc: "L2 · cylinder" }] },
  { doc: "BCA IPB Pre-line ML fail", source: "council", code: "IPB", type: "Pre-line", inspector: "Auckland Council", outcome: "fail", daysAgo: 18, items: [firestop("L2 · riser"), { cat: "Interior / Linings", title: "Insulation gaps at services", detail: "Batts cut short around services with visible voids at the dwangs; refit tight before lining.", loc: "L2 · north wall" }] },
  { doc: "BCA IPL Post-line ML partial", source: "council", code: "IPL", type: "Post-line", inspector: "Auckland Council", outcome: "partial", daysAgo: 11, items: [firecollar("L2 · grid 2")] },
  { doc: "BCA IDT Drainage ML pass", source: "council", code: "IDT", type: "Drainage", inspector: "Auckland Council", outcome: "pass", daysAgo: 9, items: [] },
  { doc: "BCA IF1 Final ML partial", source: "council", code: "IF1", type: "Final", inspector: "Auckland Council", outcome: "partial", daysAgo: 4, items: [{ cat: "Access & Barriers", title: "Barrier gap exceeds 100mm sphere", detail: "Opening at the stair barrier passes the 100mm sphere at the newel; close the gap to F4.", loc: "Stair core" }, { cat: "Access & Barriers", title: "Safety glazing markings not visible", detail: "No visible permanent markings on the stair-core glazing; provide certificates or mark on site.", loc: "Stair core" }] },

  // ── Consultant observations (no council verdict — filed as 'unknown') ──
  { doc: "Fire observation ML 01", source: "consultant", type: "Fire", inspector: "Kahikatea Fire Engineering", outcome: "partial", daysAgo: 20, items: [firestop("L1 · ceiling void"), damper("L1 · corridor")] },
  { doc: "Structural observation ML 01", source: "consultant", type: "Structural", inspector: "Southern Cross Structural", outcome: "partial", daysAgo: 16, items: [bracing("L2 · west wall")] },
  { doc: "Hydraulic observation ML 01", source: "consultant", type: "Hydraulic", inspector: "Clearflow Hydraulic Consultants", outcome: "partial", daysAgo: 14, items: [drainfall("Ground · north run")] },
  { doc: "Facade observation ML 01", source: "consultant", type: "Facade", inspector: "Envelope Facade Consulting", outcome: "partial", daysAgo: 8, items: [weather("L3 · parapet junction")] },
  { doc: "Electrical observation ML 01", source: "consultant", type: "Electrical", inspector: "Ampere Electrical Consulting", outcome: "partial", daysAgo: 6, items: [cable("L1 · riser")] },
];

async function main() {
  const [proj] = await db.select({ id: projects.id, name: projects.name, companyId: projects.companyId }).from(projects).where(eq(projects.id, PID));
  if (!proj) throw new Error(`project ${PID} not found`);
  if (proj.companyId !== CID) throw new Error(`project ${PID} is not in the demo company — refusing`);

  // A site named "Test Road 43" undermines the whole demo; give it a
  // credible fictional name (same convention as Kauri Tower).
  if (proj.name !== SITE_NAME) {
    await db.update(projects).set({ name: SITE_NAME }).where(eq(projects.id, PID));
    console.log(`renamed project: "${proj.name}" -> "${SITE_NAME}"`);
  }

  // Idempotent: this project's inspections only, then re-seed.
  await db.delete(inspectionItems).where(eq(inspectionItems.projectId, PID));
  await db.delete(inspections).where(eq(inspections.projectId, PID));

  let nItems = 0;
  for (const insp of SITE2) {
    const on = iso(daysAgo(insp.daysAgo));
    const [row] = await db.insert(inspections).values({
      companyId: CID, projectId: PID, doc: insp.doc, source: insp.source,
      inspectionCode: insp.code ?? null, inspectionType: insp.type, inspector: insp.inspector,
      // Same rule as the main seed: only a council (BCA) report carries a verdict.
      outcome: insp.source === "consultant" ? "unknown" : insp.outcome, inspectedOn: on, itemCount: insp.items.length,
      createdBy: UID, createdAt: daysAgo(insp.daysAgo),
    }).returning();
    for (const it of insp.items) {
      await db.insert(inspectionItems).values({
        companyId: CID, projectId: PID, inspectionId: row.id,
        category: it.cat, title: it.title, detail: it.detail, location: it.loc ?? null,
        inspectionCode: insp.code ?? null, inspectedOn: on, workStatus: "not_done",
        createdAt: daysAgo(insp.daysAgo),
      });
      nItems++;
    }
  }

  const graded = SITE2.filter((i) => i.source === "council");
  console.log(`seeded ${SITE2.length} inspections (${graded.length} council, ${SITE2.length - graded.length} consultant) · ${nItems} items on ${SITE_NAME}`);
  console.log("done.");
  process.exit(0);
}

main();
