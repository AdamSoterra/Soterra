"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { CiCard, CiForm, ciPayload, guessIssuer, type Ci, type CiDocOption } from "./ci-form";

// ─── Correspondence — the register next to RFIs ───────────────────────────
//
// Notices, site instructions, transmittals (plans, shop drawings, documents
// going out) and general letters: sent from the project's Soterra address,
// recorded, answered from a private link or a plain email reply, the whole
// thread here. Lives on the RFIs tab as its own area (RFIs | Correspondence),
// the way Inspections has External | Internal. Kept in its own file so the
// 7000-line app page only gains a toggle and one render line.

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Consultant = { id: string; name: string | null; company: string | null; discipline: string | null; email: string };
type Sub = { id: string; name: string; email: string; trade: string | null };
type Att = { filename: string; path: string; bytes: number; contentType: string; filedAs?: { doc: string; docType: string } | null };
type Row = {
  id: string;
  type: string;
  typeLabel: string;
  label: string;
  number: number | null;
  subject: string;
  status: string;
  responseRequired: boolean;
  dateDue: string | null;
  dateSent: string | null;
  toName: string | null;
  toCompany: string | null;
  toEmail: string | null;
  attachmentCount: number;
  messageCount?: number;
  lastAt?: string | null;
  overdue: boolean;
  updatedAt: string;
};
type Msg = { id: string; type: string; authorSide: string; authorName: string | null; via: string | null; body: string; attachments: Att[]; createdAt: string };
type Full = {
  item: Row & {
    body: string;
    attachments: Att[];
    ccList: string[];
    sentByName: string | null;
    fileAsDocs: boolean;
    docType: string | null;
    dateResponded: string | null;
    dateClosed: string | null;
    toKind: string | null;
  };
  messages: Msg[];
  /** A client instruction raised from this item (shown inside it). */
  ci?: Ci | null;
};

