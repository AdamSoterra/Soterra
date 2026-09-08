// LOCAL TEST FIXTURE for the external-parties build (correspondence, portal,
// sign-in gate). Creates, against the Clerk TEST instance in .env.local:
//   - a builder account (with a throwaway company + site + admin membership
//     written straight into the DB, so the invite-only gate is not in the way)
//   - an external account (the consultant / sub), on Resend's accepting test
//     inbox so any real send lands nowhere harmful
// and prints the logins. Pair with dev/test-external-cleanup.mjs, which
// derives everything to delete from the company id (never a hardcoded list).
//
//   node dev/test-external-setup.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim().replace(/^["']|["']$/g, "");
const DATABASE_URL = get("DATABASE_URL");
const CLERK = get("CLERK_SECRET_KEY");
if (!CLERK?.startsWith("sk_test_")) throw new Error("Refusing: CLERK_SECRET_KEY in .env.local is not a TEST key");
const sql = neon(DATABASE_URL);

const BUILDER_EMAIL = "zz.test.builder+clerk_test@soterra.co.nz";
const EXTERNAL_EMAIL = "delivered@resend.dev";
const PASSWORD = "Tst-" + randomBytes(9).toString("base64url");

async function clerk(path, init = {}) {
  const r = await fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${CLERK}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Clerk ${r.status} ${path}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}
async function ensureUser(email, first, last) {
  const found = await clerk(`/users?email_address=${encodeURIComponent(email)}`);
  if (Array.isArray(found) && found.length) {
    await clerk(`/users/${found[0].id}`, { method: "PATCH", body: JSON.stringify({ password: PASSWORD, skip_password_checks: true }) });
    return found[0].id;
  }
  const u = await clerk("/users", {
    method: "POST",
    body: JSON.stringify({ email_address: [email], password: PASSWORD, first_name: first, last_name: last, skip_password_checks: true }),
  });
  return u.id;
}

const builderId = await ensureUser(BUILDER_EMAIL, "Zz", "Builder");
const externalId = await ensureUser(EXTERNAL_EMAIL, "Sarah", "Whitlock");

// The throwaway company + site, straight into the DB (mirrors /api/projects).
const [existing] = await sql`select id from companies where name = 'ZZ TEST Northgate Construction' limit 1`;
const companyId = existing?.id ?? randomUUID();
if (!existing) await sql`insert into companies (id, name) values (${companyId}, 'ZZ TEST Northgate Construction')`;
const [proj] = await sql`select id, code from projects where company_id = ${companyId} limit 1`;
const projectId = proj?.id ?? randomUUID();
const code = proj?.code ?? "ZZTS-" + randomBytes(3).toString("hex").toUpperCase().slice(0, 4);
if (!proj) await sql`insert into projects (id, name, code, company_id, creator_id) values (${projectId}, 'ZZ TEST Kauri Tower', ${code}, ${companyId}, ${builderId})`;
await sql`insert into project_members (project_id, user_id, name, title, role) values (${projectId}, ${builderId}, 'Zz Builder', 'Site Manager', 'admin') on conflict (project_id, user_id) do nothing`;

const out = { builderId, externalId, companyId, projectId, BUILDER_EMAIL, EXTERNAL_EMAIL, PASSWORD };
writeFileSync(new URL("./_test-external.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
