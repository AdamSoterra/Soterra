// Verifies the seeded demo tells the right STORY (reads through the real
// analytics the app uses). Read-only. Run: npx tsx dev/verify-demo.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { rfiAnalytics, listRfis } = await import("../lib/rfi.ts");
const { topItems, categoryCounts } = await import("../lib/history.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");

const scope = unsafeScopeForTest("7b66634b-30ac-4722-9fbe-e375f273ecb2", "e9210ba0-b03b-402b-8cfa-e6fa66d39055", "user_3GcPx9L3pXhpSe20wl9H5rTuS8E");

let pass = true;
const check = (ok: boolean, msg: string) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); if (!ok) pass = false; };

// ── RFI register ──
const reg = await listRfis(scope);
const overdue = reg.filter((r) => r.overdue);
console.log("\nREGISTER:");
console.log(`  ${reg.length} RFIs · ${reg.filter((r) => r.status === "open").length} open · ${overdue.length} overdue · ${reg.filter((r) => r.status === "draft").length} draft · ${reg.filter((r) => r.status === "void").length} void`);
check(reg.length >= 20, "≥20 RFIs in the register");
check(overdue.length >= 3, `overdue rows present (${overdue.length})`);
check(reg.some((r) => r.status === "draft"), "a draft exists");
check(reg.some((r) => r.status === "void"), "a void exists");

// ── scorecard ──
const a = await rfiAnalytics(scope);
console.log("\nTILES:", JSON.stringify(a.tiles));
console.log("SCORECARD (worst first):");
for (const s of a.scorecard) console.log(`  ${s.consultant.padEnd(32)} open=${s.open} avg=${s.avgWd}wd median=${s.medianWd} sla=${s.pctInSla ?? "-"}% overdue=${s.overdue} reopen=${s.reopenPct}% answered=${s.answered}`);
const worst = a.scorecard[0];
const star = [...a.scorecard].filter((s) => s.answered > 0).sort((x, y) => x.avgWd - y.avgWd)[0];
check(a.scorecard.length >= 4, "≥4 consultants on the scorecard");
check(worst?.consultant.includes("Meridian"), `worst offender is Meridian (got ${worst?.consultant})`);
check(star?.consultant.includes("Totara"), `star is Totara (got ${star?.consultant})`);
check(a.scorecard.some((s) => s.reopenPct > 0), "at least one consultant shows reopens");
check(a.tiles.avgResponseWd > a.slaWd, `avg response over SLA (${a.tiles.avgResponseWd} vs ${a.slaWd})`);

// ── EOT pack ──
console.log("\nEOT PACK:");
for (const e of a.eot) console.log(`  ${e.label} · ${e.consultant} · net ${e.netLateWd}wd late · ${e.status}`);
check(a.eot.length >= 2, `EOT pack has ≥2 critical-path late RFIs (${a.eot.length})`);

// ── Insights ranking ──
const top = await topItems(scope, { limit: 12 });
console.log("\nTOP FAILURES (Insights):");
for (const t of top.slice(0, 8)) console.log(`  ${String(t.count).padStart(2)}×  ${t.title}  [${t.category}]`);
check(top.length >= 5, "Insights has a ranked list");
check((top[0]?.count ?? 0) >= 3, `top failure repeats (${top[0]?.count}× ${top[0]?.title})`);
const cats = await categoryCounts(scope);
console.log("\nCATEGORY SPREAD:", cats.map((c) => `${c.category}:${c.count}`).join(" · "));
check(cats.length >= 6, `failures span ≥6 categories (${cats.length})`);

console.log(pass ? "\nALL PASS ✅ — the demo tells the story" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
