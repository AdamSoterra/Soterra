// Shared by the two send routes (checklist send-fixes, inspection send-items):
// ONE recipient pool per send — saved subs by id plus one-off email addresses
// that don't create a sub.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** subIds + extras → a validated, de-duplicated recipient list. Returns a
 *  string on failure so both send routes reject identically. */
export function resolveRecipients(
  body: Record<string, unknown>,
  companySubs: { id: string; name: string; email: string }[],
): { name: string; email: string }[] | string {
  const rawSubIds = Array.isArray(body.subIds) ? body.subIds : [];
  const rawExtras = Array.isArray(body.extras) ? body.extras : [];
  if (rawSubIds.length > 30 || rawExtras.length > 10) return "Too many recipients in one send";
  const subById = new Map(companySubs.map((s) => [s.id, s]));
  const out: { name: string; email: string }[] = [];
  const seen = new Set<string>();
  for (const raw of rawSubIds) {
    const sub = subById.get(String(raw));
    if (!sub) return "Unknown sub in recipients";
    if (seen.has(sub.email.toLowerCase())) continue;
    seen.add(sub.email.toLowerCase());
    out.push({ name: sub.name, email: sub.email });
  }
  for (const raw of rawExtras) {
    const email = String((raw as Record<string, unknown>)?.email ?? "").trim().toLowerCase();
    const name = String((raw as Record<string, unknown>)?.name ?? "").trim().slice(0, 80);
    if (!EMAIL_RE.test(email)) return "One of the added email addresses doesn't look like an email";
    if (seen.has(email)) continue;
    seen.add(email);
    out.push({ name: name || email, email });
  }
  return out;
}

/** "Firepoint Passive Fire" / "Firepoint Passive Fire +2" — the item stamp. */
export function recipientsLabel(recipients: { name: string }[]): string {
  if (!recipients.length) return "";
  return recipients.length === 1 ? recipients[0].name : `${recipients[0].name} +${recipients.length - 1}`;
}
