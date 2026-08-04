import fs from "node:fs";
const F="C:/Users/adam/Desktop/NZS-36042011 (5).pdf";
const { getDocumentProxy, extractText } = await import("unpdf");
const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(F)));
const out = await extractText(pdf, { mergePages: false });
const P = out.text.map(t=>String(t||"").replace(/\s+/g," ").trim());
for (const p of [209,210,211]) {
  console.log(`\n===== PDF page ${p} | ${P[p-1].length} chars =====`);
  console.log(P[p-1].slice(0,1500));
}