const TYPES = [
  { id: "notice", label: "Notice", hint: "putting something on record: a delay, a variation, a problem" },
  { id: "instruction", label: "Site instruction", hint: "a direction to a sub or consultant" },
  { id: "transmittal", label: "Transmittal", hint: "sending drawings, shop drawings or documents" },
  { id: "general", label: "General", hint: "anything else worth having on record" },
];
const DOC_TYPES: [string, string][] = [
  ["drawings", "Drawings"],
  ["specs", "Specifications"],
  ["reports", "Reports & PS"],
  ["scopes", "Scopes"],
  ["programme", "Programme"],
  ["other", "Other"],
];
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short" }) : "-");
const fmtLong = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "");
const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`);
const pill = (s: string) => (s === "sent" ? "sent" : s === "responded" ? "responded" : s === "closed" ? "closed" : s === "draft" ? "draft" : "void");
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const EMPTY = {
  type: "general",
  subject: "",
  body: "",
  toKind: "consultant" as "consultant" | "sub" | "other",
  toPick: "",
  toName: "",
  toCompany: "",
  toEmail: "",
  cc: "",
  responseRequired: false,
  dateDue: "",
  fileAsDocs: true,
  docType: "drawings",
};

export function CorrespondencePanel({
  apiFetch,
  projectId,
  projName,
  consultants,
  subs,
  openDirectory,
  categories,
}: {
  apiFetch: ApiFetch;
  projectId: string;
  projName: string;
  consultants: Consultant[];
  subs: Sub[];
  openDirectory: (tab: "consultants" | "subs") => void;
  /** The trade list a CI raised from an item can be tagged with. */
  categories: string[];
}) {
  const [ciFormOpen, setCiFormOpen] = useState(false);
  // Files picked before the draft exists are staged under a per-form key.
  const pendingKey = useRef(Math.random().toString(36).slice(2, 10));
  const [list, setList] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "awaiting" | "overdue" | "responded" | "closed" | "draft">("all");
  const [open, setOpen] = useState<Full | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftAtts, setDraftAtts] = useState<Att[]>([]);
  const [uploading, setUploading] = useState(false);
  const [reply, setReply] = useState("");
  const [replyAtts, setReplyAtts] = useState<Att[]>([]);
  const newFileRef = useRef<HTMLInputElement>(null);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const r = await apiFetch("/api/correspondence");
      const d = await r.json();
      if (Array.isArray(d?.items)) setList(d.items);
    } catch {
      /* keep what we have */
    } finally {
      setLoaded(true);
    }
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openById = async (id: string) => {
    setErr(null);
    setReply("");
    setReplyAtts([]);
    try {
      const r = await apiFetch(`/api/correspondence?id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (r.ok && d.item) setOpen(d as Full);
      else setErr(d.error || "Couldn't open that.");
    } catch {
      setErr("Couldn't open that.");
    }
  };
  const action = async (id: string, act: string, extra: Record<string, unknown> = {}) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch("/api/correspondence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: act, ...extra }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "That didn't work just now.");
      await openById(id);
      void load();
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work just now.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  // ── the new-item form ──
  const formPayload = () => ({
    type: form.type,
    subject: form.subject,
    body: form.body || "(draft)",
    toKind: form.toKind,
    toName: form.toName,
    toCompany: form.toCompany,
    toEmail: form.toEmail,
    cc: form.cc,
    responseRequired: form.responseRequired,
    dateDue: form.responseRequired && form.dateDue ? new Date(form.dateDue + "T17:00:00").toISOString() : "",
    fileAsDocs: form.type === "transmittal", // a transmittal's PDFs always file into Documents
    docType: form.docType,
  });
  /** The draft row exists once anything needs an id (a file, a save, a send). */
  const ensureDraft = async (): Promise<string> => {
    if (draftId) {
      const r = await apiFetch("/api/correspondence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, action: "update", ...formPayload() }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Couldn't save the draft.");
      return draftId;
    }
    // The staged files go on the row as it is created.
    const r = await apiFetch("/api/correspondence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...formPayload(), attachments: draftAtts }) });
    const d = await r.json();
    if (!r.ok || !d.item) throw new Error(d.error || "Couldn't save the draft.");
    setDraftId(d.item.id);
    return d.item.id as string;
  };
  /** `sub` = the item id, or "pending/<key>" for a form that has no draft yet. */
  const uploadFiles = async (sub: string, files: FileList): Promise<Att[]> => {
    const out: Att[] = [];
    for (const f of Array.from(files).slice(0, 15)) {
      const res = await upload(`${projectId}/correspondence/${sub}/${f.name}`, f, {
        access: "private",
        handleUploadUrl: "/api/upload/token",
        clientPayload: JSON.stringify({ projectId }),
        contentType: f.type || "application/octet-stream",
      });
      out.push({ filename: f.name, path: res.pathname, bytes: f.size, contentType: f.type || "application/octet-stream" });
    }
    return out;
  };
  const pickNewFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    setErr(null);
    try {
      if (draftId) {
        // The draft exists: files go under its folder and onto the row.
        const atts = await uploadFiles(draftId, files);
        const r = await apiFetch("/api/correspondence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, action: "attach", files: atts }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't attach those.");
        setDraftAtts(JSON.parse(d.item.attachments ?? "[]"));
      } else {
        // No draft yet: stage them, they ride along when the draft is created.
        const atts = await uploadFiles(`pending/${pendingKey.current}`, files);
        setDraftAtts((xs) => [...xs, ...atts]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach those.");
    } finally {
      setUploading(false);
      if (newFileRef.current) newFileRef.current.value = "";
    }
  };
  const detach = async (path: string) => {
    if (!draftId) {
      setDraftAtts((xs) => xs.filter((a) => a.path !== path));
      return;
    }
    const r = await apiFetch("/api/correspondence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draftId, action: "detach", path }) });
    const d = await r.json();
    if (r.ok) setDraftAtts(JSON.parse(d.item.attachments ?? "[]"));
  };
  const resetForm = () => {
    setForm(EMPTY);
    setDraftId(null);
    setDraftAtts([]);
    pendingKey.current = Math.random().toString(36).slice(2, 10);
    setNewOpen(false);
  };
  const saveOrSend = async (send: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      if (!form.subject.trim()) throw new Error("Give it a subject.");
      if (!form.body.trim()) throw new Error("Write the message.");
      if (send && !EMAIL_RE.test(form.toEmail.trim())) throw new Error("Who is it going to? Add their email.");
      const id = await ensureDraft();
      if (send) {
        const r = await apiFetch("/api/correspondence", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action: "send" }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Couldn't send it.");
      }
      resetForm();
      await openById(id);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  };
  const pickTo = (v: string) => {
    setForm((f) => ({ ...f, toPick: v }));
    if (v.startsWith("c:")) {
      const c = consultants.find((x) => x.id === v.slice(2));
      if (c) setForm((f) => ({ ...f, toKind: "consultant", toName: c.name ?? "", toCompany: c.company ?? "", toEmail: c.email }));
    } else if (v.startsWith("s:")) {
      const s = subs.find((x) => x.id === v.slice(2));
      if (s) setForm((f) => ({ ...f, toKind: "sub", toName: s.name, toCompany: "", toEmail: s.email }));
    }
  };

  // ── replies on an open item ──
  const pickReplyFiles = async (files: FileList | null) => {
    if (!files?.length || !open) return;
    setUploading(true);
    setErr(null);
    try {
      const atts = await uploadFiles(open.item.id, files);
      setReplyAtts((xs) => [...xs, ...atts]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't attach those.");
    } finally {
      setUploading(false);
      if (replyFileRef.current) replyFileRef.current.value = "";
    }
  };
  const sendReply = async () => {
    if (!open || (!reply.trim() && !replyAtts.length)) return;
    if (await action(open.item.id, "message", { body: reply, files: replyAtts })) {
      setReply("");
      setReplyAtts([]);
    }
  };

  const tiles = {
    awaiting: list.filter((r) => r.status === "sent" && r.responseRequired).length,
    overdue: list.filter((r) => r.overdue).length,
    responded: list.filter((r) => r.status === "responded").length,
    sent: list.filter((r) => r.status === "sent" || r.status === "responded").length,
  };
  const shown = list.filter((r) =>
    filter === "all" ? r.status !== "void" : filter === "awaiting" ? r.status === "sent" && r.responseRequired : filter === "overdue" ? r.overdue : filter === "responded" ? r.status === "responded" : filter === "closed" ? r.status === "closed" : r.status === "draft"
  );

  const AttRow = ({ a, itemId, canFile }: { a: Att; itemId: string; canFile: boolean }) => (
    <div className="co-att">
      <span>{/\.pdf$/i.test(a.filename) ? "📄" : /\.(jpe?g|png|webp)$/i.test(a.filename) ? "🖼" : "📎"}</span>
      <a href={`/api/corr-file?id=${encodeURIComponent(itemId)}&path=${encodeURIComponent(a.path)}&project=${encodeURIComponent(projectId)}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
        {a.filename}
      </a>
      <small>{bytes(a.bytes)}</small>
      {a.filedAs ? (
        <span className="filed">✓ in Documents</span>
      ) : canFile && /\.pdf$/i.test(a.filename) ? (
        <select className="co-attbtn" disabled={busy} defaultValue="" onChange={(e) => { if (e.target.value) void action(itemId, "file_document", { path: a.path, docType: e.target.value }); }}>
          <option value="">File in Documents as…</option>
          {DOC_TYPES.map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>
      ) : null}
    </div>
  );

  // ─────────────────────────── render ───────────────────────────
  if (open) {
    const it = open.item;
    const toLine = [it.toName, it.toCompany].filter(Boolean).join(" · ") || it.toEmail || "-";
    return (
      <>
        <button className="rf-back" onClick={() => { setOpen(null); void load(); }}>‹ Back to the register</button>
        <div className="rf-dhead">
          <span className="no">{it.label}</span>
          <span className="rf-pill us">{it.typeLabel}</span>
          <span className="subj">{it.subject}</span>
          <span className={"rf-pill " + pill(it.status)}>{it.status}</span>
          {it.responseRequired && it.status === "sent" && <span className={"rf-pill " + (it.overdue ? "void" : "open")} style={it.overdue ? { textDecoration: "none", background: "rgba(239,68,68,.1)", color: "#B91C1C" } : undefined}>{it.overdue ? "overdue" : "response needed"}</span>}
          <span className="meta">{it.dateSent ? `Sent ${fmt(it.dateSent)}` : "draft"}{it.dateDue && it.responseRequired ? ` · due ${fmt(it.dateDue)}` : ""}</span>
        </div>
        {err && <div className="ev-err" style={{ marginBottom: 12 }}>{err}</div>}

        <div className="rf-cols">
          <div className="rf-thread">
            {it.status === "draft" && (
              <div className="rf-card" style={{ borderColor: "rgba(139,92,246,.4)" }}>
                <div className="k">Draft - not sent, no number burned</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 18px", fontSize: 13 }} disabled={busy || !it.toEmail} onClick={() => void action(it.id, "send")}>
                    {busy ? "Sending…" : `Send to ${toLine}`}
                  </button>
                  <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={busy} onClick={() => void action(it.id, "void")}>Void draft</button>
                </div>
                {!it.toEmail && <p className="page-sub" style={{ margin: "10px 0 0" }}>This draft has no recipient email yet. Void it and start again with one, or send it from a new item.</p>}
              </div>
            )}


            {/* One thread, like email: what went out, every reply in order, the
                reply box at the bottom (Adam 2026-09-10: "messages come one by one
                like an email"). */}
            <div className="rf-card">
              <div className="k">Conversation</div>
              <div className="co-msg">
                <div className="who">{it.sentByName ?? "Us"} · {it.dateSent ? fmtLong(it.dateSent) : "draft"} · {it.typeLabel}{it.toEmail ? ` → ${toLine}` : ""}</div>
                <div className="body">{it.body}</div>
                {it.attachments.map((a) => (
                  <AttRow key={a.path} a={a} itemId={it.id} canFile={it.status !== "draft"} />
                ))}
              </div>
              {open.messages.map((m) =>
                m.type === "system" ? (
                  <div className="rf-sys" key={m.id}>{m.body} · {fmt(m.createdAt)}</div>
                ) : (
                  <div className={"co-msg" + (m.authorSide === "external" ? " them" : "")} key={m.id}>
                    <div className="who">
                      {m.authorName ?? (m.authorSide === "external" ? "Them" : "Us")} · {fmtLong(m.createdAt)}{m.via === "email" ? " · by email" : m.via === "link" ? " · from the link" : m.via === "portal" ? " · from the portal" : ""}
                    </div>
                    <div className="body">{m.body}</div>
                    {m.attachments.map((a) => (
                      <AttRow key={a.path} a={a} itemId={it.id} canFile />
                    ))}
                  </div>
                )
              )}
              {(it.status === "sent" || it.status === "responded") && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
                  <div className="k">Reply</div>
                  <textarea className="ev-in" rows={3} value={reply} placeholder="Goes to them by email with the link, and stays on this thread." onChange={(e) => setReply(e.target.value)} />
                  {replyAtts.map((a) => (
                    <div className="co-att" key={a.path}><span>📎</span><a>{a.filename}</a><small>{bytes(a.bytes)}</small></div>
                  ))}
                  <input ref={replyFileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => void pickReplyFiles(e.target.files)} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={busy || uploading} onClick={() => replyFileRef.current?.click()}>{uploading ? "Uploading…" : "📎 Attach"}</button>
                    <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 16px", fontSize: 13 }} disabled={busy || uploading || (!reply.trim() && !replyAtts.length)} onClick={() => void sendReply()}>Send</button>
                    <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13, marginLeft: "auto" }} disabled={busy} onClick={() => void action(it.id, "close")}>Close it out</button>
                  </div>
                </div>
              )}
              {it.status === "closed" && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="k" style={{ margin: 0 }}>Closed{it.dateClosed ? ` · ${fmt(it.dateClosed)}` : ""}</span>
                  <button className="lg-btn" style={{ height: 34, margin: "0 0 0 auto", width: "auto", padding: "0 12px", fontSize: 12.5 }} disabled={busy} onClick={() => void action(it.id, "reopen")}>Reopen</button>
                </div>
              )}
            </div>
            {open.ci && (
              <CiCard ci={open.ci} apiFetch={apiFetch} projectId={projectId} projName={projName} categories={categories} onChanged={(c) => setOpen((o) => (o ? { ...o, ci: c } : o))} />
            )}
          </div>

          <div className="rf-rail">
            <div className="rf-card">
              <div className="k">Details</div>
              <div className="rf-kv"><span className="k2">To</span><span className="v">{toLine}</span></div>
              {it.toEmail && <div className="rf-kv"><span className="k2">Email</span><span className="v" style={{ fontWeight: 500 }}>{it.toEmail}</span></div>}
              {it.ccList.length > 0 && <div className="rf-kv"><span className="k2">Cc</span><span className="v" style={{ fontWeight: 500 }}>{it.ccList.join(", ")}</span></div>}
              <div className="rf-kv"><span className="k2">Type</span><span className="v">{it.typeLabel}</span></div>
              <div className="rf-kv"><span className="k2">Response</span><span className={"v" + (it.overdue ? " warn" : "")}>{it.responseRequired ? `required${it.dateDue ? ` by ${fmt(it.dateDue)}` : ""}` : "not required"}</span></div>
              {it.dateSent && <div className="rf-kv"><span className="k2">Sent</span><span className="v">{fmt(it.dateSent)}{it.sentByName ? ` · ${it.sentByName}` : ""}</span></div>}
              {it.dateResponded && <div className="rf-kv"><span className="k2">Responded</span><span className="v">{fmt(it.dateResponded)}</span></div>}
              {it.type === "transmittal" && <div className="rf-kv"><span className="k2">Filed in Documents</span><span className="v">{it.attachments.filter((a) => a.filedAs).length} of {it.attachments.length}</span></div>}
            </div>
            {!open.ci && it.status !== "draft" && (
              <div className="rf-card">
                <div className="k">Is this an instruction?</div>
                <p className="page-sub" style={{ margin: "0 0 10px" }}>If the client, architect or engineer is instructing a change here, raise it as a CI. It stays inside this item, the assistant treats it as amending the drawings, and it goes first on the related QA checks.</p>
                <button className="lg-btn" style={{ height: 38, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} onClick={() => setCiFormOpen(true)}>Raise a CI from this</button>
              </div>
            )}
            {ciFormOpen && (() => {
              const theirs = open.messages.filter((m) => m.type === "message" && m.authorSide === "external");
              const last = theirs[theirs.length - 1];
              const pdfs: CiDocOption[] = [...it.attachments, ...open.messages.flatMap((m) => m.attachments)].filter((a) => /\.pdf$/i.test(a.filename)).map((a) => ({ path: a.path, filename: a.filename }));
              return (
                <CiForm
                  projName={projName}
                  categories={categories}
                  apiFetch={apiFetch}
                  projectId={projectId}
                  docOptions={pdfs}
                  initial={{ title: it.subject, body: last ? last.body : it.body, issuedBy: guessIssuer(it.toCompany), issuedByName: toLine }}
                  onSave={async (values, doc) => {
                    const r = await apiFetch("/api/instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ciPayload(values), sourceCorrId: it.id }) });
                    const d = await r.json();
                    if (!r.ok || !d.item) throw new Error(d.error || "Couldn't raise the instruction.");
                    let item = d.item as Ci;
                    if (doc) {
                      const a = await apiFetch("/api/instructions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: "attach", path: doc.path, filename: doc.filename, fromRecord: true }) });
                      const j = await a.json();
                      if (a.ok && j.item) item = j.item as Ci;
                    }
                    return item;
                  }}
                  onSaved={() => { setCiFormOpen(false); void openById(it.id); }}
                  onCancel={() => setCiFormOpen(false)}
                />
              );
            })()}
            <div className="rf-card">
              <div className="k">How they reply</div>
              <p className="page-sub" style={{ margin: 0 }}>
                The email carries a private link to this item; anything they write there lands in this thread, as does a plain reply to the email when inbound capture is on. Their files arrive here too - a PDF can be filed into Documents in one tap.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="rf-head">
        <div className="page-h" style={{ margin: 0 }}>Correspondence</div>
        <div className="rf-vs">
          <button className="rf-vsb" onClick={() => openDirectory("consultants")}>Directory</button>
        </div>
        <button className="rf-new" onClick={() => { setErr(null); setNewOpen(true); }}>＋ New</button>
      </div>
      {err && !newOpen && <div className="ev-err" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="rf-strip">
        <div className="rf-tile"><b>{tiles.sent}</b><span>out there</span><small>sent or answered</small></div>
        <div className="rf-tile"><b>{tiles.awaiting}</b><span>awaiting a response</span><small>response required</small></div>
        <div className="rf-tile"><b className={tiles.overdue ? "red" : ""}>{tiles.overdue}</b><span>overdue</span><small>past the due date</small></div>
        <div className="rf-tile"><b>{tiles.responded}</b><span>responded</span><small>ready to close</small></div>
      </div>
      <div className="rf-filters">
        {(["all", "awaiting", "overdue", "responded", "closed", "draft"] as const).map((f) => (
          <button key={f} className={"rf-f" + (filter === f ? " act" : "")} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "awaiting" ? "Awaiting response" : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      <div className="rf-reg">
        {!loaded ? (
          <div className="page-sub" style={{ padding: 16 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: "26px 20px", textAlign: "center" }}>
            <b style={{ fontSize: 15, color: "var(--navy)" }}>{list.length === 0 ? `No correspondence yet on ${projName}` : "Nothing in this view"}</b>
            {list.length === 0 && (
              <p className="page-sub" style={{ margin: "8px auto 14px", maxWidth: 480 }}>
                Notices, site instructions, transmittals and letters, sent from this site&apos;s Soterra address and kept on record with the reply. Send plans and shop drawings as a transmittal and they file straight into Documents.
              </p>
            )}
            {list.length === 0 && <button className="rf-new" style={{ margin: 0 }} onClick={() => setNewOpen(true)}>＋ Send the first one</button>}
          </div>
        ) : (
          <table>
            <thead><tr><th>No.</th><th>Type</th><th>Subject</th><th>To</th><th>Status</th><th>Sent</th><th>Due</th><th>Thread</th><th style={{ textAlign: "right" }}>Files</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={r.overdue ? "late" : ""} onClick={() => void openById(r.id)}>
                  <td className="num">{r.label}</td>
                  <td>{r.typeLabel}</td>
                  <td className="subj">{r.subject}</td>
                  <td>{[r.toName, r.toCompany].filter(Boolean).join(" · ") || r.toEmail || "-"}</td>
                  <td><span className={"rf-pill " + pill(r.status)}>{r.status}</span></td>
                  <td className="due">{fmt(r.dateSent)}</td>
                  <td className={"due" + (r.overdue ? " red" : "")}>{r.responseRequired && r.status === "sent" ? fmt(r.dateDue) + (r.overdue ? " · late" : "") : "-"}</td>
                  <td className="due">{r.messageCount ? `${r.messageCount} repl${r.messageCount === 1 ? "y" : "ies"}${r.lastAt ? ` · ${fmt(r.lastAt)}` : ""}` : "-"}</td>
                  <td className="days">{r.attachmentCount || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {newOpen && (
        <div className="scrim" onClick={() => { if (!busy && !uploading) resetForm(); }}>
          <div className="sheet" style={{ maxWidth: 620, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>New correspondence</b><small>{projName}</small></div>
              {!busy && !uploading && <button className="sh-x" onClick={resetForm}>✕</button>}
            </div>
            <div className="form-body">
              <label className="ev-lbl">What is it</label>
              <div className="co-types">
                {TYPES.map((t) => (
                  <button key={t.id} type="button" className={"co-type" + (form.type === t.id ? " act" : "")} onClick={() => setForm((f) => ({ ...f, type: t.id }))}>
                    {t.label}<small>{t.hint}</small>
                  </button>
                ))}
              </div>
              <div className="fld" style={{ marginBottom: 12 }}>
                <label className="ev-lbl">Subject</label>
                <input className="ev-in" value={form.subject} placeholder={form.type === "transmittal" ? "e.g. Level 2 shop drawings, Rev B" : "e.g. Notice of delay, north elevation scaffold"} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
              </div>
              <label className="ev-lbl">Message</label>
              <textarea className="ev-in" rows={6} style={{ fontSize: 15, lineHeight: 1.5 }} value={form.body} placeholder="What you are sending, or telling them, in your own words." onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />

              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                <label className="ev-lbl" style={{ margin: 0 }}>To</label>
                <button type="button" className="dir-link" style={{ marginLeft: "auto" }} onClick={() => openDirectory(form.toKind === "sub" ? "subs" : "consultants")}>Manage directory</button>
              </div>
              {(consultants.length > 0 || subs.length > 0) && (
                <select className="ev-in" style={{ marginTop: 6 }} value={form.toPick} onChange={(e) => pickTo(e.target.value)}>
                  <option value="">Pick from the directory - fills the fields below…</option>
                  {consultants.length > 0 && (
                    <optgroup label="Consultants">
                      {consultants.map((c) => <option key={c.id} value={"c:" + c.id}>{[c.name, c.company, c.discipline].filter(Boolean).join(" - ") || c.email}</option>)}
                    </optgroup>
                  )}
                  {subs.length > 0 && (
                    <optgroup label="Subs">
                      {subs.map((s) => <option key={s.id} value={"s:" + s.id}>{[s.name, s.trade].filter(Boolean).join(" - ")}</option>)}
                    </optgroup>
                  )}
                </select>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Name</label>
                  <input className="ev-in" value={form.toName} placeholder="Jane Smith" onChange={(e) => setForm((f) => ({ ...f, toName: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Their company</label>
                  <input className="ev-in" value={form.toCompany} placeholder="Holmes Structural" onChange={(e) => setForm((f) => ({ ...f, toCompany: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Their email</label>
                  <input className="ev-in" type="email" value={form.toEmail} placeholder="jane@holmes.co.nz" onChange={(e) => setForm((f) => ({ ...f, toEmail: e.target.value }))} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="ev-lbl">Cc</label>
                  <input className="ev-in" value={form.cc} placeholder="anyone else who should have it" onChange={(e) => setForm((f) => ({ ...f, cc: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {(["consultant", "sub", "other"] as const).map((k) => (
                  <button key={k} type="button" className={"rf-f" + (form.toKind === k ? " act" : "")} onClick={() => setForm((f) => ({ ...f, toKind: k }))}>
                    {k === "consultant" ? "A consultant" : k === "sub" ? "A sub" : "Someone else"}
                  </button>
                ))}
              </div>

              <label className="ev-lbl" style={{ marginTop: 14 }}>Attachments <span className="opt">· plans, shop drawings, photos, documents</span></label>
              {draftAtts.map((a) => (
                <div className="co-att" key={a.path}>
                  <span>📎</span><a>{a.filename}</a><small>{bytes(a.bytes)}</small>
                  <button type="button" className="co-attbtn" disabled={uploading} onClick={() => void detach(a.path)}>Remove</button>
                </div>
              ))}
              <input ref={newFileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => void pickNewFiles(e.target.files)} />
              <button type="button" className="co-drop" disabled={uploading || busy} onClick={() => newFileRef.current?.click()}>
                {uploading ? "Uploading…" : "📎 Attach files"}
              </button>
              {form.type === "transmittal" && (
                <p className="page-sub" style={{ margin: "10px 0 0" }}>
                  The PDFs file into this site&apos;s Documents on send, as{" "}
                  <select className="co-attbtn" value={form.docType} onChange={(e) => setForm((f) => ({ ...f, docType: e.target.value }))}>
                    {DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  , so the assistant and the QA checks see them. A revised sheet uploads as its own document.
                </p>
              )}

              <label className="rf-cpbox" style={{ marginTop: 14 }}>
                <input type="checkbox" checked={form.responseRequired} onChange={(e) => setForm((f) => ({ ...f, responseRequired: e.target.checked }))} />
                <span><b>Response required</b> - tracked as awaiting their reply, with a due date{form.responseRequired ? ":" : "."}</span>
                {form.responseRequired && (
                  <input className="ev-in" type="date" style={{ width: "auto" }} value={form.dateDue} onClick={(e) => e.stopPropagation()} onChange={(e) => setForm((f) => ({ ...f, dateDue: e.target.value }))} />
                )}
              </label>

              <p className="page-sub" style={{ margin: "12px 0 0" }}>
                Send burns the next number for this type, emails it from this site&apos;s Soterra address with the files attached, and keeps the reply in the thread. A draft burns nothing.
              </p>
              {err && <div className="ev-err">{err}</div>}
              <div className="form-actions">
                <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 18px" }} disabled={busy || uploading || !form.subject.trim() || !form.body.trim()} onClick={() => void saveOrSend(false)}>Save draft</button>
                <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={busy || uploading || !form.subject.trim() || !form.body.trim() || !form.toEmail.trim()} onClick={() => void saveOrSend(true)}>
                  {busy ? "Sending…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
