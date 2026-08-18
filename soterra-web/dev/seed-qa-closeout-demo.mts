// Seed a realistic QA close-out story on the Kauri Tower DEMO project, so the
// scorecard shows a compelling picture when Adam demos it (not a screen of
// zeros). It advances a curated subset of EXISTING inspection_items + the
// qa_flags through the loop across four subs, with backdated timestamps.
//
// The story it tells:
//   Cladding Contractor        - fast, no overdue, most closed  (the good sub)
//   Interior Linings Contractor - solid
//   Plumbing Contractor        - mixed
//   Fire Stopping Contractor   - the problem sub: overdue items + slow turnaround
//
// ⚠️ Sub names are deliberately GENERIC TRADE ROLES, never invented brands: any
// plausible NZ company name turns out to belong to a real business, and this
// data shows a sub performing badly. Trade roles carry the demo point (which
// trade is slow) without naming or defaming anyone real.
//
// Idempotent by design: it first RESETS every item/flag on the project back to
// 'open' (clearing the loop fields), then re-applies the plan. Re-run any time.
// Demo data only, on the fictional showroom project.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim().replace(/^["']|["']$/g, "");
const sql = neon(url);
const PROJECT = "7b66634b-30ac-4722-9fbe-e375f273ecb2";
const SENDER = "adam@soterra.co.nz";

// Working-day-ish backdating: a calendar-day offset that reads as N business
// days once the scorecard's working-day maths runs over it.
const dAgo = (days: number) => new Date(Date.now() - days * 864e5);

// The plan: how many items to route to each (sub, status) bucket, and the
// backdated timings. Categories are matched to a trade where sensible.
type Plan = {
  sub: string;
  category?: string; // prefer items of this category
  status: "sent" | "ready" | "submitted" | "closed";
  sentAgo: number;
  readyAgo?: number; // set for ready/submitted/closed
  submittedAgo?: number; // set for submitted
  closedAgo?: number; // set for closed
};

const PLAN: Plan[] = [
  // Cladding Contractor - the fast, reliable sub
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "closed", sentAgo: 19, readyAgo: 17, closedAgo: 16 },
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "closed", sentAgo: 15, readyAgo: 13, closedAgo: 12 },
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "closed", sentAgo: 11, readyAgo: 9, closedAgo: 8 },
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "ready", sentAgo: 5, readyAgo: 3 },
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "submitted", sentAgo: 9, readyAgo: 7, submittedAgo: 6 },
  { sub: "Cladding Contractor", category: "Weathertightness / Cladding", status: "sent", sentAgo: 1 },

  // Interior Linings Contractor - solid
  { sub: "Interior Linings Contractor", category: "Interior / Linings", status: "closed", sentAgo: 16, readyAgo: 14, closedAgo: 13 },
  { sub: "Interior Linings Contractor", category: "Interior / Linings", status: "closed", sentAgo: 12, readyAgo: 11, closedAgo: 10 },
  { sub: "Interior Linings Contractor", category: "Interior / Linings", status: "ready", sentAgo: 4, readyAgo: 3 },
  { sub: "Interior Linings Contractor", category: "Interior / Linings", status: "sent", sentAgo: 3 },

  // Plumbing Contractor - mixed
  { sub: "Plumbing Contractor", category: "Plumbing & Drainage", status: "closed", sentAgo: 14, readyAgo: 11, closedAgo: 9 },
  { sub: "Plumbing Contractor", category: "Plumbing & Drainage", status: "ready", sentAgo: 6, readyAgo: 3 },
  { sub: "Plumbing Contractor", category: "Plumbing & Drainage", status: "sent", sentAgo: 2 },

  // Fire Stopping Contractor - the problem sub: overdue + slow
  { sub: "Fire Stopping Contractor", category: "Fire", status: "sent", sentAgo: 13 }, // overdue
  { sub: "Fire Stopping Contractor", category: "Fire", status: "sent", sentAgo: 16 }, // overdue
  { sub: "Fire Stopping Contractor", category: "Fire", status: "closed", sentAgo: 21, readyAgo: 13, closedAgo: 11 }, // slow turnaround
  { sub: "Fire Stopping Contractor", category: "Fire", status: "ready", sentAgo: 8, readyAgo: 2 },
  { sub: "Fire Stopping Contractor", category: "Fire", status: "submitted", sentAgo: 12, readyAgo: 5, submittedAgo: 4 },
];

