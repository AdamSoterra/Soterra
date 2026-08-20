import { auth } from "@clerk/nextjs/server";
import { companyName, companyProjects, resolveScope } from "@/lib/company";
import { categoryCounts, historySummary, listInspections, topItems } from "@/lib/history";
import type { InsightLevel } from "@/lib/history";

// The Insights page in one call: counts per category (top half), past
// inspections (bottom half). COMPANY-scoped by default — resolveScope derives
// companyId from the caller's verified project membership, so this route
// physically cannot read another builder's history. ?level=project narrows
// every number to the selected site (the Inspections tab's External pocket);
// the Insights tab stays company-wide, because that's where the learning is.
export const runtime = "nodejs";

export async function GET(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Not signed in" }, { status: 401 });
  const scope = await resolveScope(req, userId);
  if (!scope) return Response.json({ error: "No site selected" }, { status: 403 });

  const url = new URL(req.url);
  const category = url.searchParams.get("category");
  const level: InsightLevel = url.searchParams.get("level") === "project" ? "project" : "company";

  const categories = await categoryCounts(scope, { level });
  // The drill-down always opens on a trade. With no explicit pick, default to
  // the worst one so the panel is never empty on load, and tell the client
  // which trade the returned items belong to.
  const selectedCategory = category ?? categories[0]?.category ?? null;

  const [summary, top, inspections, sites, name] = await Promise.all([
    historySummary(scope, { level }),
    topItems(scope, { category: selectedCategory, limit: 12, level }),
    listInspections(scope, { limit: 60, projectOnly: level === "project" }),
    companyProjects(scope),
    companyName(scope.companyId),
  ]);

  return Response.json({
    company: { name, sites: sites.length },
    level,
    summary,
    categories,
    topItems: top,
    selectedCategory,
    inspections,
  });
}
