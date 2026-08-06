// Size the Blob store, so a Vercel account migration can be costed. Run from soterra-web/.
import fs from "node:fs";
for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const { list } = await import("@vercel/blob");
const token = process.env.BLOB_READ_WRITE_TOKEN;

const byPrefix = new Map();
let total = 0, bytes = 0, cursor;
do {
  const page = await list({ token, cursor, limit: 1000, mode: "expanded" });
  for (const b of page.blobs) {
    // Group by the first path segment, but collapse UUID-looking segments
    // (per-project plan folders) into one bucket so the shape is readable.
    let top = b.pathname.split("/")[0];
    if (/^[0-9a-f-]{30,}$/i.test(top)) top = "<project-uuid>/ (uploaded plans)";
    const cur = byPrefix.get(top) ?? { n: 0, size: 0 };
    cur.n++; cur.size += b.size ?? 0;
    byPrefix.set(top, cur);
    total++; bytes += b.size ?? 0;
  }
  cursor = page.cursor;
} while (cursor);

console.log("prefix".padEnd(40), "count".padStart(7), "MB".padStart(10));
for (const [k, v] of [...byPrefix].sort((a, b) => b[1].size - a[1].size))
  console.log(k.slice(0, 40).padEnd(40), String(v.n).padStart(7), (v.size / 1048576).toFixed(1).padStart(10));
console.log("-".repeat(60));
console.log("TOTAL".padEnd(40), String(total).padStart(7), (bytes / 1048576).toFixed(1).padStart(10), "MB");
