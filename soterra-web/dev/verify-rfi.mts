// Verifies the RFI engine end-to-end at the data layer, record-only (the
// Resend key is deleted up front so nothing can transmit):
//   working-day maths · draft → send (number burned, ball to consultant,
//   audit written, email recorded) → answer → bounce → answer → CI → close →
//   reopen → close · register derivations · analytics/scorecard · EOT rows ·
//   crash-safe sentinel cleanup.
// Run: npx tsx dev/verify-rfi.mts
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
delete process.env.RESEND_API_KEY;
delete process.env.EMAIL_TRANSMIT;

const { workingDaysBetween, addWorkingDays, createDraft, sendRfi, logAnswer, addFollowup, setRfiStatus, createCi, listRfis, getRfi, rfiAnalytics } = await import("../lib/rfi.ts");
const { unsafeScopeForTest } = await import("../lib/company.ts");
const { db } = await import("../lib/db.ts");
const { rfis, rfiMessages, rfiTransitions, contractInstructions, emailLog } = await import("../lib/schema.ts");
const { eq } = await import("drizzle-orm");

let pass = true;
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`);
  if (!ok) pass = false;
};

// ── working-day maths (fixed 2026 dates) ─────────────────────────────────
console.log("working days:");
const mon = new Date("2026-08-10T00:00:00+12:00"); // Monday NZ
const fri = new Date("2026-08-14T00:00:00+12:00"); // Friday NZ
const fri2 = new Date("2026-08-07T00:00:00+12:00"); // the Friday before
check(workingDaysBetween(mon, fri) === 4, "Mon → Fri = 4 wd");
check(workingDaysBetween(fri2, mon) === 1, "Fri → Mon = 1 wd (weekend skipped)");
check(workingDaysBetween(mon, mon) === 0, "same day = 0 wd");
const due = addWorkingDays(fri2, 7);
check(due.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }) === "2026-08-18", `Fri + 7 wd = Tue 18 Aug (got ${due.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" })})`);

// ── lifecycle on sentinel data ───────────────────────────────────────────
const P = "__rfi-verify-project__";
const C = "__rfi-verify-company__";
const scope = unsafeScopeForTest(P, C, "__rfi-verify-user__");
const by = { userId: "__rfi-verify-user__", name: "Test PM", email: "pm@example.com" };
const sweep = async () => {
  await db.delete(rfis).where(eq(rfis.projectId, P));
  await db.delete(rfiMessages).where(eq(rfiMessages.projectId, P));
  await db.delete(rfiTransitions).where(eq(rfiTransitions.projectId, P));
  await db.delete(contractInstructions).where(eq(contractInstructions.projectId, P));
  await db.delete(emailLog).where(eq(emailLog.companyId, C));
};

await sweep();
try {
  console.log("\nlifecycle:");
  const fiveWdAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000); // safely past
  const draft = await createDraft(scope, {
    subject: "Lintel fixing at grid C3",
    question: "Confirm wall thickness and fixing.",
    discipline: "Structural",
    consultantName: "Jane Smith",
    consultantCompany: "Holmes Structural",
    consultantEmail: "jane@example.com",
    criticalPath: true,
    requiredBy: fiveWdAgo,
    programmeImpact: "yes",
    programmeDays: 3,
    raisedByName: "Test PM",
  });
  check(draft.status === "draft" && draft.number == null, "draft created, no number burned");

  const { rfi: sentRfi, emailStatus } = await sendRfi(scope, draft.id, by);
  check(sentRfi.number === 1 && sentRfi.status === "open" && sentRfi.ballParty === "consultant", "send: number 1, open, ball with the consultant");
  check(emailStatus === "recorded", "send email recorded (not transmitted — no key)");
  const [logRow] = await db.select().from(emailLog).where(eq(emailLog.companyId, C));
  check(!!logRow && logRow.kind === "rfi" && logRow.toEmail === "jane@example.com", "email_log row carries the RFI send");

  // draft cannot send twice
  let threw = false;
  try { await sendRfi(scope, draft.id, by); } catch { threw = true; }
  check(threw, "an open RFI can't be sent again (state machine holds)");

  const answered = await logAnswer(scope, draft.id, "190 wall confirmed, fixing stands.", { ...by, consultantName: "Jane Smith" });
  check(answered.status === "answered" && answered.ballParty === "us" && !!answered.dateAnswered, "answer: answered, ball back to us, date stamped");

  const bounced = await addFollowup(scope, draft.id, "What about the sill fixing?", by, { bounce: true });
  check(bounced.status === "open" && bounced.ballParty === "consultant", "bounced follow-up: open again, consultant clock running");

  await logAnswer(scope, draft.id, "Sill fixing M10 at 400.", { ...by, consultantName: "Jane Smith" });
  const ci = await createCi(scope, draft.id, { title: "Revise A-201 wall thickness", amendsDrawings: [{ doc: "A-201", fromRev: "C", toRev: "D" }] }, by);
  check(ci.number === 1, "CI-001 spawned from the answer");
  const closed = await setRfiStatus(scope, draft.id, "closed", by);
  check(closed.status === "closed" && closed.ballParty === "none", "closed and locked");
  const reopened = await setRfiStatus(scope, draft.id, "open", by, "reopened for test");
  check(reopened.status === "open", "closed → open (reopen) allowed");
  // A reopened RFI must go through Answered again before it can close.
  let closeEarly = false;
  try { await setRfiStatus(scope, draft.id, "closed", by); } catch { closeEarly = true; }
  check(closeEarly, "open → closed rejected (must be answered first)");
  await logAnswer(scope, draft.id, "Confirmed again after reopen.", { ...by, consultantName: "Jane Smith" });
  const finalClose = await setRfiStatus(scope, draft.id, "closed", by);
  check(finalClose.status === "closed", "answered → closed after the reopen loop");

  const draft2 = await createDraft(scope, { subject: "Voided one", question: "n/a", raisedByName: "Test PM" });
  const voided = await setRfiStatus(scope, draft2.id, "void", by);
  check(voided.status === "void", "draft → void allowed");
  // open → void: burn a number then void it — analytics must then ignore it.
  const draft3 = await createDraft(scope, { subject: "Sent then voided", question: "n/a", consultantEmail: "x@example.com", consultantCompany: "Holmes Structural", raisedByName: "Test PM" });
  await sendRfi(scope, draft3.id, by);
  const voided3 = await setRfiStatus(scope, draft3.id, "void", by);
  check(voided3.status === "void", "open → void allowed");

  console.log("\nreads:");
  const list = await listRfis(scope);
  const first = list.find((r) => r.id === draft.id);
  check(!!first && first.label === "RFI-001", "register: label RFI-001");
  const full = await getRfi(scope, draft.id);
  check(!!full && full.messages.filter((m) => m.type === "official_answer").length === 3, "thread: every official answer held");
  check(!!full && full.transitions.length >= 7, `audit: ${full?.transitions.length} transitions recorded`);
  check(!!full?.ci && full.ci.number === 1, "CI linked back on the read");

  console.log("\nanalytics:");
  const ana = await rfiAnalytics(scope);
  check(ana.tiles.raisedTotal === 1, `voided RFIs excluded from analytics (raised = ${ana.tiles.raisedTotal})`);
  const holmes = ana.scorecard.find((s) => s.consultant === "Holmes Structural");
  check(!!holmes, "scorecard has the consultant row");
  check((holmes?.answered ?? 0) >= 1, "turnarounds counted");
  check((holmes?.reopenPct ?? 0) > 0, "reopen % reflects the bounce");
  check(ana.eot.length === 0 || ana.eot[0].netLateWd >= 0, "EOT rows well-formed");
  // The closed critical-path RFI answered after its required-by must appear:
  check(ana.eot.some((e) => e.label === "RFI-001"), "EOT pack picks up the late critical-path RFI");
} finally {
  await sweep();
}
const leftover = await db.select({ id: rfis.id }).from(rfis).where(eq(rfis.projectId, P));
check(leftover.length === 0, "sentinel rows cleaned up");

console.log(pass ? "\nALL PASS ✅" : "\nFAILURES ❌");
process.exit(pass ? 0 : 1);
