// Render specific pages of Adam's OWN licensed NZS 3604 PDF to PNG and store
// them in PRIVATE Blob, gated (at serve time) to the demo-corpus account only.
//
// This is a PERSONAL-USE EVALUATION ONLY. The point is to see, end to end in
// the real UI, what a licensed standards answer would look like, WITHOUT putting
// any standard TEXT into the shared searchable corpus (the "knowledge base" that
// Standards NZ's licence names, and which also mis-reads these column-major
// tables). We render a handful of pages of a licensed copy and show them back
// to one account. Nothing here is served to any other user.
//
//   node dev/render-standard-demo.mjs
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const token = process.env.BLOB_READ_WRITE_TOKEN;
if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");

const PDF = "C:/Users/adam/Desktop/NZS-36042011 (5).pdf";
const SLUG = "nzs-3604-2011";
// PDF page numbers (not the printed 8-xx). Verified by reading the pages.
const PAGES = [209, 210, 211];

const { renderPageAsImage } = await import("unpdf");
const { put } = await import("@vercel/blob");

const fileBuf = fs.readFileSync(PDF);
for (const page of PAGES) {
  // renderPageAsImage detaches its input buffer, so give each page a fresh copy.
  const png = await renderPageAsImage(new Uint8Array(fileBuf), page, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });
  const buf = Buffer.from(png);
  const { pathname } = await put(`standard-demo/${SLUG}/${page}.png`, buf, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "image/png",
    token,
  });
  console.log(`stored p${page} — ${(buf.length / 1024).toFixed(0)} KB -> ${pathname}`);
}
console.log("\nDone. Served only through /api/standard-page, gated to DEMO_CORPUS_USERS.");
