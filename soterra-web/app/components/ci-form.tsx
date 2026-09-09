"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

// ─── Client / contract instructions, INSIDE the record they came from ────────
//
// Adam 2026-09-10: "the way i imagined this instruction is as part of a RFI.
// they usually send it there and that's the end of the RFI and it can be
// closed." So there is no Instructions register any more. A CI is raised from
// an answered RFI ("This changes the works") or from a piece of correspondence
// ("Raise a CI from this") and then lives as a block inside that record.
// Underneath nothing changed: the assistant treats it as amending the drawings
// (search_directives) and every QA check generated for the trades it touches
// puts it at item one (lib/checklist.ts).
//
// Two pieces, both driven by the caller's save function so the RFI door
// (PATCH /api/rfis create_ci) and the correspondence door (POST
// /api/instructions {sourceCorrId}) share one form:
//   <CiForm>  the modal: title, wording, who issued it, where, trades, document
//   <CiCard>  the block on the record: the instruction + Edit / document / done / void

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type Ci = {
  id: string;
  number: number;
  label: string;
  title: string;
  body: string | null;
  directs: string | null;
  issuedBy: string | null;
  issuedByName: string | null;
  dateIssued: string | null;
  location: string | null;
  trades: string[];
  amendsDrawings: { doc: string; fromRev?: string; toRev?: string }[];
  cost: string | null;
  status: string;
  file: string | null;
  fileName: string | null;
  fileText: string | null;
  sourceRfiId: string | null;
  sourceCorrId?: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type CiFormValues = {
  title: string;
  body: string;
  issuedBy: string;
  issuedByName: string;
  dateIssued: string; // yyyy-mm-dd
  location: string;
  trades: string[];
  amends: string;
  cost: string;
};
/** A PDF already on the record (the RFI's files, a thread line) the CI can use as its document. */
export type CiDocOption = { path: string; filename: string };

export const ISSUERS: [string, string][] = [["client", "Client"], ["architect", "Architect"], ["engineer", "Engineer"], ["other", "Other"]];
export const issuerLabel = (v: string | null | undefined) => ISSUERS.find(([k]) => k === v)?.[1] ?? v ?? "";
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "-");
const today = () => new Date().toISOString().slice(0, 10);

/** Guess who issued it from the firm's name ("Aria Architects" → architect). */
export function guessIssuer(company: string | null | undefined): string {
  const s = (company ?? "").toLowerCase();
  if (/architect|design/.test(s)) return "architect";
  if (/engineer|structural|fire|mechanical|electrical|hydraulic|civil|geotech|acoustic|facade|façade/.test(s)) return "engineer";
  return "other";
}

/** The API payload for one set of form values. */
export function ciPayload(v: CiFormValues) {
  return {
    title: v.title,
    body: v.body,
    issuedBy: v.issuedBy,
    issuedByName: v.issuedByName,
    dateIssued: v.dateIssued ? new Date(v.dateIssued + "T12:00:00").toISOString() : "",
    location: v.location,
    trades: v.trades,
    amendsDrawings: v.amends,
    cost: v.cost,
  };
}

