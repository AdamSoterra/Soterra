// Render specific pages of Adam's OWN licensed NZS PDFs to PNG. Two modes:
//
//   --out <dir>   write PNGs locally (page selection: render, LOOK, confirm the
//                 printed caption before a page is ever mapped or uploaded)
//   --upload      store in PRIVATE Blob under standard-demo/<slug>/<page>.png,
//                 gated (at serve time) to the demo-corpus account only
//
// Same rules as dev/render-standard-demo.mjs, which this parameterises: this is
// a PERSONAL-USE EVALUATION ONLY. No standard TEXT ever enters the searchable
// corpus (the licence restriction, and the column-major table bug); we render
// pages of a licensed copy and show them back to one account. Nothing here is
// served to any other user.
//
//   node dev/render-standard-pages.mjs --pdf <path> --slug <slug> --pages 71,72,209 --out tmp/
//   node dev/render-standard-pages.mjs --pdf <path> --slug <slug> --pages 71,72,209 --upload
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const pdf = opt("pdf");
const slug = opt("slug");
const pages = (opt("pages") || "").split(",").map((s) => Number(s.trim())).filter(Boolean);
const outDir = opt("out");
const upload = args.includes("--upload");

if (!pdf || !pages.length || (!outDir && !upload) || (upload && !slug)) {
  console.error("usage: node dev/render-standard-pages.mjs --pdf <path> [--slug <slug>] --pages 1,2,3 (--out <dir> | --upload)");
  process.exit(1);
}

let put, token;
if (upload) {
  for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN missing");
  ({ put } = await import("@vercel/blob"));
}
if (outDir) fs.mkdirSync(outDir, { recursive: true });

const { renderPageAsImage } = await import("unpdf");
const fileBuf = fs.readFileSync(pdf);
for (const page of pages) {
  // renderPageAsImage detaches its input buffer, so give each page a fresh copy.
  const png = await renderPageAsImage(new Uint8Array(fileBuf), page, { scale: 2, canvasImport: () => import("@napi-rs/canvas") });
  const buf = Buffer.from(png);
  if (upload) {
    const { pathname } = await put(`standard-demo/${slug}/${page}.png`, buf, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "image/png",
      token,
    });
    console.log(`stored p${page} - ${(buf.length / 1024).toFixed(0)} KB -> ${pathname}`);
  } else {
    const out = path.join(outDir, `${page}.png`);
    fs.writeFileSync(out, buf);
    console.log(`rendered p${page} -> ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
  }
}
if (upload) console.log("\nDone. Served only through /api/standard-page, gated to DEMO_CORPUS_USERS.");
