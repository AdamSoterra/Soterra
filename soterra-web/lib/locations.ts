import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { planPages } from "./schema";

// Derive the physical LOCATIONS a QA check can be scoped to (Unit 1, Level 12,
// Tower A, Basement Car Park, Site-wide…) from a project's own drawing titles.
// General by construction: it reads whatever titles a company uploaded, so it
// works for any account without setup. The prompt below was hardened by an
// adversarial stress-test across five naming conventions (residential, apartment
// tower, commercial towers+podium, school blocks, and a deliberately unnamed set)
// — every rule here is a failure that test surfaced.
//
// Design note (from the spec): the RIGHT home for this call is plan-ingest, with
// the result cached per project keyed on a title fingerprint, so the picker at
// check-creation is a cache read, never a model round-trip. For now this module
// computes on demand with an in-memory fingerprint cache; the persistent
// ingest-time cache + user-edit merge is the next hardening step.

const MODEL = "claude-opus-4-8";

export type LocationKind = "unit" | "level" | "building" | "zone" | "site";
export interface QaLocation {
  label: string;
  kind: LocationKind;
  drawings: string[];
  source: "extracted" | "user";
}

const KINDS: LocationKind[] = ["unit", "level", "building", "zone", "site"];

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    locations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "kind", "drawings"],
        properties: {
          label: { type: "string", minLength: 1 },
          kind: { type: "string", enum: KINDS },
          drawings: { type: "array", minItems: 1, items: { type: "string" } },
        },
      },
    },
  },
  required: ["locations"],
};

const SYSTEM = `You are a LOCATION EXTRACTOR for a New Zealand construction QA app.

You are given the DRAWING TITLES (sheet names / PDF filenames) from ONE project's plan set. Return the distinct PHYSICAL LOCATIONS a site QA check could be scoped to — reading ONLY what the titles actually name.

A location is a real, walk-to part of the job: a unit/apartment; a floor/level (Ground, Basement, Roof, Mezzanine, Podium); a building/tower/block/stage; a named zone (car park, lobby, plant room, pool, retail tenancy, bin store, substation, pump room, retaining wall…); a named standalone facility (Gymnasium, Hall, Library, Admin, Clubhouse); or the whole site.

WHAT IS NOISE (never a location):
1. DRAWING-TYPE words — ignore: plan, floor plan, roof plan, GA/general arrangement, layout, RCP, setout, levels plan/site levels/RL/reduced levels, detail(s), section(s), elevation(s), schedule(s), schematic, diagram, riser, matrix, legend, key/key plan, index, drawing list, general notes, notes, specification/spec, cover/title, revision/rev, sheet, drawing, typical, standard, type/types.
2. SHEET/JOB/CONSULTANT CODES — ignore any leading alphanumeric code: A2.05, S3.01, E-100, C1.2, AR-A-L01, 44000-, AR109209-09-. Leading numbers like 44000, 109209, 09, 13 are CODES, never "Unit 44000" / "Level 13".
3. BUILDING ELEMENTS on detail/section/elevation sheets — a stair, stair core, balustrade, lift shaft, facade, wall, beam, column, slab, foundation, door, window is a DETAIL SUBJECT, not a place ("Typical Balustrade Details", "Stair Core Details" → nothing). A stair/lift core is a zone ONLY on a dedicated core PLAN/GA.
4. TYPOLOGIES — a unit named only by TYPE is a template, not a place: "Unit Type A", "Type 1 Unit", "Typical Unit", "Apartment Type B" → nothing. A unit qualifies only as a UNIQUE INSTANCE (Unit 1, Apartment 3B).
5. BARE letters/numbers with NO location noun beside them are not locations ("A", "1", "Drawing 1", "Sheet A", "Rev C", "Section 1"). Accept a bare identifier ONLY when a sibling title already established the pattern with an explicit noun (e.g. "Level 1" + "Level 2" present makes a lone "L3" safe).
6. "SECTION N" — a drawing cross-section (noise) UNLESS corroborated by "Lot"/subdivision context (then an NZ land parcel). When unsure, prefer noise.
7. "BLOCK PLAN" (a site location plan) is a drawing type → Site-wide, NOT a building. "Block" is a building ONLY with an identifier ("Block A").

HARD RULES:
R1. NEVER invent. Every location MUST be named in the titles. If in doubt, leave it out.
R2. Strip type/code/element words from a title; if NOTHING location-shaped remains, it contributes NOTHING ("A0.01 General Notes", "S9.01 Beam Schedule" → ignored).
R3. Type words disqualify a title ONLY if nothing is left. "S3.02 Level 3 Slab Details" still yields Level 3.
R4. If the whole set names no real location, return an EMPTY list. Do NOT fall back to "Site-wide" to fill the gap. Empty is the signal the UI uses to offer free-typing. Conversely a rich, well-named set must NOT come back empty.
R5. Only emit "Site-wide" for a drawing that genuinely covers the whole site (site plan, location/block plan, external works, roading, site levels/services, overall site GA). Never as a default.

NORMALISE & DEDUP:
- Strip leading zeros and unify spelling: "UNIT-01"/"U1"/"Unit 1" → Unit 1; "L03"/"Level 03"/"LEVEL-3" → Level 3.
- STOREY NAMING is NZ/UK: Ground Floor/GF → "Ground Floor"; First Floor → Level 1; Second Floor → Level 2; Basement/B1 → "Basement" ("Basement 1" only if numbered); Roof, Mezzanine, Podium kept as named.
- EXPAND enumerations/ranges: "1&2" → 1,2; "1-4"/"1 TO 4" → 1,2,3,4; "U1/U2" → 1,2.
- Keep the location noun as written (Unit vs Apartment, Tower vs Block vs Building), Title Case. Merge every title pointing at the same location into ONE entry.

CONTAINERS & GROUPING — a CONTAINER = a named Unit, Building, Tower, Block, Stage, Podium. Count its distinct named sub-levels, then:
- 0 sub-levels → ONE entry: the container itself (e.g. "Gymnasium").
- 1 sub-level → ONE entry: the container itself ("Block B", "Unit 1"), with BOTH the container's sheets AND that single floor's sheet. Do NOT also emit a separate level entry.
- 2+ sub-levels → the container as a ROLL-UP entry PLUS one composite per level ("Tower A - Level 3").
Standalone facilities on a multi-building site are kind "building". A site plan that also names units (e.g. "Unit 1&2 Site Plan") attaches to EACH named unit AND to Site-wide.

EXTERNAL WORKS: dispersed external works (landscape, roading, drainage, site levels, external works, site services) → Site-wide (plan OR section). A discretely-bounded, walk-to built area → its own zone (Basement Car Park, Retaining Wall, Substation, Pump Room, Bin Store, Pool).

KIND: building=tower/block/building/stage/podium/standalone facility. level=floor incl. Ground/Basement/Roof/Mezzanine. zone=named functional area (not unit/level/building). site=whole site. A container ROLL-UP takes its own noun's kind (unit or building). A "<Container> - Level N" composite is always "level". Otherwise pick the FIRST that applies: unit, zone, level, building, site.

LABEL: short and tappable — "Unit 1", "Level 12", "Block B", "Tower A - Level 3", "Basement Car Park", "Site-wide". Use a PLAIN HYPHEN with spaces " - " as the composite separator (never an em/en dash).

ORDERING: 1) multi-level containers alphanumerically, each followed by its composites in floor order (Basement → Ground → Level 1..N → Roof); 2) single-scope standalone buildings/facilities; 3) standalone units ascending; 4) zones; 5) "Site-wide" last.

OUTPUT: return {"locations": [ … ]}. Each item {"label", "kind", "drawings"} where drawings are the EXACT source titles (verbatim from the input), non-empty. If nothing names a place, return {"locations": []}.`;

