// Temporary verification harness for the Phase 0 indexPdf extraction.
// Indexes a real PDF under a throwaway projectId, asserts rows landed, asserts
// re-indexing REPLACES rather than duplicates, then cleans up after itself.
import fs from "node:fs";
import path from "node:path";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { indexPdf, docNameFromFilename } = await import("../lib/indexPdf.ts");
const { db } = await import("../lib/db.ts");
const { planPages } = await import("../lib/schema.ts");
const { and, eq } = await import("drizzle-orm");

const PROJECT = "__verify_indexpdf__";
const pdfPath = process.argv[2];
const bytes = new Uint8Array(fs.readFileSync(pdfPath));
const doc = docNameFromFilename(path.basename(pdfPath));

const count = async () =>
  (await db.select().from(planPages).where(and(eq(planPages.projectId, PROJECT), eq(planPages.doc, doc)))).length;

try {
  console.log(`file: ${path.basename(pdfPath)} (${bytes.length} bytes)`);
  console.log(`doc name: "${doc}"`);

  const r1 = await indexPdf({ projectId: PROJECT, doc, bytes, file: `${PROJECT}/test.pdf` });
  console.log("1st index:", JSON.stringify(r1));
  if (!r1.ok) throw new Error("expected ok on a real PDF");
  const n1 = await count();
  console.log(`rows in db: ${n1}`);
  if (n1 !== r1.indexed) throw new Error(`row mismatch: db ${n1} vs reported ${r1.indexed}`);

  // Re-index the same doc: must REPLACE, not duplicate (the Procore revision path
  // depends on this exact behaviour).
  // Reuses the SAME bytes buffer on purpose: indexPdf must not consume it.
  const r2 = await indexPdf({ projectId: PROJECT, doc, bytes, file: `${PROJECT}/test.pdf` });
  const n2 = await count();
  console.log(`2nd index: ${JSON.stringify(r2)} -> rows in db: ${n2}`);
  if (!r2.ok) throw new Error("re-index failed: indexPdf consumed the caller's bytes");
  if (n2 !== n1) throw new Error(`re-index duplicated rows: ${n1} -> ${n2}`);

  // A non-PDF must be rejected cleanly, not throw.
  const bad = await indexPdf({
    projectId: PROJECT,
    doc: "not-a-pdf",
    bytes: new Uint8Array([1, 2, 3, 4]),
    file: `${PROJECT}/bad.pdf`,
  });
  console.log("garbage bytes:", JSON.stringify(bad));
  if (bad.ok || bad.reason !== "unreadable") throw new Error("expected unreadable");

  const sample = await db.select().from(planPages).where(eq(planPages.projectId, PROJECT)).limit(1);
  console.log("sample text:", JSON.stringify(sample[0]?.text?.slice(0, 120)));
  console.log("\nPASS");
} finally {
  const del = await db.delete(planPages).where(eq(planPages.projectId, PROJECT)).returning();
  console.log(`cleaned up ${del.length} test rows`);
}
