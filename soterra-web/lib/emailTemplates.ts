// ─── Outbound email templates ────────────────────────────────────────────
//
// Renders the emails Soterra sends, matching the design approved in
// email-mock.html (repo root). Three sends, one shell:
//   1. QA flags to a sub          → renderItemsEmail (amber numbers)
//   2. Inspection items to a sub  → renderItemsEmail (red numbers + status pill)
//   3. RFI to a consultant        → renderRfiEmail
//
// Email HTML is deliberately old-fashioned: nested tables, inline styles on
// every element, Arial. Gmail strips <style> blocks and web fonts; Outlook
// renders with Word's engine. The design is built to look right under those
// constraints rather than degrade (this is the approved decision, not a
// shortcut). Photos and the drawing snapshot ride as ATTACHMENTS — our Blob
// store is private, so remote <img> URLs would show broken squares.
//
// Every user string goes through esc(). The html returned here is stored
// verbatim on email_log — it is the evidentiary record of what was sent.

const FONT = "Arial,Helvetica,sans-serif";
const NAVY = "#0C2A47";
const SLATE = "#52698A";
const INK = "#243B53";
const MUT = "#94A6BE";
const BRAND = "#0E8FE6";
const LINE = "#E2E8F0";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── shared shell ────────────────────────────────────────────────────────

