// Scenario probe for lib/docType.ts detection — realistic NZ document names.
//   npx tsx dev/test-doctype.mts
import { detectDocType } from "../lib/docType.ts";

const CASES: [string, string, string?][] = [
  // drawings
  ["A-101 Ground Floor Plan.pdf", "drawings"],
  ["S3.01 Level 3 Slab Details.pdf", "drawings"],
  ["Lot 1 & 2 Architectural Plans.pdf", "drawings"],
  ["STRUCTURAL Drawings Rev C.pdf", "drawings"],
  ["Kauri Tower Elevations.pdf", "drawings"],
  ["44000-AR-201 GA Level 2.pdf", "drawings"],
  ["Civil setout.pdf", "drawings"],
  ["S0.01-GENERAL-NOTES-&-SPECIFICATIONS-Rev.1.pdf", "drawings"],
  ["0-11.01-EXISTING-SITE-PLAN-Rev.1.pdf", "drawings"],
  ["2430073-442-BUILDING-CONSENT-CONSTRUCTION-Rev.0.pdf", "drawings"],
  // specs
  ["Architectural Specification.pdf", "specs"],
  ["4711 Masterspec Interior Linings.pdf", "specs"],
  ["Project Spec Rev B.pdf", "specs"],
  ["Specifications - Plumbing.pdf", "specs"],
  // reports & PS
  ["Fire Report Rev 3.pdf", "reports"],
  ["PS1 Design - Structural.pdf", "reports"],
  ["PS-3 Construction Statement.pdf", "reports"],
  ["Geotechnical Report 21 Pohutukawa.pdf", "reports"],
  ["Producer Statement PS4.pdf", "reports"],
  ["Acoustic Design Report.pdf", "reports"],
  ["Fire Engineering Design.pdf", "reports"],
  // scopes
  ["Scope of Works - Interior.pdf", "scopes"],
  ["Subcontract Agreement Brightspark.pdf", "scopes"],
  ["Electrical Trade Package.pdf", "scopes"],
  // other
  ["Building Consent BCO12345.pdf", "other"],
  ["Contract Works Insurance.pdf", "other"],
  ["Site Meeting Minutes 14 June.pdf", "other"],
  // fallback = drawings (pre-types behaviour)
  ["kauri-tower-full-set.pdf", "drawings"],
  // reviewer-reproduced regressions: title case, hyphenated PS/Masterspec, plural specs
  ["Roof Plan.pdf", "drawings", "This drawing forms part of the sub-contract works"],
  ["Ground Floor Plan.pdf", "drawings", "refer to specification for cladding"],
  ["Roof Details.pdf", "drawings", "PS1 to be provided by the engineer"],
  ["Elevations.pdf", "drawings", "REFER TO SPECIFICATION FOR CLADDING"],
  ["PS1-Structural Design.pdf", "reports"],
  ["4711-Masterspec.pdf", "specs"],
  ["Project Specs.pdf", "specs"],
  ["Drainage Plan.pdf", "drawings"],
  // first-page-text tiebreak: bland filename, spec text
  ["document-04.pdf", "specs", "PART 1 GENERAL. This specification covers the supply and installation of interior linings to..."],
  ["upload (3).pdf", "reports", "PRODUCER STATEMENT PS1 - DESIGN. Issued by: Matai Structural Engineers..."],
];

let bad = 0;
for (const [name, want, text] of CASES) {
  const got = detectDocType(name, text);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name} -> ${got}${ok ? "" : ` (want ${want})`}`);
}
console.log(bad === 0 ? "ALL PASS" : `${bad} FAILURES`);
process.exit(bad ? 1 : 0);
