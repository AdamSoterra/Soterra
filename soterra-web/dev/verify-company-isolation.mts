/**
 * THE test for Step 0: prove company A cannot read company B's rows.
 *
 * "If Hawkins ever sees Kalmar's failure data, that is not a bug — it ends the
 * business." So this doesn't test a reimplementation of the rules; it seeds two
 * real companies into the real database and calls the REAL query layer
 * (lib/company.ts, lib/history.ts, lib/checklist.ts) exactly as the API routes
 * do. If a filter is ever dropped from any of those, this goes red.
 *
 * Run from soterra-web:  npx tsx dev/verify-company-isolation.mts
 * Seeds and then deletes its own data. Touches nothing else.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

// Dynamic import AFTER env is loaded — lib/db.ts reads DATABASE_URL at module load.
const { db } = await import("../lib/db.ts");
const schema = await import("../lib/schema.ts");
const company = await import("../lib/company.ts");
const history = await import("../lib/history.ts");
const checklist = await import("../lib/checklist.ts");
const { eq, inArray } = await import("drizzle-orm");

const { companies, projects, projectMembers, inspections, inspectionItems, checklists, checklistItems, checklistPhotos } = schema;

let failures = 0;
function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) failures++;
}

// ─── Seed two companies that must never see each other ───
const tag = `isotest-${Date.now()}`;
const A = { companyId: randomUUID(), projectId: `${tag}-a`, userId: `${tag}-user-a`, name: "Company A (test)" };
const B = { companyId: randomUUID(), projectId: `${tag}-b`, userId: `${tag}-user-b`, name: "Company B (test)" };

async function seed(c: typeof A, secret: string) {
  await db.insert(companies).values({ id: c.companyId, name: c.name });
  await db.insert(projects).values({ id: c.projectId, name: `${c.name} site`, code: `${tag.slice(-6).toUpperCase()}-${c.projectId.slice(-1).toUpperCase()}XX`, companyId: c.companyId, creatorId: c.userId });
  await db.insert(projectMembers).values({ projectId: c.projectId, userId: c.userId, name: "Tester", role: "admin", colorIndex: 0 });

  const [insp] = await db
    .insert(inspections)
    .values({ companyId: c.companyId, projectId: c.projectId, doc: `${tag}-report`, source: "council", inspectionCode: "ICA", inspectionType: "Cavity wrap", outcome: "fail", inspectedOn: "2026-02-21", itemCount: 1, createdBy: c.userId })
    .returning();
  await db.insert(inspectionItems).values({ companyId: c.companyId, projectId: c.projectId, inspectionId: insp.id, category: "Weathertightness / Cladding", title: secret, detail: `${secret} detail`, inspectionCode: "ICA", inspectedOn: "2026-02-21" });

  const [cl] = await db.insert(checklists).values({ companyId: c.companyId, projectId: c.projectId, kind: "inspection", title: `${secret} checklist`, inspectionCode: "ICA", createdBy: c.userId }).returning();
  const [item] = await db.insert(checklistItems).values({ companyId: c.companyId, projectId: c.projectId, checklistId: cl.id, ord: 0, title: `${secret} item`, source: "manual" }).returning();
  const photoPath = `${c.projectId}/checklists/${secret}.jpg`;
  await db.insert(checklistPhotos).values({ companyId: c.companyId, projectId: c.projectId, checklistId: cl.id, itemId: item.id, url: photoPath, takenBy: c.userId });

  return { inspectionId: insp.id, checklistId: cl.id, itemId: item.id, photoPath };
}

async function cleanup() {
  const ids = [A.projectId, B.projectId];
  await db.delete(checklistPhotos).where(inArray(checklistPhotos.projectId, ids));
  await db.delete(checklistItems).where(inArray(checklistItems.projectId, ids));
  await db.delete(checklists).where(inArray(checklists.projectId, ids));
  await db.delete(inspectionItems).where(inArray(inspectionItems.projectId, ids));
  await db.delete(inspections).where(inArray(inspections.projectId, ids));
  await db.delete(projectMembers).where(inArray(projectMembers.projectId, ids));
  await db.delete(projects).where(inArray(projects.id, ids));
  await db.delete(companies).where(inArray(companies.id, [A.companyId, B.companyId]));
}

const SECRET_A = "ALPHASECRET cavity batten fixing";
const SECRET_B = "BRAVOSECRET cavity batten fixing";

try {
  const seedA = await seed(A, SECRET_A);
  const seedB = await seed(B, SECRET_B);

  const scopeA = company.unsafeScopeForTest(A.projectId, A.companyId, A.userId);

  console.log("\n── the boundary itself ──");
  const headerReq = (pid: string) => new Request("https://x/y", { headers: { "x-soterra-project": pid } });
  check("resolveScope: user A on their OWN project resolves", (await company.resolveScope(headerReq(A.projectId), A.userId))?.companyId === A.companyId);
  check("resolveScope: user A claiming company B's project is REFUSED", (await company.resolveScope(headerReq(B.projectId), A.userId)) === null);
  check("resolveScope: no header is refused", (await company.resolveScope(new Request("https://x/y"), A.userId)) === null);
  check("companyIdForProject: A cannot resolve B's project to a company", (await company.companyIdForProject(B.projectId, A.userId)) === null);
  const forged = await company.resolveScope(headerReq(A.projectId), A.userId);
  check("companyId comes from the PROJECT ROW, not the request", forged?.companyId === A.companyId && forged?.companyId !== B.companyId);
  check("companyProjects lists only A's sites", (await company.companyProjects(scopeA)).every((p) => p.id === A.projectId));

  console.log("\n── inspection history ──");
  const counts = await history.categoryCounts(scopeA);
  check("categoryCounts totals only A's items", counts.reduce((n, c) => n + c.count, 0) === 1, JSON.stringify(counts));
  const top = await history.topItems(scopeA, { limit: 50 });
  check("topItems excludes B", top.every((t) => !t.title.includes("BRAVOSECRET")) && top.some((t) => t.title.includes("ALPHASECRET")));
  const list = await history.listInspections(scopeA, { limit: 200 });
  check("listInspections excludes B", list.every((r) => r.projectId !== B.projectId) && list.some((r) => r.id === seedA.inspectionId));
  check("inspectionDetail refuses B's inspection id", (await history.inspectionDetail(scopeA, seedB.inspectionId)) === null);
  check("inspectionDetail returns A's own", (await history.inspectionDetail(scopeA, seedA.inspectionId))?.items.length === 1);
  const searched = await history.searchHistory(scopeA, "cavity batten fixing", { limit: 50 });
  check("searchHistory excludes B on a query that matches BOTH", searched.every((r) => !r.title.includes("BRAVOSECRET")) && searched.some((r) => r.title.includes("ALPHASECRET")), `${searched.length} row(s)`);
  const forCode = await history.historyForCode(scopeA, "ICA", 50);
  check("historyForCode excludes B", forCode.every((r) => !r.title.includes("BRAVOSECRET")));
  const summary = await history.historySummary(scopeA);
  check("historySummary counts only A", summary.inspections === 1 && summary.failedItems === 1, JSON.stringify(summary));

  console.log("\n── checklists ──");
  check("getChecklist refuses B's checklist", (await checklist.getChecklist(scopeA, seedB.checklistId)) === null);
  check("getChecklist returns A's own", (await checklist.getChecklist(scopeA, seedA.checklistId))?.items.length === 1);
  const listed = await checklist.listChecklists(scopeA);
  check("listChecklists excludes B", listed.every((c) => c.id !== seedB.checklistId) && listed.some((c) => c.id === seedA.checklistId));
  check("updateChecklistItem refuses B's item", (await checklist.updateChecklistItem(scopeA, seedB.itemId, { status: "ok" })) === null);
  check("updateChecklistItem works on A's own item", (await checklist.updateChecklistItem(scopeA, seedA.itemId, { status: "ok" }))?.status === "ok");
  check("addChecklistItem refuses B's checklist", (await checklist.addChecklistItem(scopeA, seedB.checklistId, { title: "x" })) === null);
  check("setChecklistStatus refuses B's checklist", (await checklist.setChecklistStatus(scopeA, seedB.checklistId, "done")) === null);
  check("addChecklistPhoto refuses B's item", (await checklist.addChecklistPhoto(scopeA, seedB.itemId, "x/y.jpg", null)) === null);
  check("photoIsOurs is false for B's photo path", (await checklist.photoIsOurs(scopeA, seedB.photoPath)) === false);
  check("photoIsOurs is true for A's own photo path", (await checklist.photoIsOurs(scopeA, seedA.photoPath)) === true);
  check("deleteChecklist refuses B's checklist", (await checklist.deleteChecklist(scopeA, seedB.checklistId)) === false);

  console.log("\n── B is still intact (A's calls didn't delete or mutate it) ──");
  const bItems = await db.select().from(checklistItems).where(eq(checklistItems.checklistId, seedB.checklistId));
  check("B's checklist item still exists and is still pending", bItems.length === 1 && bItems[0].status === "pending");
  const bLists = await db.select().from(checklists).where(eq(checklists.id, seedB.checklistId));
  check("B's checklist still exists and is still open", bLists.length === 1 && bLists[0].status === "open");
} finally {
  await cleanup();
}

console.log(`\n${failures === 0 ? "COMPANY ISOLATION HOLDS ✅" : `COMPANY ISOLATION BROKEN — ${failures} failure(s) ❌`}`);
process.exit(failures === 0 ? 0 : 1);
