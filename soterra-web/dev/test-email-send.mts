/**
 * Fire ONE email through the app's real sendEmail() path (from-address,
 * headers, transmit gate and all) to a real inbox, so we can see exactly what
 * the Send-to-subs / RFI buttons do. No UI, no auth.
 *   npx tsx dev/test-email-send.mts [to@email]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

// Force a clean transmit value for this proof-of-delivery run, independent of
// whatever is (or isn't) in .env.local.
process.env.EMAIL_TRANSMIT = "1";
const { sendEmail, projectSenderAddress, emailEnabled } = await import("../lib/email.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");

const PID = "7b66634b-30ac-4722-9fbe-e375f273ecb2"; // Kauri Tower
const CID = "e9210ba0-b03b-402b-8cfa-e6fa66d39055";
const UID = "user_3GcPx9L3pXhpSe20wl9H5rTuS8E";
const to = process.argv[2] || "domokadam43@gmail.com";

console.log("emailEnabled():", emailEnabled(), "| RESEND_API_KEY set:", !!process.env.RESEND_API_KEY, "| EMAIL_TRANSMIT:", process.env.EMAIL_TRANSMIT);
const from = projectSenderAddress("Kauri Tower", PID);
console.log("from:", from, "| to:", to);

const scope = unsafeScopeForTest(PID, CID, UID);
const result = await sendEmail({
  scope,
  kind: "test",
  to: { name: "Adam", email: to },
  fromName: "Kauri Tower (via Soterra)",
  fromEmail: from,
  replyTo: to,
  subject: "Soterra send-path test",
  html: "<p>This came through the app's real sendEmail() path. If it is in your inbox, Send-to-subs and RFI emails work - they were just going to the demo's fictional addresses.</p>",
  text: "This came through the app's real sendEmail() path.",
});
console.log("RESULT:", JSON.stringify(result));
process.exit(0);