export function CiForm({
  projName,
  categories,
  initial,
  docOptions,
  editing,
  apiFetch,
  projectId,
  onSave,
  onSaved,
  onCancel,
}: {
  projName: string;
  categories: string[];
  initial?: Partial<CiFormValues>;
  /** PDFs already on the record; the first is preselected as the document. */
  docOptions?: CiDocOption[];
  editing?: boolean;
  apiFetch: ApiFetch;
  projectId: string;
  /** Creates or updates the CI through whichever door the caller owns; returns the saved item. */
  onSave: (values: CiFormValues, doc: CiDocOption | null) => Promise<Ci>;
  onSaved: (ci: Ci) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CiFormValues>({
    title: "",
    body: "",
    issuedBy: "other",
    issuedByName: "",
    dateIssued: today(),
    location: "",
    trades: [],
    amends: "",
    cost: "",
    ...initial,
  });
  const [docPath, setDocPath] = useState<string>(docOptions?.[0]?.path ?? "");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!form.title.trim()) throw new Error("Give the instruction a title.");
      const doc = pendingFile ? null : (docOptions ?? []).find((d) => d.path === docPath) ?? null;
      let item = await onSave(form, doc);
      if (pendingFile) {
        // The document goes straight to Blob under the CI's own folder, then the
        // register reads the PDF's text (lib/instructions.attachInstructionFile).
        const res = await upload(`${projectId}/instructions/${item.id}/${pendingFile.name}`, pendingFile, {
          access: "private",
          handleUploadUrl: "/api/upload/token",
          clientPayload: JSON.stringify({ projectId }),
          contentType: pendingFile.type || "application/octet-stream",
        });
        const r = await apiFetch("/api/instructions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: "attach", path: res.pathname, filename: pendingFile.name }) });
        const d = await r.json();
        if (r.ok && d.item) item = d.item as Ci;
      }
      onSaved(item);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim" onClick={() => { if (!busy) onCancel(); }}>
      <div className="sheet" style={{ maxWidth: 600, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="sh-top">
          <div className="ti"><b>{editing ? "Edit the instruction" : "Raise the instruction"}</b><small>{projName}</small></div>
          {!busy && <button className="sh-x" onClick={onCancel}>✕</button>}
        </div>
        <div className="form-body">
          <div className="fld" style={{ marginBottom: 12 }}>
            <label className="ev-lbl">What is instructed (title)</label>
            <input className="ev-in" value={form.title} placeholder="e.g. Pendant light over the kitchen island, Unit 4" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <label className="ev-lbl">The instruction, in words</label>
          <textarea className="ev-in" rows={5} style={{ fontSize: 15, lineHeight: 1.5 }} value={form.body} placeholder="What changes and where, in the words it was given." onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="ev-lbl">Issued by</label>
              <select className="ev-in" value={form.issuedBy} onChange={(e) => setForm((f) => ({ ...f, issuedBy: e.target.value }))}>
                {ISSUERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div style={{ flex: 1.4 }}>
              <label className="ev-lbl">Name / firm</label>
              <input className="ev-in" value={form.issuedByName} placeholder="J. Client · Kauri Developments" onChange={(e) => setForm((f) => ({ ...f, issuedByName: e.target.value }))} />
            </div>
            <div style={{ flex: 0.9 }}>
              <label className="ev-lbl">Date</label>
              <input className="ev-in" type="date" value={form.dateIssued} onChange={(e) => setForm((f) => ({ ...f, dateIssued: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="ev-lbl">Where it applies</label>
              <input className="ev-in" value={form.location} placeholder="Unit 4 kitchen" onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="ev-lbl">Amends drawings <span className="opt">· optional</span></label>
              <input className="ev-in" value={form.amends} placeholder="E-201, A-410" onChange={(e) => setForm((f) => ({ ...f, amends: e.target.value }))} />
            </div>
            <div style={{ flex: 0.8 }}>
              <label className="ev-lbl">Cost <span className="opt">· optional</span></label>
              <input className="ev-in" value={form.cost} placeholder="~$650" onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))} />
            </div>
          </div>
          <label className="ev-lbl" style={{ marginTop: 14 }}>Trades this touches <span className="opt">· every QA check generated for these trades starts with this instruction</span></label>
          <div className="rf-filters" style={{ marginBottom: 0 }}>
            {categories.map((c) => (
              <button key={c} type="button" className={"rf-f" + (form.trades.includes(c) ? " act" : "")} onClick={() => setForm((f) => ({ ...f, trades: f.trades.includes(c) ? f.trades.filter((x) => x !== c) : [...f.trades, c] }))}>
                {c}
              </button>
            ))}
          </div>
          {!editing && (
            <>
              <label className="ev-lbl" style={{ marginTop: 14 }}>The document <span className="opt">· a PDF&apos;s text is read into the register</span></label>
              {(docOptions ?? []).length > 0 && !pendingFile && (
                <select className="ev-in" value={docPath} onChange={(e) => setDocPath(e.target.value)}>
                  {(docOptions ?? []).map((d) => <option key={d.path} value={d.path}>{d.filename}</option>)}
                  <option value="">No document from the thread</option>
                </select>
              )}
              <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
              <button type="button" className="co-drop" disabled={busy} onClick={() => fileRef.current?.click()}>
                {pendingFile ? `📎 ${pendingFile.name} - attaches on save` : (docOptions ?? []).length ? "📎 Or upload a different document" : "📎 Attach the instruction document"}
              </button>
            </>
          )}
          {err && <div className="ev-err">{err}</div>}
          <div className="form-actions">
            <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 18px" }} disabled={busy} onClick={onCancel}>Cancel</button>
            <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={busy || !form.title.trim()} onClick={() => void save()}>
              {busy ? "Saving…" : editing ? "Save changes" : "Raise the instruction"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The CI as a block inside its RFI or piece of correspondence. */
export function CiCard({
  ci,
  apiFetch,
  projectId,
  projName,
  categories,
  onChanged,
  standalone,
}: {
  ci: Ci;
  apiFetch: ApiFetch;
  projectId: string;
  projName: string;
  categories: string[];
  onChanged: (ci: Ci) => void;
  /** In the register (not under an RFI): label it by its kind, not "raised from this". */
  standalone?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (payload: Record<string, unknown>): Promise<Ci> => {
    const r = await apiFetch("/api/instructions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: ci.id, ...payload }) });
    const d = await r.json();
    if (!r.ok || !d.item) throw new Error(d.error || "That didn't work just now.");
    return d.item as Ci;
  };
  const setStatus = async (status: "open" | "done" | "void") => {
    if (status === "void" && !window.confirm(`Void ${ci.label}? It stays on record but no longer goes on new checks.`)) return;
    setBusy(true);
    setErr(null);
    try {
      onChanged(await patch({ action: "status", status }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work just now.");
    } finally {
      setBusy(false);
    }
  };
  const attachNow = async (file: File) => {
    setUploading(true);
    setErr(null);
    try {
      const res = await upload(`${projectId}/instructions/${ci.id}/${file.name}`, file, {
        access: "private",
        handleUploadUrl: "/api/upload/token",
        clientPayload: JSON.stringify({ projectId }),
        contentType: file.type || "application/octet-stream",
      });
      onChanged(await patch({ action: "attach", path: res.pathname, filename: file.name }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const btn = { height: 36, margin: 0, width: "auto", padding: "0 13px", fontSize: 12.5 } as const;

  return (
    <div className="rf-card" style={{ borderColor: "rgba(139,92,246,.45)" }}>
      <div className="k" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>{!standalone ? "Instruction raised from this" : ci.issuedBy === "client" ? "Client instruction" : ci.issuedBy === "architect" ? "Architect's instruction" : ci.issuedBy === "engineer" ? "Engineer's instruction" : "Contract instruction"}</span>
        <span className={"rf-pill " + (ci.status === "open" ? "open" : ci.status === "done" ? "answered" : "void")}>{ci.status}</span>
        <span style={{ marginLeft: "auto", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>{ci.dateIssued ? `Issued ${fmt(ci.dateIssued)}` : `Raised ${fmt(ci.createdAt)}`}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <b style={{ fontSize: 15, color: "var(--navy)" }}>{ci.label}</b>
        <span style={{ fontSize: 14.5, fontWeight: 600, color: "var(--navy)" }}>{ci.title}</span>
      </div>
      <div className="rf-q">{ci.directs ?? "No wording on record - edit the instruction to add it."}</div>
      <div className="rf-refs" style={{ marginTop: 8 }}>
        {ci.trades.map((t) => <span key={t} className="rf-rchip code">{t}</span>)}
        {ci.location && <span className="rf-rchip">📍 {ci.location}</span>}
        {(ci.issuedBy || ci.issuedByName) && <span className="rf-rchip">{[issuerLabel(ci.issuedBy), ci.issuedByName].filter(Boolean).join(" · ")}</span>}
        {ci.amendsDrawings.length > 0 && <span className="rf-rchip">amends {ci.amendsDrawings.map((a) => a.doc).join(", ")}</span>}
        {ci.cost && <span className="rf-rchip">{ci.cost}</span>}
      </div>
      {ci.file && (
        <div className="co-att" style={{ marginTop: 10 }}>
          <span>📄</span>
          <a href={`/api/instructions/file?id=${encodeURIComponent(ci.id)}&project=${encodeURIComponent(projectId)}`} target="_blank" rel="noopener noreferrer">{ci.fileName ?? "The document"}</a>
          <small>{ci.fileText ? "text read in" : "no text (image)"}</small>
        </div>
      )}
      {ci.status === "open" && !ci.trades.length && (
        <p className="page-sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>Tag the trades it touches (Edit) so it lands on their QA checks.</p>
      )}
      {err && <div className="ev-err" style={{ marginTop: 8 }}>{err}</div>}
      <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachNow(f); }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button className="lg-btn" style={btn} disabled={busy || uploading} onClick={() => setEditOpen(true)}>Edit</button>
        <button className="lg-btn" style={btn} disabled={busy || uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : ci.file ? "Replace document" : "Attach document"}</button>
        {ci.status === "open" ? (
          <button className="lg-btn primary" style={{ ...btn, marginLeft: "auto" }} disabled={busy} onClick={() => void setStatus("done")}>Mark done</button>
        ) : (
          <button className="lg-btn" style={{ ...btn, marginLeft: "auto" }} disabled={busy} onClick={() => void setStatus("open")}>Reopen</button>
        )}
        {ci.status !== "void" && <button className="lg-btn" style={btn} disabled={busy} onClick={() => void setStatus("void")}>Void</button>}
      </div>
      {editOpen && (
        <CiForm
          projName={projName}
          categories={categories}
          editing
          apiFetch={apiFetch}
          projectId={projectId}
          initial={{
            title: ci.title,
            body: ci.body ?? ci.directs ?? "",
            issuedBy: ci.issuedBy ?? "other",
            issuedByName: ci.issuedByName ?? "",
            dateIssued: ci.dateIssued ? ci.dateIssued.slice(0, 10) : today(),
            location: ci.location ?? "",
            trades: ci.trades,
            amends: ci.amendsDrawings.map((a) => a.doc).join(", "),
            cost: ci.cost ?? "",
          }}
          onSave={(values) => patch({ action: "update", ...ciPayload(values) })}
          onSaved={(c) => { setEditOpen(false); onChanged(c); }}
          onCancel={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
