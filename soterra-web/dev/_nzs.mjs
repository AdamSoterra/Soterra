import fs from "node:fs";
const F="C:/Users/adam/Desktop/NZS-36042011 (5).pdf";
const { getDocumentProxy, extractText } = await import("unpdf");
const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(F)));
const out = await extractText(pdf, { mergePages: false });
const pages = out.text.map(t => String(t||"").replace(/\s+/g," ").trim());
console.log("pages:", out.totalPages);
// where does "lintel" cluster?
const hits = pages.map((t,i)=>({p:i+1, n:(t.toLowerCase().match(/lintel/g)||[]).length})).filter(x=>x.n>0);
console.log("pages mentioning lintel:", hits.length, "| top:", hits.sort((a,b)=>b.n-a.n).slice(0,14).map(x=>`p${x.p}(${x.n})`).join(" "));
// find explicit lintel TABLES
const tbl = pages.map((t,i)=>({p:i+1,t})).filter(x=>/TABLE\s*8\.\d+/i.test(x.t) && /lintel/i.test(x.t));
console.log("\npages with a TABLE 8.x + lintel:", tbl.map(x=>x.p).join(", "));
for (const x of tbl.slice(0,6)) {
  const m = x.t.match(/TABLE\s*8\.\d+[^]{0,110}/i);
  console.log(`  p${x.p}: ${m?m[0]:""}`);
}
