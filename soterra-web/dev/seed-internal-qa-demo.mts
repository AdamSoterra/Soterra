// Seed the Internal inspections pocket on the Kauri Tower DEMO project with a
// credible pre-inspection QA story: five checks the crew has walked (or is
// walking), every item cited, some flagged-and-fixed BEFORE the inspector
// arrived. This is what fills the internal tiles + the "what your pre-checks
// catch" panel when Adam demos it.
//
// The story it tells:
//   L6 fire + linings        - done, 2 caught (fire-stopping, collars) — the classic pre-line saves
//   L2 weathertightness      - done, 1 caught (head-flashing stop-ends)
//   Pre-line plumbing        - done, CLEAN (the crew can pass its own check)
//   Structural bracing       - open, 1 caught so far
//   Barriers + glazing       - open, 1 caught so far
//   => 5 checks · 17/19 items checked · 5 flagged · 33% clean pass · 1.0 avg to fix
//
// ⚠️ Guardrails: every item carries a real citation (source + source_ref) — an
// uncited item is a guess and doesn't ship. Sub names in notes are GENERIC
// TRADE ROLES, never invented brands. Demo project only.
//
// Idempotent: previously-seeded checks are recognised by created_by =
// 'demo-seed-internal' and deleted before re-inserting. Re-run any time:
//   npx tsx dev/seed-internal-qa-demo.mts
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url!);
const PROJECT = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower (demo)
const SEED_BY = "demo-seed-internal"; // marker: lets the seed find and replace its own rows
const CHECKER = "Adam";

const dAgo = (days: number) => new Date(Date.now() - days * 864e5);

type Item = {
  title: string;
  detail: string;
  source: "plans" | "code" | "manufacturer" | "history";
  ref: string;
  category: string;
  status: "pending" | "ok" | "issue" | "na";
  note?: string;
};
type Check = {
  title: string;
  code: string | null;
  location: string | null;
  status: "open" | "done";
  createdAgo: number;
  checkedAgo: number; // when the ticked items were walked
  items: Item[];
};

