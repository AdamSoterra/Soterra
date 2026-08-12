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

// ─── 1 + 3: itemised sends (QA flags / inspection items) ─────────────────

export type EmailItem = {
  n: number;
  title: string;
  meta: string; // "Fire · A3-00-7400 Rev.2 · Basement, high level" — first segment bolded
  note?: string | null;
  statusLabel?: string | null; // "not done" pill (inspection-items variant)
  photoNote?: string | null; // "site photo attached"
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
        `${it.n}. ${it.title}${it.statusLabel ? ` [${it.statusLabel}]` : ""}\n   ${it.meta}${it.note ? `\n   ${it.note}` : ""}`
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
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr>
    <td style="background:#F8FAFC;border:1px dashed #D6DEE8;border-radius:8px;padding:11px 14px;font-family:${FONT};font-size:13px;color:#43586E;line-height:1.5;">&#8617; <b>Reply to this email with your response.</b> ${esc(opts.companyName)} logs it against ${esc(opts.rfiNumber)}; the register, thread and response times are tracked in Soterra.</td>
  </tr></table>`;

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
    `Reply to this email with your response. ${opts.companyName} logs it against ${opts.rfiNumber}; the register, thread and response times are tracked in Soterra.`,
    "",
    `Sent with Soterra · soterra.co.nz · ${opts.refLabel}`,
  ].join("\n");

  return { html, text };
}
