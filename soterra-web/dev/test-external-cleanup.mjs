// Removes everything dev/test-external-setup.mjs created. The delete set is
// DERIVED from the test company id in the DB (every table that carries
// company_id / project_id, plus the two Clerk test users) - never a
// hardcoded list of rows.
//
//   node dev/test-external-cleanup.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { del } from "@vercel/blob";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(get("DATABASE_URL"));
const CLERK = get("CLERK_SECRET_KEY");
if (!CLERK?.startsWith("sk_test_")) throw new Error("Refusing: CLERK_SECRET_KEY in .env.local is not a TEST key");
const BLOB = get("BLOB_READ_WRITE_TOKEN");

const fixture = JSON.parse(readFileSync(new URL("./_test-external.json", import.meta.url), "utf8"));
const [co] = await sql`select id, name from companies where id = ${fixture.companyId}`;
if (!co || !co.name.startsWith("ZZ TEST")) throw new Error("Refusing: company is not the ZZ TEST fixture");
const projects = await sql`select id from projects where company_id = ${co.id}`;
const pids = projects.map((p) => p.id);
console.log("company", co.id, "projects", pids);

// Blob files under the test projects (correspondence attachments, inbound files, fix photos).
if (BLOB) {
  const files = await sql`select distinct file as p from plan_pages where project_id = any(${pids}) and file is not null`;
  const corr = await sql`select attachments from correspondence where company_id = ${co.id}`;
  const msgs = await sql`select attachments from correspondence_messages where company_id = ${co.id}`;
  // RFI files too (the RFI's own + every line of its thread), since 2026-09-10.
  const rfiOwn = await sql`select attachments from rfis where company_id = ${co.id}`;
  const rfiMsgs = await sql`select attachments from rfi_messages where company_id = ${co.id}`;
  // Defect threads (photos and files either side wrote with, email-reply files)
  // and the subs' "Mark it fixed" photos, since 2026-09-11.
  const defMsgs = await sql`select attachments from defect_messages where company_id = ${co.id}`;
  const fixPhotos = [
    ...(await sql`select fix_photo as p from qa_flags where company_id = ${co.id} and fix_photo is not null`),
    ...(await sql`select fix_photo as p from inspection_items where company_id = ${co.id} and fix_photo is not null`),
    ...(await sql`select fix_photo as p from checklist_items where company_id = ${co.id} and fix_photo is not null`),
  ];
  const paths = new Set([...files, ...fixPhotos].map((f) => f.p));
  for (const r of [...corr, ...msgs, ...rfiOwn, ...rfiMsgs, ...defMsgs]) for (const a of JSON.parse(r.attachments ?? "[]")) paths.add(a.path);
  for (const p of paths) {
    try {
      await del(p, { token: BLOB });
      console.log("blob deleted", p);
    } catch (e) {
      console.log("blob skip", p, String(e).slice(0, 80));
    }
  }
}

const byCompany = ["defect_messages", "correspondence_messages", "correspondence", "email_log", "rfi_messages", "rfi_transitions", "rfis", "qa_flags", "inspection_items", "inspections", "checklist_items", "checklist_photos", "checklists", "plan_pins", "subs", "consultants", "contract_instructions", "inbound_emails"];
for (const t of byCompany) {
  const r = await sql(`delete from ${t} where company_id = $1`, [co.id]);
  console.log(t, "deleted");
}
const byProject = ["plan_pages", "events", "tasks", "chat_messages", "chat_threads", "usage_counters", "project_locations", "project_members"];
for (const t of byProject) {
  if (t === "chat_messages") {
    await sql`delete from chat_messages where thread_id in (select id from chat_threads where project_id = any(${pids}))`;
    continue;
  }
  await sql(`delete from ${t} where project_id = any($1)`, [pids]);
  console.log(t, "deleted");
}
await sql`delete from projects where company_id = ${co.id}`;
await sql`delete from companies where id = ${co.id}`;

for (const id of [fixture.builderId, fixture.externalId]) {
  const r = await fetch(`https://api.clerk.com/v1/users/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${CLERK}` } });
  console.log("clerk user", id, r.status);
}
console.log("cleanup OK");
