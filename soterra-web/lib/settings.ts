// ─── Runtime settings: env first, then the app_settings table ────────────
//
// Why a table at all: some values only exist AFTER the code is live — the
// inbound-email webhook's signing secret is minted by Resend when the webhook
// is created against the deployed endpoint, and the inbound domain is chosen
// once DNS is in. Putting those in the env would mean a dashboard edit and a
// redeploy per change; a row in app_settings needs neither. Env vars still
// win when set, so nothing here overrides a deliberate configuration.
//
// Reads are cached per warm server for a minute: these values change once a
// month, not once a request.

import { eq } from "drizzle-orm";
import { db } from "./db";
import { appSettings } from "./schema";

const TTL_MS = 60_000;
const cache = new Map<string, { value: string | null; at: number }>();

export async function getSetting(key: string, envName?: string): Promise<string | null> {
  if (envName) {
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) return fromEnv;
  }
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    const [row] = await db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)).limit(1);
    value = row?.value?.trim() || null;
  } catch (e) {
    // A settings read must never take a request down; behave as "unset".
    console.error("settings read failed:", key, e);
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  cache.delete(key);
}
