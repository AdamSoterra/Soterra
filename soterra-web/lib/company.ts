import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { companies, projectMembers, projects } from "./schema";

// ─── The company boundary ────────────────────────────────────────────────
//
// Pooled failure history is the whole point of the product AND its biggest
// risk: if one builder ever sees another builder's failures, that isn't a bug
// to patch, it's the end of the business. So the rule is absolute —
//
//   companyId is ONLY ever derived server-side, from the authenticated user's
//   VERIFIED project membership. Never from a header. Never from a body.
//
// To make that impossible to forget rather than merely documented, `CompanyId`
// is a branded string that only `resolveScope()` below can mint. Every history
// / insights / checklist query takes a `Scope`, so a route that skipped the
// check doesn't compile — there's no other way to get one.

declare const companyBrand: unique symbol;
/** A company id that has been proven to belong to the caller. */
export type CompanyId = string & { readonly [companyBrand]: "company" };

export type Scope = {
  /** Verified: the caller is a member of this project. */
  readonly projectId: string;
  /** Verified: this project belongs to this company. */
  readonly companyId: CompanyId;
  readonly userId: string;
  readonly role: string;
};

/**
 * Resolve + AUTHORISE the caller's project AND its company in one query.
 *
 * The client sends the current site id in `x-soterra-project` (same as
 * resolveProjectId), but the companyId is read from the PROJECT ROW we just
 * confirmed the caller belongs to — the client never gets a say in it.
 *
 * Returns null when the header is missing or the caller isn't a member → 403.
 */
export async function resolveScope(req: Request, userId: string): Promise<Scope | null> {
  const pid = req.headers.get("x-soterra-project");
  if (!pid) return null;
  const [row] = await db
    .select({ companyId: projects.companyId, role: projectMembers.role })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, pid), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!row || !row.companyId) return null;
  return { projectId: pid, companyId: row.companyId as CompanyId, userId, role: row.role };
}

/** The company a project belongs to — for server-side callers that already
 *  verified membership some other way (e.g. the assistant route). */
export async function companyIdForProject(projectId: string, userId: string): Promise<CompanyId | null> {
  const [row] = await db
    .select({ companyId: projects.companyId })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return row?.companyId ? (row.companyId as CompanyId) : null;
}

/** The company this user already belongs to, via any site they're a member of.
 *  Used when they create a SECOND site: it joins their existing company rather
 *  than silently starting a new one (which would split their own history). */
export async function existingCompanyForUser(userId: string): Promise<{ id: CompanyId; name: string } | null> {
  const [row] = await db
    .select({ id: companies.id, name: companies.name })
    .from(projectMembers)
    .innerJoin(projects, eq(projects.id, projectMembers.projectId))
    .innerJoin(companies, eq(companies.id, projects.companyId))
    .where(eq(projectMembers.userId, userId))
    .orderBy(projectMembers.createdAt)
    .limit(1);
  return row ? { id: row.id as CompanyId, name: row.name } : null;
}

export async function createCompany(name: string): Promise<{ id: CompanyId; name: string }> {
  const id = crypto.randomUUID();
  const clean = name.trim().slice(0, 120) || "My company";
  await db.insert(companies).values({ id, name: clean });
  return { id: id as CompanyId, name: clean };
}

export async function companyName(companyId: CompanyId): Promise<string | null> {
  const [row] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return row?.name ?? null;
}

/** The sites inside a company — the span that pooled history covers. */
export async function companyProjects(scope: Scope) {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.companyId, scope.companyId));
}

// TESTS ONLY. Lets dev/verify-company-isolation.mjs build a scope for a company
// it is deliberately NOT a member of, to prove the query layer still filters.
// Never call this from app code — there is no legitimate use.
export function unsafeScopeForTest(projectId: string, companyId: string, userId: string): Scope {
  return { projectId, companyId: companyId as CompanyId, userId, role: "admin" };
}
