import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Fall back to a dummy connection string at build time (the route module is
// imported but never queried during the build), so neon() doesn't throw when
// DATABASE_URL is absent. The real URL is read at runtime in the function.
const sql = neon(process.env.DATABASE_URL || "postgresql://user:pass@localhost/db");
export const db = drizzle(sql, { schema });
