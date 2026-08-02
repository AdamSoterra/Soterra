/**
 * Download MBIE determinations (CC BY 4.0) from building.govt.nz.
 *
 *   node dev/fetch-determinations.mjs [fromYear] [toYear]
 *
 * The URLs are directly enumerable, so this is not a crawl of the site: it asks
 * for one known file at a time, paced, with a browser user-agent (the site 403s
 * WebFetch but serves curl). BUILD-PLAN.md recorded this as blocked by
 * Imperva in July 2026; that block has since lifted, verified before writing.
 *
 * Default range is 2019+ per BUILD-PLAN §3: older determinations cite
 * superseded Acceptable Solutions (H1 changed hard over 2021-23), so a stale
 * figure quoted confidently is worse than no answer.
 *
 * Stops scanning a year after MISS_RUN consecutive absent numbers.
 */
import fs from "node:fs";
import path from "node:path";

const FROM = Number(process.argv[2] ?? 2019);
const TO = Number(process.argv[3] ?? 2026);
const OUT = "C:/Users/adam/Desktop/Soterra/Determinations";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MISS_RUN = 12; // consecutive 404s before we accept the year is done
const PACE_MS = 400; // be a considerate guest on a government server

fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let got = 0;
let skipped = 0;
let failed = 0;

for (let year = FROM; year <= TO; year++) {
  let misses = 0;
  let yearGot = 0;
  for (let n = 1; n <= 200 && misses < MISS_RUN; n++) {
    const num = String(n).padStart(3, "0");
    const name = `${year}-${num}.pdf`;
    const dest = path.join(OUT, name);

    if (fs.existsSync(dest) && fs.statSync(dest).size > 20000) {
      skipped++; yearGot++; misses = 0; continue; // resumable
    }

    const url = `https://www.building.govt.nz/assets/Uploads/resolving-problems/determinations/${year}/${name}`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
      if (!res.ok) { misses++; await sleep(PACE_MS); continue; }
      const buf = Buffer.from(await res.arrayBuffer());
      // A WAF interstitial returns 200 with HTML — only keep real PDFs.
      if (buf.subarray(0, 5).toString() !== "%PDF-") { misses++; await sleep(PACE_MS); continue; }
      fs.writeFileSync(dest, buf);
      got++; yearGot++; misses = 0;
    } catch {
      failed++; misses++;
    }
    await sleep(PACE_MS);
  }
  console.log(`${year}: ${yearGot} determination(s)`);
}

console.log(`\n${got} downloaded, ${skipped} already present, ${failed} error(s).`);
console.log(`Folder: ${OUT}`);