async function main() {
  // 1) Reset the whole project's loop back to 'open' so the seed is repeatable.
  await sql(
    `update inspection_items set closeout_status='open', sub_token=null, consultant_token=null,
       sender_email=null, ready_at=null, submitted_at=null, closed_at=null, fix_photo=null,
       sub_note=null, review_note=null, sent_to=null, sent_at=null, sent_status=null,
       consultant_name=null, consultant_email=null
     where project_id=$1`,
    [PROJECT]
  );
  await sql(
    `update qa_flags set closeout_status='open', sub_token=null, sender_email=null, ready_at=null,
       closed_at=null, fix_photo=null, sub_note=null, review_note=null
     where project_id=$1`,
    [PROJECT]
  );

  // 2) Pull the items, bucketed by category, to fill the plan.
  const items = await sql(
    `select id, category from inspection_items where project_id=$1 order by id`,
    [PROJECT]
  );
  const byCat = new Map<string, string[]>();
  const any: string[] = [];
  for (const it of items) {
    any.push(it.id);
    const k = (it.category as string) || "";
    if (!byCat.has(k)) byCat.set(k, []);
    byCat.get(k)!.push(it.id);
  }
  const takeFrom = (cat?: string): string | null => {
    if (cat && byCat.get(cat)?.length) return byCat.get(cat)!.shift()!;
    // fall back to any remaining item not already used
    while (any.length) {
      const id = any.shift()!;
      // skip ones already consumed from a category bucket
      let used = false;
      for (const arr of byCat.values()) if (arr.length && arr[0] === id) used = true;
      if (!used) return id;
    }
    return null;
  };

  let done = 0;
  for (const p of PLAN) {
    const id = takeFrom(p.category);
    if (!id) { console.warn("ran out of items for", p.sub, p.category); continue; }
    // keep the category buckets and `any` in sync so we never reuse an id
    for (const arr of byCat.values()) { const i = arr.indexOf(id); if (i >= 0) arr.splice(i, 1); }
    { const i = any.indexOf(id); if (i >= 0) any.splice(i, 1); }

    const workStatus = p.status === "closed" ? "done" : p.status === "open" ? "not_done" : "in_progress";
    await sql(
      `update inspection_items set
         closeout_status=$2, sent_to=$3, sender_email=$4, sent_status='sent',
         sent_at=$5::timestamptz, ready_at=$6::timestamptz, submitted_at=$7::timestamptz, closed_at=$8::timestamptz,
         work_status=$9,
         sub_note = case when $6::timestamptz is null then null else 'Fixed and photographed on site.' end,
         review_note = case when $8::timestamptz is null then null else 'Reviewed, looks good, closed.' end,
         consultant_name = case when $7::timestamptz is null then null else 'the consulting engineer' end,
         consultant_email = case when $7::timestamptz is null then null else 'consultant@example.invalid' end
       where id=$1`,
      [
        id,
        p.status,
        p.sub,
        SENDER,
        dAgo(p.sentAgo),
        p.readyAgo != null ? dAgo(p.readyAgo) : null,
        p.submittedAgo != null ? dAgo(p.submittedAgo) : null,
        p.closedAgo != null ? dAgo(p.closedAgo) : null,
        workStatus,
      ]
    );
    done++;
  }

  // 3) A few qa_flags for variety (internal defects, no consultant leg).
  const flags = await sql(`select id from qa_flags where project_id=$1 order by id limit 3`, [PROJECT]);
  const flagPlan: Plan[] = [
    { sub: "Interior Linings Contractor", status: "closed", sentAgo: 10, readyAgo: 8, closedAgo: 7 },
    { sub: "Plumbing Contractor", status: "ready", sentAgo: 4, readyAgo: 2 },
    { sub: "Fire Stopping Contractor", status: "sent", sentAgo: 15 }, // overdue
  ];
  for (let i = 0; i < flags.length && i < flagPlan.length; i++) {
    const p = flagPlan[i];
    await sql(
      `update qa_flags set closeout_status=$2, status='sent', sub_name=$3, sub_email='sub@example.invalid',
         sender_email=$4, sent_status='sent', sent_at=$5::timestamptz, ready_at=$6::timestamptz, closed_at=$7::timestamptz,
         fixed_at = $7::timestamptz,
         sub_note = case when $6::timestamptz is null then null else 'Sorted, photo attached.' end
       where id=$1`,
      [flags[i].id, p.status, p.sub, SENDER, dAgo(p.sentAgo), p.readyAgo != null ? dAgo(p.readyAgo) : null, p.closedAgo != null ? dAgo(p.closedAgo) : null]
    );
  }

  // 4) Report the resulting spread.
  const spread = await sql(
    `select closeout_status, count(*)::int n from inspection_items where project_id=$1 and sent_at is not null group by closeout_status order by closeout_status`,
    [PROJECT]
  );
  console.log(`seeded ${done} items + ${Math.min(flags.length, flagPlan.length)} flags`);
  console.log("item close-out spread:", JSON.stringify(spread));
  console.log("done.");
}

main().then(() => process.exit(0));
