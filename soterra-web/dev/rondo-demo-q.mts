/** Craft + verify a strong Rondo demo question: dump the wall-design content
 *  and run the assistant's own manufacturer search as Adam's account sees it.
 *   npx tsx dev/rondo-demo-q.mts ["a candidate question"] */
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { getManufacturerIndex, manufacturerLabel, visibleTo } = await import("../lib/manufacturerIndex.ts");
const { searchManufacturerPages, excerpt } = await import("../lib/retrieve.ts");

const UID = "user_3GcPx9L3pXhpSe20wl9H5rTuS8E"; // Adam
const query = process.argv[2] || "Rondo steel stud maximum wall height limiting height 600 centres";

const { pages: all, df } = await getManufacturerIndex();
const visible = visibleTo(all, UID);
const rondoVisible = visible.filter((p) => p.manufacturer.toLowerCase().includes("rondo") || p.doc.toLowerCase().includes("rondo"));
console.log(`Adam sees ${rondoVisible.length} Rondo pages (of ${all.filter((p) => p.doc.toLowerCase().includes("rondo")).length} in corpus).`);

// Peek at wall-design pages that carry height figures, to ground the question.
const heightPages = rondoVisible.filter((p) => /limiting height|maximum height|\bheight\b/i.test(p.text)).slice(0, 4);
console.log(`\n── sample wall-design content (${heightPages.length} pages with height data) ──`);
for (const p of heightPages) {
  console.log(`\n[${manufacturerLabel(p)}]`);
  console.log(p.text.slice(0, 700).replace(/\s+/g, " "));
}

console.log(`\n\n══ what the assistant retrieves for: "${query}" ══`);
const top = searchManufacturerPages(rondoVisible, df, query, 6, all.length);
for (const p of top) {
  console.log(`\n[${manufacturerLabel(p)}]`);
  console.log(excerpt(p.text, query, 500).replace(/\s+/g, " "));
}
process.exit(0);