const CHECKS: Check[] = [
  {
    title: "L6 fire and linings pre-line",
    code: "IPB",
    location: "Level 6",
    status: "done",
    createdAgo: 16,
    checkedAgo: 15,
    items: [
      {
        title: "Passive fire-stopping to every penetration before lining",
        detail: "Every service penetration through the FRR floors and walls fire-stopped and tagged before the linings close them up.",
        source: "code", ref: "C/AS2 §4 · AS 4072.1", category: "Fire",
        status: "issue", note: "Three penetrations above the L6 ceiling grid not stopped. Fire Stopping Contractor re-booked, re-walked and cleared.",
      },
      {
        title: "Fire collars to plastic pipes through the FRR slab",
        detail: "Proprietary fire collar on every uPVC waste through the rated floor, fitted to the tested system.",
        source: "code", ref: "C/AS2 §4 · tested fire-collar system", category: "Fire",
        status: "issue", note: "Two wastes on the west riser uncollared. Collars fitted the next day, photo on file.",
      },
      {
        title: "Fire-rated board type and face correct, 13mm to the separation",
        detail: "13mm fire-rated board to the tenancy separation, correct face out, laid to the specified system.",
        source: "manufacturer", ref: "Spec · GIB Fire Rated Systems manual", category: "Interior / Linings",
        status: "ok",
      },
      {
        title: "Insulation fitted tight, no gaps at dwangs or services",
        detail: "Batts friction-fit with no compression behind services and no voids at dwangs.",
        source: "code", ref: "NZS 4246 · H1", category: "Interior / Linings",
        status: "ok",
      },
      {
        title: "Nogs and dwangs in for all sheet edges and wall-hung fixtures",
        detail: "Every sheet edge supported, blocking in for vanities, rails and wall-hung fittings before close-up.",
        source: "manufacturer", ref: "GIB Site Guide", category: "Interior / Linings",
        status: "ok",
      },
    ],
  },
  {
    title: "L2 weathertightness and waterproofing",
    code: "ICA",
    location: "Level 2",
    status: "done",
    createdAgo: 12,
    checkedAgo: 11,
    items: [
      {
        title: "20mm drained cavity on battens behind absorbent cladding",
        detail: "Cavity battens 20mm, drainage path open at the base, no direct-fix in this wind zone.",
        source: "code", ref: "E2/AS1 §9.1.8", category: "Weathertightness / Cladding",
        status: "ok",
      },
      {
        title: "Window head flashings, 15° fall minimum with stop-ends",
        detail: "Head flashing falls at least 15°, stop-ends both ends, cover per the E2 tables.",
        source: "code", ref: "E2/AS1 §9.1.4", category: "Weathertightness / Cladding",
        status: "issue", note: "Stop-ends missing on two north-face heads. Cladding Contractor re-fitted them before close-in.",
      },
      {
        title: "Deck and threshold membrane upstands, 150mm minimum",
        detail: "Membrane carried at least 150mm up the wall at decks and door thresholds.",
        source: "code", ref: "E2/AS1 §8 · membrane manufacturer's spec", category: "Weathertightness / Cladding",
        status: "ok",
      },
      {
        title: "Wet-area floor membrane up walls with bond breaker at junctions",
        detail: "Membrane returned up the wall, bond breaker at every floor-wall junction.",
        source: "code", ref: "E3/AS1 · membrane manufacturer's spec", category: "Weathertightness / Cladding",
        status: "ok",
      },
    ],
  },
  {
    title: "Pre-line plumbing",
    code: "IPP",
    location: "Levels 1-3",
    status: "done",
    createdAgo: 8,
    checkedAgo: 7,
    items: [
      {
        title: "Hot and cold pressure-tested and held before lining",
        detail: "System under test pressure and held per G12 before any lining goes on.",
        source: "code", ref: "G12/AS1", category: "Plumbing & Drainage",
        status: "ok",
      },
      {
        title: "Pipe penetrations through fire separations collared and sealed",
        detail: "Every pipe through a fire separation collared or sealed to the tested system.",
        source: "code", ref: "C/AS2 · G12", category: "Fire",
        status: "ok",
      },
      {
        title: "Pipe clips and supports at correct centres for the pipe type",
        detail: "Support centres to the pipe manufacturer's table for the material and run.",
        source: "code", ref: "G12/AS1 · pipe manufacturer's spec", category: "Plumbing & Drainage",
        status: "ok",
      },
      {
        title: "Tempering valve limiting sanitary fixtures to 55°C",
        detail: "Tempering valve fitted and set so sanitary fixtures deliver no more than 55°C.",
        source: "code", ref: "G12/AS1", category: "Plumbing & Drainage",
        status: "ok",
      },
    ],
  },
  {
    title: "Structural pre-line, bracing and fixings",
    code: "IFG",
    location: "Level 3",
    status: "open",
    createdAgo: 4,
    checkedAgo: 3,
    items: [
      {
        title: "Bracing elements fixed per the bracing plan, BUs recorded",
        detail: "Every bracing element built and fixed as the bracing schedule shows, with the achieved BUs recorded.",
        source: "code", ref: "NZS 3604 §5 · engineer's PS1", category: "Structural",
        status: "issue", note: "Panel fixings on grid C at wider centres than the bracing schedule. Framing Contractor re-nailing to the schedule.",
      },
      {
        title: "Bottom-plate fixings to slab at the specified centres",
        detail: "Bottom plates fixed to the slab at the centres the plan and NZS 3604 call for.",
        source: "code", ref: "NZS 3604 §7.5", category: "Structural",
        status: "ok",
      },
      {
        title: "Fixings correct for the wind and earthquake zone",
        detail: "Fixing types and spacings match the site's wind and earthquake zone, not the generic minimum.",
        source: "code", ref: "NZS 3604", category: "Structural",
        status: "pending",
      },
    ],
  },
  {
    title: "Barriers and safety glazing, fit-out",
    code: "IF2",
    location: "Stair cores",
    status: "open",
    createdAgo: 2,
    checkedAgo: 1,
    items: [
      {
        title: "Barriers 1000mm minimum, no 100mm sphere gap, non-climbable",
        detail: "Barrier height at least 1000mm, no opening passes a 100mm sphere, no climbable elements.",
        source: "code", ref: "F4/AS1", category: "Access & Barriers",
        status: "ok",
      },
      {
        title: "Grade A safety glazing to doors, side panels and low panes",
        detail: "Grade A safety glass in doors, side panels, wet areas and low panes, with visible permanent markings.",
        source: "code", ref: "NZS 4223.3", category: "Access & Barriers",
        status: "issue", note: "Stair-core panes have no visible safety markings. Certificates requested from Glazing Contractor before sign-off.",
      },
      {
        title: "Handrails 900-1000mm, graspable profile",
        detail: "Handrail height 900-1000mm above the pitch line, profile graspable along the full run.",
        source: "code", ref: "D1/AS1", category: "Access & Barriers",
        status: "pending",
      },
    ],
  },
];

