// Verifies Foundation 1 (email sending) end-to-end in record-only mode:
//   1. templates render (both variants), written to dev/_email-preview-*.html
//      so the output can be eyeballed against the approved email-mock.html
//   2. sendEmail() records a row on email_log with status "recorded" when no
//      RESEND_API_KEY exists (the row is read back and then DELETED — the
//      script leaves nothing behind)
//   3. projectSenderAddress() slugs sanely
// Run: npx tsx dev/verify-email.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
// Force record-only for this run even after the real key lands in .env.local:
// this script must never transmit a test email to a real address.
delete process.env.RESEND_API_KEY;

const { renderItemsEmail, renderRfiEmail } = await import("../lib/emailTemplates.ts");
const { sendEmail, projectSenderAddress, emailEnabled } = await import("../lib/email.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");
const { db } = await import("../lib/db.ts");
const { emailLog } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");

let pass = true;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) pass = false;
};

// ── 1. templates ─────────────────────────────────────────────────────────
const flags = renderItemsEmail({
  companyName: "Kauri Construction",
  contextLine: "Kauri Tower · Unit 1 fire check · 12 Aug 2026",
  intro:
    "Hi team, these two came up on today's pre-inspection check in Unit 1. Both are pinned on the drawing (snapshot attached). Please put them right and reply with a photo when done.",
  items: [
    {
      n: 1,
      title: "Fire collar not installed properly",
      meta: "Fire · A3-00-7400 Rev.2 · Basement, high level",
      note: "Collar to the 100mm uPVC penetration is proud of the slab and not fixed on one side. Refit hard to the soffit per the Ryanfire detail.",
      photoNote: "site photo attached",
    },
    {
      n: 2,
      title: "Intumescent sealant missing at pipe penetration",
      meta: "Fire · A3-00-7400 Rev.2 · Grid C2, riser wall",
      note: "Annular gap at the 65mm penetration has no sealant. Seal both sides and label the penetration.",
    },
  ],
  numberColor: "amber",
  snapshotCaption: "A3-00-7400 · Plumbing & Drainage · Basement · Rev.2 (snapshot with your pins, attached full-size)",
  replyName: "Adam Domok at Kauri Construction",
  footerNote: "Sent with Soterra · recorded on the project QA log",
  refLabel: "FLG-0141 · FLG-0142",
});

const rfi = renderRfiEmail({
  companyName: "Kauri Construction",
  contextLine: "Kauri Tower · Raised by Adam Domok · 12 Aug 2026",
  rfiNumber: "RFI-014",
  rfiSubject: "Lintel fixing at grid C3, Level 1",
  requiredByLabel: "Friday 22 Aug 2026 (7 working days)",
  meta: [
    { label: "Discipline", value: "Structural" },
    { label: "Priority", value: "Normal" },
    { label: "Location", value: "Level 1 · grid C3" },
    { label: "Cost impact", value: "Unknown" },
    { label: "Programme impact", value: "Yes · est 3 days" },
    { label: "Drawing", value: "S3.01 Rev C" },
  ],
  question:
    "S3.01 Rev C calls for M12 bolts at 600 crs fixing the L1 lintel at grid C3, but the specified 190 series block wall shows a 140 wall on A-201 Rev C at the same line. Please confirm the wall thickness at grid C3 and the required lintel fixing.",
  proposedSolution:
    "Proceed with the 190 wall as per S3.01 and fix the lintel M12 at 600 crs as drawn. A-201 to be updated to match.",
  drawingRefs: ["S3.01 Rev C · pin at grid C3", "A-201 Rev C"],
  codeRefs: ["NZS 3604 cl 8.6"],
  attachments: ["RFI-014-S3.01-pin.png", "RFI-014-site-photo.jpg"],
  replyName: "Adam Domok",
  refLabel: "RFI-014 · Rev 0",
});