function shell(opts: {
  headerHtml: string; // sits between the gradient bar and the body
  bodyHtml: string;
  footerNote: string; // "recorded on the project QA log"
  refLabel?: string | null; // "FLG-0141 · FLG-0142"
}): string {
  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#EEF2F7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF2F7;">
<tr><td align="center" style="padding:26px 14px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${LINE};border-radius:10px;">
<tr><td height="5" bgcolor="${BRAND}" style="height:5px;background:linear-gradient(90deg,#41C3FF 0%,#0A8DED 100%);font-size:5px;line-height:5px;mso-line-height-rule:exactly;border-radius:10px 10px 0 0;">&nbsp;</td></tr>
${opts.headerHtml}
<tr><td style="padding:20px 28px 8px;font-family:${FONT};font-size:14px;line-height:1.55;color:${INK};">
${opts.bodyHtml}
</td></tr>
<tr><td style="padding:14px 28px 20px;border-top:1px solid #EDF2F7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td nowrap style="font-family:${FONT};font-size:13px;font-weight:bold;color:${BRAND};white-space:nowrap;">Soterra</td>
    <td style="font-family:${FONT};font-size:11px;color:${MUT};padding-left:8px;">${esc(opts.footerNote)}</td>
    <td nowrap align="right" style="font-family:${FONT};font-size:10.5px;color:#B6C2D2;white-space:nowrap;">${opts.refLabel ? esc(opts.refLabel) : ""}</td>
  </tr></table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function header(companyName: string, contextLine: string): string {
  return `<tr><td style="padding:22px 28px 16px;border-bottom:1px solid #EDF2F7;">
  <div style="font-family:${FONT};font-size:17px;font-weight:bold;color:${NAVY};">${esc(companyName)}</div>
  <div style="font-family:${FONT};font-size:12.5px;color:${SLATE};margin-top:3px;">${esc(contextLine)}</div>
</td></tr>`;
}

function introBlock(text: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:18px;"><tr>
    <td style="background:#F6FAFF;border-left:3px solid ${BRAND};padding:12px 14px;font-family:${FONT};font-size:13.5px;color:#33475C;line-height:1.5;">${esc(text)}</td>
  </tr></table>`;
}

function replyBlock(replyName: string, extra?: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr>
    <td style="background:#F8FAFC;border:1px dashed #D6DEE8;border-radius:8px;padding:11px 14px;font-family:${FONT};font-size:13px;color:#43586E;line-height:1.5;">&#8617; Just hit <b>Reply</b>: your response goes straight to ${esc(replyName)}.${extra ? " " + esc(extra) : ""}</td>
  </tr></table>`;
}

// A tappable CTA button. The padding lives on the td, never the a: Outlook's
// Word engine drops padding on an anchor, so the button would collapse to bare
// text without it. Kept small so QA item cards can each carry their own.
function ctaButton(label: string, url: string, small = false): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${small ? "10px 0 2px" : "20px 0 8px"};"><tr>
    <td bgcolor="${BRAND}" style="background:${BRAND};border-radius:9px;padding:${small ? "9px 18px" : "13px 28px"};">
      <a href="${esc(url)}" style="display:inline-block;font-family:${FONT};font-size:${small ? "13px" : "14.5px"};font-weight:bold;color:#ffffff;text-decoration:none;">${esc(label)} &#8594;</a>
    </td>
  </tr></table>`;
}

// ─── 1 + 3: itemised sends (QA flags / inspection items) ─────────────────

export type EmailItem = {
  n: number;
  title: string;
  meta: string; // "Fire · A3-00-7400 Rev.2 · Basement, high level" — first segment bolded
  note?: string | null;
  statusLabel?: string | null; // "not done" pill (inspection-items variant)
  photoNote?: string | null; // "site photo attached"
  // Close-out loop: the sub's tokenized "Mark it fixed" link for THIS defect.
  // One email can carry several defects, so the button rides per item card, not
  // once per email (see lib/qaCloseout.ts). Absent on sends not in the loop.
  fixUrl?: string | null;
};

export type ItemsEmailOptions = {
  companyName: string;
  contextLine: string; // "Kauri Tower · Unit 1 fire check · 12 Aug 2026"
  intro: string;
  items: EmailItem[];
  numberColor?: "amber" | "red"; // amber = QA flags, red = failed inspection items
  snapshotCaption?: string | null; // "A3-00-7400 · Basement · Rev.2 (snapshot attached)"
  replyName: string; // "Adam Domok at Kauri Construction"
  replyExtra?: string | null; // "Each item is tracked on the project until it is closed."
  footerNote: string;
  refLabel?: string | null;
};

export function renderItemsEmail(opts: ItemsEmailOptions): { html: string; text: string } {
  const numBg = opts.numberColor === "red" ? "#EF4444" : "#F59E0B";

  const itemsHtml = opts.items
    .map((it) => {
      const metaParts = it.meta.split("·");
      const metaHtml =
        metaParts.length > 1
          ? `<b style="color:${SLATE};">${esc(metaParts[0].trim())}</b> · ${esc(metaParts.slice(1).join("·").trim())}`
          : esc(it.meta);
      const pill = it.statusLabel
        ? ` <span style="font-family:${FONT};font-size:9.5px;font-weight:bold;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:20px;background:#FDECEC;color:#B91C1C;white-space:nowrap;">${esc(it.statusLabel)}</span>`
        : "";
      const note = it.note
        ? `<div style="font-family:${FONT};font-size:13px;color:#43586E;margin-top:8px;line-height:1.5;">${esc(it.note)}</div>`
        : "";
      const photo = it.photoNote
        ? `<div style="font-family:${FONT};font-size:11px;color:${MUT};margin-top:8px;">&#128247; ${esc(it.photoNote)}</div>`
        : "";
      // "Mark it fixed" per defect: the sub taps it, attaches a photo, and this
      // item flips to ready on the project - no reply-parsing, no account.
      const fix = it.fixUrl
        ? ctaButton("Mark it fixed", it.fixUrl, true) +
          `<div style="font-family:${FONT};font-size:11px;color:${MUT};margin-top:2px;">No account needed. Attach a photo of the fix and it is logged against this item.</div>`
        : "";
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;"><tr>
    <td style="border:1px solid ${LINE};border-radius:10px;padding:14px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="32" valign="top" style="width:32px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="22" height="22" align="center" bgcolor="${numBg}" style="width:22px;height:22px;border-radius:50%;font-family:${FONT};font-size:11.5px;font-weight:bold;color:#ffffff;">${Number(it.n) || 0}</td>
          </tr></table>
        </td>
        <td valign="top">
          <div style="font-family:${FONT};font-size:14px;font-weight:bold;color:${NAVY};line-height:1.3;">${esc(it.title)}${pill}</div>
          <div style="font-family:${FONT};font-size:11.5px;color:#7A8CA3;margin-top:3px;">${metaHtml}</div>
          ${note}
          ${photo}
          ${fix}
        </td>
      </tr></table>
    </td>
  </tr></table>`;
    })
    .join("\n");

  const snapshot = opts.snapshotCaption
    ? `<div style="font-family:${FONT};font-size:11px;color:#7A8CA3;text-align:center;margin:6px 0 4px;">&#128204; ${esc(opts.snapshotCaption)}</div>`
    : "";

  const html = shell({
    headerHtml: header(opts.companyName, opts.contextLine),
    bodyHtml: `${introBlock(opts.intro)}
${itemsHtml}
${snapshot}
${replyBlock(opts.replyName, opts.replyExtra ?? undefined)}`,
    footerNote: opts.footerNote,
    refLabel: opts.refLabel,
  });

  const text = [
    opts.companyName,
    opts.contextLine,
    "",
    opts.intro,
    "",
    ...opts.items.map(
      (it) =>
        `${it.n}. ${it.title}${it.statusLabel ? ` [${it.statusLabel}]` : ""}\n   ${it.meta}${it.note ? `\n   ${it.note}` : ""}${it.fixUrl ? `\n   Mark it fixed (no account needed): ${it.fixUrl}` : ""}`
    ),
    "",
    ...(opts.snapshotCaption ? [opts.snapshotCaption, ""] : []),
    `Just hit Reply: your response goes straight to ${opts.replyName}.`,
    "",
    `Sent with Soterra · ${opts.footerNote}${opts.refLabel ? ` · ${opts.refLabel}` : ""}`,
  ].join("\n");

  return { html, text };
}