async function main() {
  const [proj] = await sql(`select company_id from projects where id=$1`, [PROJECT]);
  if (!proj) throw new Error(`project ${PROJECT} not found`);
  const company = proj.company_id as string;

  // 1) Remove what a previous run of this seed created, then re-insert.
  const old = await sql(`select id from checklists where project_id=$1 and created_by=$2`, [PROJECT, SEED_BY]);
  if (old.length) {
    const ids = old.map((r) => r.id);
    await sql(`delete from checklist_items where checklist_id = any($1::uuid[])`, [ids]);
    await sql(`delete from checklist_photos where checklist_id = any($1::uuid[])`, [ids]);
    await sql(`delete from checklists where id = any($1::uuid[])`, [ids]);
    console.log(`removed ${old.length} previously seeded checks`);
  }

  let nItems = 0;
  for (const c of CHECKS) {
    const created = dAgo(c.createdAgo);
    const walked = dAgo(c.checkedAgo);
    const [head] = await sql(
      `insert into checklists (company_id, project_id, kind, title, inspection_code, location, status, created_by, created_by_name, created_at, updated_at)
       values ($1,$2,'inspection',$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz) returning id`,
      [company, PROJECT, c.title, c.code, c.location, c.status, SEED_BY, CHECKER, created, walked]
    );
    for (let i = 0; i < c.items.length; i++) {
      const it = c.items[i];
      const ticked = it.status !== "pending";
      await sql(
        `insert into checklist_items (company_id, project_id, checklist_id, ord, category, title, detail, source, source_ref, status, note, checked_by, checked_by_name, checked_at, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz)`,
        [
          company, PROJECT, head.id, i, it.category, it.title, it.detail, it.source, it.ref,
          it.status, it.note ?? null,
          ticked ? SEED_BY : null, ticked ? CHECKER : null, ticked ? walked : null,
          created,
        ]
      );
      nItems++;
    }
  }

  // 2) Report what the tiles will now show.
  const flagged = CHECKS.flatMap((c) => c.items).filter((i) => i.status === "issue").length;
  const checked = CHECKS.flatMap((c) => c.items).filter((i) => i.status !== "pending").length;
  const done = CHECKS.filter((c) => c.status === "done");
  const clean = done.filter((c) => c.items.every((i) => i.status !== "issue")).length;
  console.log(`seeded ${CHECKS.length} checks · ${nItems} items`);
  console.log(`tiles → checks run ${CHECKS.length} · items checked ${checked} · flagged ${flagged} · clean pass ${Math.round((clean / done.length) * 100)}% · avg to fix ${(flagged / CHECKS.length).toFixed(1)}`);
  console.log("done.");
}

main().then(() => process.exit(0));