fs.writeFileSync("dev/_email-preview-flags.html", flags.html);
fs.writeFileSync("dev/_email-preview-rfi.html", rfi.html);
console.log("\ntemplates:");
check(flags.html.includes("Fire collar not installed properly"), "flags email carries item titles");
check(flags.html.includes("Kauri Construction"), "flags email carries the company");
check(!flags.html.includes("<script"), "flags email has no scripts");
check(flags.text.includes("1. Fire collar"), "flags email has a plain-text twin");
check(rfi.html.includes("RFI-014"), "RFI email carries the number");
check(rfi.html.includes("Response required by"), "RFI email carries the due line");
check(rfi.html.includes("NZS 3604 cl 8.6"), "RFI email carries the code ref");
// esc(): a hostile title must come out entity-escaped
const hostile = renderItemsEmail({
  companyName: 'Evil "Co" <script>alert(1)</script>',
  contextLine: "x",
  intro: "x",
  items: [{ n: 1, title: "<img src=x onerror=alert(1)>", meta: "a · b" }],
  replyName: "x",
  footerNote: "x",
});
check(!hostile.html.includes("<script>alert"), "esc(): script tags neutralised");
check(!hostile.html.includes("<img src=x"), "esc(): html in titles neutralised");
// review fixes — regression checks
const evil = renderItemsEmail({
  companyName: "x", contextLine: "x", intro: "x", replyName: "x", footerNote: "x",
  items: [{ n: "<b>7</b>" as unknown as number, title: "t", meta: "a · b" }],
});
check(!evil.html.includes("<b>7</b>"), "item number coerced at runtime (n is not an injection path)");
check(flags.html.includes('style="width:100%;max-width:600px'), "card is fluid on phones (hybrid 600px pattern)");
check(flags.html.includes("mso-line-height-rule:exactly"), "brand bar guarded against Outlook inflation");
const rfi5 = renderRfiEmail({
  companyName: "x", contextLine: "x", rfiNumber: "RFI-001", rfiSubject: "s",
  requiredByLabel: "x", meta: [1, 2, 3, 4, 5].map((i) => ({ label: "L" + i, value: "v" + i })),
  question: "q", replyName: "x", refLabel: "RFI-001",
});
check((rfi5.html.match(/width="33%"/g) || []).length === 6, "5-cell meta grid padded to full rows");
check(rfi.html.includes("</span>&nbsp;<span"), "reference chips separated by a real character (Outlook)");
console.log("preview written: dev/_email-preview-flags.html, dev/_email-preview-rfi.html");

// ── 2. sender address (project id token = per-tenant uniqueness) ─────────
console.log("\nsender address:");
check(
  projectSenderAddress("Kauri Tower", "7b66634b-30ac-4722-9fbe-e375f273ecb2") === "kauri-tower-7b6663@send.soterra.co.nz",
  "Kauri Tower → kauri-tower-7b6663@… (slug + id token)"
);
check(
  projectSenderAddress("1 Arthur Road!!", "9f21c88a-aaaa-bbbb-cccc-000000000000") === "1-arthur-road-9f21c8@send.soterra.co.nz",
  "punctuation stripped, token appended"
);
check(projectSenderAddress("???", "x") === "project-x@send.soterra.co.nz", "degenerate name falls back");
check(
  projectSenderAddress("Kauri Tower", "7b66634b-30ac-4722-9fbe-e375f273ecb2") !==
    projectSenderAddress("Kauri Tower", "1234567b-30ac-4722-9fbe-e375f273ecb2"),
  "same project name in two tenants → different sender addresses"
);

// ── 3. record-only send (row in, row verified, row deleted) ──────────────
console.log("\nrecord-only send:");
check(!emailEnabled(), "no RESEND_API_KEY in this run → record-only mode");
const SENTINEL = "__email-verify-company__";
const scope = unsafeScopeForTest("__email-verify-project__", SENTINEL, "__email-verify-user__");
// Sweep any rows a previously crashed run left behind, then run the checks
// inside try/finally so THIS run can never leave one either.
await db.delete(emailLog).where(eq(emailLog.companyId, SENTINEL));
try {
  const result = await sendEmail({
    scope,
    kind: "test",
    to: { name: "Test Recipient", email: "test@example.com" },
    fromName: "Kauri Construction (via Soterra)",
    fromEmail: projectSenderAddress("Kauri Tower", "7b66634b-30ac-4722-9fbe-e375f273ecb2"),
    replyTo: "adam@example.com",
    subject: "Verify: record-only send",
    html: flags.html,
    text: flags.text,
    attachments: [{ filename: "A3-00-7400-pins.png", content: Buffer.from("fake-png-bytes").toString("base64") }],
  });
  check(result.status === "recorded", `sendEmail returned status "recorded" (got "${result.status}")`);
  const [row] = await db.select().from(emailLog).where(eq(emailLog.id, result.id)).limit(1);
  check(!!row, "email_log row exists");
  check(row?.status === "recorded", "row status is recorded");
  check(row?.toEmail === "test@example.com", "recipient recorded");
  check(row?.fromEmail === "kauri-tower-7b6663@send.soterra.co.nz", "from address recorded");
  check((row?.html ?? "").includes("Fire collar"), "full body recorded (the evidentiary copy)");
  check((row?.attachments ?? "").includes("A3-00-7400-pins.png"), "attachment names + sizes recorded");
  check(row?.providerId == null, "no provider id in record-only mode");
} finally {
  await db.delete(emailLog).where(eq(emailLog.companyId, SENTINEL));
}
const leftover = await db.select({ id: emailLog.id }).from(emailLog).where(eq(emailLog.companyId, SENTINEL));
check(leftover.length === 0, "test rows cleaned up (crash-safe sweep)");

console.log(pass ? "\nALL PASS ✅" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
