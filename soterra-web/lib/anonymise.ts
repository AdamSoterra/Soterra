// ─── Anonymise on ingest ─────────────────────────────────────────────────
//
// Council inspection reports carry real people: the inspector, the person on
// site, the LBP, the recipient's email, mobile numbers. None of that is needed
// to answer "what do we keep failing", and storing it turns a useful history
// table into a privacy liability the first time it's shared or exported.
//
// So the text is scrubbed BEFORE it reaches the model, and the extracted items
// are scrubbed again before they're written. Belt and braces on purpose: the
// first pass keeps names out of the prompt, the second catches anything the
// model quoted back.
//
// The old `Inspections/anonymize.py` did this with a hand-written mapping.json
// of specific names — fine for the handful of PDFs Adam anonymised by hand,
// useless for a customer's upload. This is pattern-based so it works on a
// report nobody has seen before.

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// NZ mobiles and landlines, with or without spaces/dashes/+64.
//
// The third alternative is the international form WITHOUT the leading zero
// ("+64 21 446 725"), which is how the council prints the inspector's mobile
// on the outcome statement. The old pattern demanded a 0 after the country
// code, so that exact number — the single most personal string on the page —
// survived scrubbing in every council report in the corpus. The 64-form
// requires the "+" or a word boundary plus separator so a "64" inside a longer
// figure can't trigger it.
const PHONE =
  /(?:\+?64[ -]?)?(?:\(0\d\)|0\d)[ -]?\d{3}[ -]?\d{3,5}\b|\b02\d[ -]?\d{3}[ -]?\d{3,5}\b|\+?\b64[ -]?\(?\d\d?\)?(?:[ -]?\d){6,8}\b/g;

// Labelled fields in the council template whose VALUE is a person. The value
// runs until the next field label, so we anchor on the labels we know follow.
const NAMED_FIELDS: { label: RegExp; replace: string }[] = [
  { label: /(Person on site \(name\)\s*)([^\n]{0,80}?)(?=\s*(?:Outcome|Inspection|Page \d|$))/gi, replace: "[PERSON]" },
  { label: /(Outcome statement recipient email\s*)([^\s]{0,120}?)(?=\s|$)/gi, replace: "[EMAIL]" },
  // The stop-set must include the field that actually FOLLOWS the name on the
  // real template: "Inspector's email". PDF text arrives collapsed onto one
  // line, so the old lookahead (Date|Signature|Page|$) never fired and the
  // inspector's full name sailed through — while the adjacent "Person on site"
  // scrubbed fine because its stop-set happened to match. Phone/mobile are in
  // the set for the same reason on other layouts.
  { label: /(Inspector(?:'s)? name\s*[:\-]?\s*)([^\n]{0,60}?)(?=\s*(?:Date|Signature|Page \d|Inspector(?:'s)? (?:email|phone|mobile)|Email|Phone|Mobile|$))/gi, replace: "[INSPECTOR]" },
  { label: /(LBP Name\s*(?:\( if applicable \))?\s*)([^\n]{0,60}?)(?=\s*(?:LBP Number|LBP Class|Documents|Page \d|$))/gi, replace: "[LBP]" },
  { label: /(Signed(?: by)?\s*[:\-]?\s*)([^\n]{0,60}?)(?=\s*(?:Date|Page \d|$))/gi, replace: "[PERSON]" },
];

/**
 * Scrub personal data out of report text. Returns the text with emails, phone
 * numbers and the known person-carrying fields replaced by placeholders.
 * Company/organisation names are deliberately KEPT — "Auckland Council" is
 * useful and isn't personal.
 */
export function anonymiseText(input: string): string {
  let out = input || "";
  for (const f of NAMED_FIELDS) out = out.replace(f.label, (_m, lbl) => `${lbl}${f.replace} `);
  out = out.replace(EMAIL, "[EMAIL]");
  out = out.replace(PHONE, "[PHONE]");
  return out;
}

/**
 * Second pass, applied to every short string we're about to STORE (item titles,
 * details, locations). Same patterns, plus a light guard against a bare
 * "Firstname Lastname" that the model may have carried across from a signature
 * block — only when the line looks like a name and nothing else, so real item
 * wording ("Andrew tape to complete") isn't mangled.
 */
export function anonymiseField(input: string | null | undefined): string | null {
  if (input == null) return null;
  let out = String(input).replace(EMAIL, "[EMAIL]").replace(PHONE, "[PHONE]");
  if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(out.trim())) out = "[PERSON]";
  return out.trim() || null;
}

/** True if the text still contains something that looks personal. Used by the
 *  ingest route to log a warning rather than to block — a false positive must
 *  never stop a report being processed. */
export function looksPersonal(text: string): boolean {
  EMAIL.lastIndex = 0;
  PHONE.lastIndex = 0;
  return EMAIL.test(text) || PHONE.test(text);
}