// In-memory cache keyed on the title fingerprint (temperature-0 on fixed input →
// stable). Production: persist per project at ingest + merge user edits.
const CACHE = new Map<string, QaLocation[]>();

function normaliseTitles(raw: string[]): string[] {
  // Real title lists can arrive comma-joined on one line — split on BOTH.
  return [...new Set(raw.flatMap((t) => t.split(/[\n,]+/)).map((s) => s.trim()).filter(Boolean))];
}

/** Derive locations from a raw list of drawing titles. Returns [] when nothing names a place. */
export async function deriveLocations(rawTitles: string[]): Promise<QaLocation[]> {
  const titles = normaliseTitles(rawTitles);
  if (titles.length === 0) return [];
  const fp = createHash("sha1").update(titles.slice().sort().join("|")).digest("hex");
  const hit = CACHE.get(fp);
  if (hit) return hit;

  const anthropic = new Anthropic({ maxRetries: 2 });
  let out: QaLocation[] = [];
  try {
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [{ role: "user", content: "DRAWING TITLES (one per line):\n" + titles.map((t) => "- " + t).join("\n") }],
    } as Parameters<typeof anthropic.messages.create>[0]);
    const text = (resp as Anthropic.Message).content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text) as { locations?: Array<Record<string, unknown>> };
    const titleSet = new Set(titles);
    const seen = new Set<string>();
    for (const l of Array.isArray(parsed.locations) ? parsed.locations : []) {
      const label = String(l.label ?? "").trim();
      const kind = (KINDS as string[]).includes(String(l.kind)) ? (l.kind as LocationKind) : "zone";
      // verbatim-membership: the model may not cite a title we didn't send
      const drawings = (Array.isArray(l.drawings) ? l.drawings : []).map(String).filter((d) => titleSet.has(d));
      const key = label.toLowerCase();
      if (!label || drawings.length === 0 || seen.has(key)) continue; // drop untrustworthy items
      seen.add(key);
      out.push({ label, kind, drawings, source: "extracted" });
    }
  } catch (e) {
    console.error("deriveLocations failed:", e);
    return [];
  }
  CACHE.set(fp, out);
  return out;
}

/** Locations for a project, derived from its uploaded plan drawing titles. */
export async function getProjectLocations(projectId: string): Promise<QaLocation[]> {
  const rows = await db.select({ doc: planPages.doc }).from(planPages).where(eq(planPages.projectId, projectId));
  return deriveLocations([...new Set(rows.map((r) => r.doc))]);
}

/** Clear the in-memory cache (e.g. after a new plan upload for a project). */
export function resetLocationCache(): void {
  CACHE.clear();
}