// ─── 2: RFI to a consultant ──────────────────────────────────────────────

export type RfiEmailOptions = {
  companyName: string;
  contextLine: string; // "Kauri Tower · Raised by Adam Domok · 12 Aug 2026"
  rfiNumber: string; // "RFI-014"
  rfiSubject: string; // "Lintel fixing at grid C3, Level 1"
  requiredByLabel: string; // "Friday 22 Aug 2026 (7 working days)"
  meta: { label: string; value: string }[]; // discipline, priority, location, impacts, drawing
  question: string;
  proposedSolution?: string | null;
  drawingRefs?: string[]; // "S3.01 Rev C · pin at grid C3"
  codeRefs?: string[]; // "NZS 3604 cl 8.6"
  attachments?: string[]; // filenames listed in the body
  replyName: string;
  refLabel: string; // "RFI-014 · Rev 0"
  /** The tokenized public answer page. When set, the email leads with an
   *  "Answer online" button; a plain reply stays as the fallback. */
  answerUrl?: string | null;
};

export function renderRfiEmail(opts: RfiEmailOptions): { html: string; text: string } {
  const fillerCell = `<td width="33%" style="width:33%;padding:9px 13px;border-right:1px solid #EDF2F7;border-bottom:1px solid #EDF2F7;">&nbsp;</td>`;
  const metaCells = opts.meta
    .map(
      (m) => `<td width="33%" style="width:33%;padding:9px 13px;border-right:1px solid #EDF2F7;border-bottom:1px solid #EDF2F7;">
      <div style="font-family:${FONT};font-size:9.5px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;color:${MUT};">${esc(m.label)}</div>
      <div style="font-family:${FONT};font-size:12.5px;font-weight:bold;color:${NAVY};margin-top:2px;">${esc(m.value)}</div>
    </td>`
    )
    .reduce<string[][]>((rows, cell, i) => {
      if (i % 3 === 0) rows.push([]);
      rows[rows.length - 1].push(cell);
      return rows;
    }, [])
    // Pad a partial final row to 3 cells so the bordered box stays rectangular
    // (Outlook renders a missing cell as a blank notch inside the box).
    .map((row) => {
      while (row.length < 3) row.push(fillerCell);
      return `<tr>${row.join("")}</tr>`;
    })
    .join("");

  // td-padded, not a div: Outlook's Word engine ignores padding on divs, and
  // this padding is the ONLY separation between the RFI's sections.
  const section = (label: string) =>
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px 0 7px;font-family:${FONT};font-size:10.5px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#7A8CA3;">${esc(label)}</td></tr></table>`;

  const chip = (label: string, purple = false) =>
    `<span style="display:inline-block;font-family:${FONT};font-size:11.5px;font-weight:bold;color:${purple ? "#7C3AED" : "#0A78C8"};background:${purple ? "#F6F2FE" : "#EFF7FE"};border:1px solid ${purple ? "#E2D8FB" : "#C9E4FA"};border-radius:7px;padding:5px 10px;margin:0 5px 5px 0;">${esc(label)}</span>`;

  // Chips joined with &nbsp;: Outlook's Word engine drops span padding AND
  // margin, so without a real character between them the references would
  // run together as one unbroken string ("…Rev CNZS 3604 cl 8.6").
  const allChips = [
    ...(opts.drawingRefs ?? []).map((r) => chip("\u{1F4CC} " + r)),
    ...(opts.codeRefs ?? []).map((r) => chip(r, true)),
  ];
  const refsHtml = allChips.length
    ? `${section("References (pre-cited by Soterra)")}<div>${allChips.join("&nbsp;")}</div>`
    : "";

  const attachHtml = opts.attachments?.length
    ? `${section("Attachments")}<div style="font-family:${FONT};font-size:12.5px;color:#43586E;margin:2px 0;">&#128206; ${opts.attachments.map(esc).join(" · ")}</div>`
    : "";

  const propHtml = opts.proposedSolution
    ? `${section("Our proposed solution")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td style="background:#F8FAFC;border:1px solid ${LINE};border-radius:9px;padding:12px 14px;font-family:${FONT};font-size:13px;color:#43586E;line-height:1.5;">${esc(opts.proposedSolution)}</td>
  </tr></table>`
    : "";

  const bodyHtml = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;"><tr>
    <td style="background:#FFF7ED;border:1px solid #FDBA74;border-radius:8px;padding:9px 13px;font-family:${FONT};font-size:12.5px;font-weight:bold;color:#B45309;">&#9201; Response required by ${esc(opts.requiredByLabel)}</td>
  </tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid ${LINE};border-radius:10px;margin-bottom:4px;">${metaCells}</table>
${section("Question")}
<div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.55;">${esc(opts.question)}</div>
${propHtml}
${refsHtml}
${attachHtml}
${
  opts.answerUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 8px;"><tr>
    <td bgcolor="${BRAND}" style="background:${BRAND};border-radius:9px;padding:13px 28px;">
      <a href="${esc(opts.answerUrl)}" style="display:inline-block;font-family:${FONT};font-size:14.5px;font-weight:bold;color:#ffffff;text-decoration:none;">Answer this RFI online &#8594;</a>
    </td>
  </tr></table>
<div style="font-family:${FONT};font-size:12px;color:${MUT};margin:0 0 14px;">No account needed. Your answer lands in the RFI thread, is logged against ${esc(opts.rfiNumber)}, and stops the response clock.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
    <td style="background:#F8FAFC;border:1px dashed #D6DEE8;border-radius:8px;padding:11px 14px;font-family:${FONT};font-size:12.5px;color:#43586E;line-height:1.5;">&#8617; Or simply reply to this email - ${esc(opts.companyName)} logs your reply against ${esc(opts.rfiNumber)}.</td>
  </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr>
    <td style="background:#F8FAFC;border:1px dashed #D6DEE8;border-radius:8px;padding:11px 14px;font-family:${FONT};font-size:13px;color:#43586E;line-height:1.5;">&#8617; <b>Reply to this email with your response.</b> ${esc(opts.companyName)} logs it against ${esc(opts.rfiNumber)}; the register, thread and response times are tracked in Soterra.</td>
  </tr></table>`
}`;

  const headerHtml = `<tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:14px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td nowrap style="font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;white-space:nowrap;">${esc(opts.rfiNumber)}</td>
    <td style="font-family:${FONT};font-size:13px;color:#B8CCE0;padding-left:12px;">${esc(opts.rfiSubject)}</td>
  </tr></table>
</td></tr>
${header(opts.companyName, opts.contextLine)}`;

  const html = shell({
    headerHtml,
    bodyHtml,
    footerNote: "Sent with Soterra · soterra.co.nz",
    refLabel: opts.refLabel,
  });

  const text = [
    `${opts.rfiNumber} · ${opts.rfiSubject}`,
    opts.companyName,
    opts.contextLine,
    "",
    `Response required by ${opts.requiredByLabel}`,
    "",
    ...opts.meta.map((m) => `${m.label}: ${m.value}`),
    "",
    "QUESTION",
    opts.question,
    ...(opts.proposedSolution ? ["", "OUR PROPOSED SOLUTION", opts.proposedSolution] : []),
    ...(opts.drawingRefs?.length || opts.codeRefs?.length
      ? ["", "REFERENCES", [...(opts.drawingRefs ?? []), ...(opts.codeRefs ?? [])].join(" · ")]
      : []),
    ...(opts.attachments?.length ? ["", "ATTACHMENTS", opts.attachments.join(" · ")] : []),
    "",
    ...(opts.answerUrl
      ? [
          `ANSWER ONLINE (no account needed): ${opts.answerUrl}`,
          "",
          `Or simply reply to this email - ${opts.companyName} logs your reply against ${opts.rfiNumber}.`,
        ]
      : [
          `Reply to this email with your response. ${opts.companyName} logs it against ${opts.rfiNumber}; the register, thread and response times are tracked in Soterra.`,
        ]),
    "",
    `Sent with Soterra · soterra.co.nz · ${opts.refLabel}`,
  ].join("\n");

  return { html, text };
}

// ─── RFI answered — the note back to whoever raised it ───────────────────
// Sent when a consultant submits through the answer page. Deliberately small:
// the news, the answer itself, and where to accept or bounce it.

export function renderRfiAnswerNotice(opts: {
  companyName: string;
  projectName: string;
  rfiNumber: string; // "RFI-014"
  rfiSubject: string;
  consultantLine: string; // "Jane Smith · Holmes Structural"
  answer: string;
  appUrl: string; // where Accept + close lives
}): { html: string; text: string } {
  const headerHtml = `<tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:14px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td nowrap style="font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;white-space:nowrap;">${esc(opts.rfiNumber)} answered</td>
    <td style="font-family:${FONT};font-size:13px;color:#B8CCE0;padding-left:12px;">${esc(opts.rfiSubject)}</td>
  </tr></table>
</td></tr>
${header(opts.companyName, `${opts.projectName} · answered by ${opts.consultantLine}`)}`;

  const bodyHtml = `<div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.55;margin-bottom:6px;"><b>${esc(opts.consultantLine)}</b> has answered ${esc(opts.rfiNumber)}. The response clock has stopped; the ball is back with you.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;"><tr>
  <td style="background:#F0FAF4;border:1px solid #BFE8CE;border-radius:9px;padding:13px 15px;font-family:${FONT};font-size:13.5px;color:${INK};line-height:1.55;">${esc(opts.answer).replace(/\n/g, "<br/>")}</td>
</tr></table>
<div style="font-family:${FONT};font-size:12.5px;color:${SLATE};line-height:1.5;">Open Soterra to accept and close it, raise a CI from it, or bounce it back with a follow-up: <a href="${esc(opts.appUrl)}" style="color:${BRAND};font-weight:bold;text-decoration:none;">${esc(opts.appUrl.replace(/^https?:\/\//, ""))}</a></div>`;

  const html = shell({
    headerHtml,
    bodyHtml,
    footerNote: "Logged in the RFI thread · the register and scorecard are updated",
    refLabel: opts.rfiNumber,
  });
  const text = [
    `${opts.rfiNumber} answered · ${opts.rfiSubject}`,
    `${opts.projectName} · answered by ${opts.consultantLine}`,
    "",
    opts.answer,
    "",
    `The response clock has stopped. Accept + close, raise a CI, or bounce it back in Soterra: ${opts.appUrl}`,
  ].join("\n");
  return { html, text };
}

// ─── QA close-out: the consultant sign-off request ───────────────────────
// Sent when the MC forwards a fixed CONSULTANT defect for sign-off. The sub has
// already marked it fixed and attached a photo; the consultant views the photo
// on the page and either signs it off or bounces it back. Mirrors renderRfiEmail:
// a "Sign it off" CTA button, a plain reply as the fallback.

export function renderQaSignoffEmail(opts: {
  companyName: string;
  contextLine: string; // "Kauri Tower · Fire · marked fixed 18 Aug 2026"
  title: string; // the defect
  detail?: string | null; // the inspector's wording
  location?: string | null;
  category?: string | null;
  subLine: string; // "Fire Protection Ltd" - who marked it fixed
  fixNote?: string | null; // the sub's note on the fix
  hasPhoto: boolean; // a photo of the fix is on the page
  signoffUrl: string; // APP_URL/signoff/<token>
  refLabel: string;
}): { html: string; text: string } {
  const headerHtml = `<tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:14px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td nowrap style="font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;white-space:nowrap;">Sign-off requested</td>
    <td style="font-family:${FONT};font-size:13px;color:#B8CCE0;padding-left:12px;">${esc(opts.title)}</td>
  </tr></table>
</td></tr>
${header(opts.companyName, opts.contextLine)}`;

  const meta = [opts.category, opts.location].filter(Boolean).join(" · ");
  const detailHtml = opts.detail
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0;"><tr>
      <td style="background:#F8FAFC;border:1px solid ${LINE};border-radius:9px;padding:12px 14px;font-family:${FONT};font-size:13px;color:#43586E;line-height:1.5;">${esc(opts.detail)}</td>
    </tr></table>`
    : "";
  const fixHtml = opts.fixNote
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:10px 0;"><tr>
      <td style="background:#F0FAF4;border:1px solid #BFE8CE;border-radius:9px;padding:12px 14px;font-family:${FONT};font-size:13px;color:${INK};line-height:1.5;"><b>${esc(opts.subLine)} says:</b> ${esc(opts.fixNote)}</td>
    </tr></table>`
    : "";

  const bodyHtml = `<div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.55;margin-bottom:4px;"><b>${esc(opts.subLine)}</b> has marked this item fixed and it needs your sign-off.</div>
${meta ? `<div style="font-family:${FONT};font-size:12px;color:#7A8CA3;margin-bottom:6px;">${esc(meta)}</div>` : ""}
${detailHtml}
${fixHtml}
<div style="font-family:${FONT};font-size:12.5px;color:${SLATE};margin:6px 0 2px;">${opts.hasPhoto ? "A photo of the fix is on the page below." : "Open the page to review and sign off."}</div>
${ctaButton("Sign it off", opts.signoffUrl)}
<div style="font-family:${FONT};font-size:12px;color:${MUT};margin:0 0 14px;">No account needed. Approve to close it out, or bounce it back to ${esc(opts.subLine)} with a note.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;"><tr>
    <td style="background:#F8FAFC;border:1px dashed #D6DEE8;border-radius:8px;padding:11px 14px;font-family:${FONT};font-size:12.5px;color:#43586E;line-height:1.5;">&#8617; Or simply reply to this email - ${esc(opts.companyName)} logs your decision.</td>
  </tr></table>`;

  const html = shell({
    headerHtml,
    bodyHtml,
    footerNote: "Sent with Soterra · soterra.co.nz",
    refLabel: opts.refLabel,
  });
  const text = [
    `Sign-off requested · ${opts.title}`,
    opts.companyName,
    opts.contextLine,
    "",
    `${opts.subLine} has marked this item fixed and it needs your sign-off.`,
    ...(meta ? ["", meta] : []),
    ...(opts.detail ? ["", opts.detail] : []),
    ...(opts.fixNote ? ["", `${opts.subLine} says: ${opts.fixNote}`] : []),
    "",
    `SIGN IT OFF (no account needed): ${opts.signoffUrl}`,
    "",
    `Or simply reply to this email - ${opts.companyName} logs your decision.`,
    "",
    `Sent with Soterra · soterra.co.nz · ${opts.refLabel}`,
  ].join("\n");
  return { html, text };
}

// ─── QA close-out: the notice back to the MC ─────────────────────────────
// Two shapes, one template: the sub marked a defect fixed (ready), or a
// consultant made a decision (signed off / bounced). Small, like renderRfiAnswerNotice.

export function renderQaCloseoutNotice(opts: {
  companyName: string;
  projectName: string;
  title: string; // the defect
  kind: "ready" | "signed_off" | "bounced"; // what happened
  actorLine: string; // "Fire Protection Ltd" or "Jane Smith · Holmes Structural"
  note?: string | null; // the sub's fix note or the consultant's note
  nextLine: string; // what the MC does next
  appUrl: string;
  refLabel: string;
}): { html: string; text: string } {
  const banner =
    opts.kind === "ready"
      ? { title: "Marked fixed", tone: "#0A78C8", bg: "#EFF7FE", border: "#C9E4FA" }
      : opts.kind === "signed_off"
        ? { title: "Signed off", tone: "#0F7B43", bg: "#F0FAF4", border: "#BFE8CE" }
        : { title: "Bounced back", tone: "#B45309", bg: "#FFF7ED", border: "#FDBA74" };

  const headerHtml = `<tr><td bgcolor="${NAVY}" style="background:${NAVY};padding:14px 28px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td nowrap style="font-family:${FONT};font-size:16px;font-weight:bold;color:#ffffff;white-space:nowrap;">${esc(banner.title)}</td>
    <td style="font-family:${FONT};font-size:13px;color:#B8CCE0;padding-left:12px;">${esc(opts.title)}</td>
  </tr></table>
</td></tr>
${header(opts.companyName, `${opts.projectName} · ${opts.actorLine}`)}`;

  const noteHtml = opts.note
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0;"><tr>
      <td style="background:${banner.bg};border:1px solid ${banner.border};border-radius:9px;padding:13px 15px;font-family:${FONT};font-size:13.5px;color:${INK};line-height:1.55;">${esc(opts.note).replace(/\n/g, "<br/>")}</td>
    </tr></table>`
    : "";

  const bodyHtml = `<div style="font-family:${FONT};font-size:14px;color:${INK};line-height:1.55;margin-bottom:6px;"><b>${esc(opts.actorLine)}</b> - ${esc(opts.nextLine)}</div>
${noteHtml}
<div style="font-family:${FONT};font-size:12.5px;color:${SLATE};line-height:1.5;">Open Soterra to action it: <a href="${esc(opts.appUrl)}" style="color:${BRAND};font-weight:bold;text-decoration:none;">${esc(opts.appUrl.replace(/^https?:\/\//, ""))}</a></div>`;

  const html = shell({
    headerHtml,
    bodyHtml,
    footerNote: "Sent with Soterra · recorded on the project QA log",
    refLabel: opts.refLabel,
  });
  const text = [
    `${banner.title} · ${opts.title}`,
    `${opts.projectName} · ${opts.actorLine}`,
    "",
    opts.nextLine,
    ...(opts.note ? ["", opts.note] : []),
    "",
    `Open Soterra to action it: ${opts.appUrl}`,
  ].join("\n");
  return { html, text };
}
