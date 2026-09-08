"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";

// ─── Client / contract instructions — the register ────────────────────────
//
// "The client wants a pendant light above the kitchen island." It arrives by
// email or on a form; here it gets a number, the instruction in words, who
// issued it, where it applies, the trades it touches and the document itself
// (a PDF's text is extracted so the register is searchable). From then on the
// assistant treats it as amending the drawings (search_directives), and every
// generated QA check for those trades puts it FIRST: "cable in for the
// additional pendant, as per CI-003" on the electrical check, "ceiling nog for
// the pendant, as per CI-003" on the pre-line. Lives on the RFIs tab as its
// own area (RFIs | Correspondence | Instructions).

type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Ci = {
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
  createdByName: string | null;
  createdAt: string;
};
export type CiPrefill = { title?: string; body?: string; location?: string; issuedByName?: string };

const ISSUERS: [string, string][] = [["client", "Client"], ["architect", "Architect"], ["engineer", "Engineer"], ["other", "Other"]];
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" }) : "-");
const EMPTY = { title: "", body: "", issuedBy: "client", issuedByName: "", dateIssued: new Date().toISOString().slice(0, 10), location: "", trades: [] as string[], amends: "", cost: "" };

export function InstructionsPanel({
  apiFetch,
  projectId,
  projName,
  categories,
  prefill,
  onPrefillUsed,
}: {
  apiFetch: ApiFetch;
  projectId: string;
  projName: string;
  categories: string[];
  prefill?: CiPrefill | null;
  onPrefillUsed?: () => void;
}) {
  const [list, setList] = useState<Ci[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"open" | "all" | "done">("open");
  const [open, setOpen] = useState<Ci | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const load = async () => {
    try {
      const r = await apiFetch("/api/instructions");
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
  // A CI raised from a piece of correspondence arrives prefilled.
  useEffect(() => {
    if (!prefill) return;
    setForm({ ...EMPTY, title: prefill.title ?? "", body: prefill.body ?? "", location: prefill.location ?? "", issuedByName: prefill.issuedByName ?? "" });
    setEditId(null);
    setFormOpen(true);
    onPrefillUsed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const openById = async (id: string) => {
    setErr(null);
    try {
      const r = await apiFetch(`/api/instructions?id=${encodeURIComponent(id)}`);
      const d = await r.json();
      if (r.ok && d.item) setOpen(d.item);
      else setErr(d.error || "Couldn't open that.");
    } catch {
      setErr("Couldn't open that.");
    }
  };
  const patch = async (id: string, payload: Record<string, unknown>) => {
    const r = await apiFetch("/api/instructions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...payload }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "That didn't work just now.");
    return d.item as Ci;
  };
  const uploadDoc = async (id: string, file: File) => {
    const res = await upload(`${projectId}/instructions/${id}/${file.name}`, file, {
      access: "private",
      handleUploadUrl: "/api/upload/token",
      clientPayload: JSON.stringify({ projectId }),
      contentType: file.type || "application/octet-stream",
    });
    return patch(id, { action: "attach", path: res.pathname, filename: file.name });
  };
  const payload = () => ({
    title: form.title,
    body: form.body,
    issuedBy: form.issuedBy,
    issuedByName: form.issuedByName,
    dateIssued: form.dateIssued ? new Date(form.dateIssued + "T12:00:00").toISOString() : "",
    location: form.location,
    trades: form.trades,
    amendsDrawings: form.amends,
    cost: form.cost,
  });
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      if (!form.title.trim()) throw new Error("Give the instruction a title.");
      let item: Ci;
      if (editId) item = await patch(editId, { action: "update", ...payload() });
      else {
        const r = await apiFetch("/api/instructions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
        const d = await r.json();
        if (!r.ok || !d.item) throw new Error(d.error || "Couldn't save it.");
        item = d.item;
      }
      if (pendingFile) {
        setUploading(true);
        try {
          item = await uploadDoc(item.id, pendingFile);
        } finally {
          setUploading(false);
        }
      }
      setFormOpen(false);
      setEditId(null);
      setForm(EMPTY);
      setPendingFile(null);
      setOpen(item);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save it.");
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (id: string, status: "open" | "done" | "void") => {
    setBusy(true);
    setErr(null);
    try {
      const item = await patch(id, { action: "status", status });
      setOpen(item);
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't work just now.");
    } finally {
      setBusy(false);
    }
  };
  const startEdit = (c: Ci) => {
    setForm({
      title: c.title,
      body: c.body ?? c.directs ?? "",
      issuedBy: c.issuedBy ?? "client",
      issuedByName: c.issuedByName ?? "",
      dateIssued: c.dateIssued ? c.dateIssued.slice(0, 10) : "",
      location: c.location ?? "",
      trades: c.trades,
      amends: c.amendsDrawings.map((a) => a.doc).join(", "),
      cost: c.cost ?? "",
    });
    setEditId(c.id);
    setPendingFile(null);
    setFormOpen(true);
  };
  const attachNow = async (id: string, file: File) => {
    setUploading(true);
    setErr(null);
    try {
      setOpen(await uploadDoc(id, file));
      void load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "That didn't upload.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const shown = list.filter((c) => (filter === "open" ? c.status === "open" : filter === "done" ? c.status === "done" : c.status !== "void"));
  const openCount = list.filter((c) => c.status === "open").length;

  const formSheet = formOpen && (
    <div className="scrim" onClick={() => { if (!busy && !uploading) { setFormOpen(false); setEditId(null); } }}>
      <div className="sheet" style={{ maxWidth: 600, maxHeight: "90vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="sh-top">
          <div className="ti"><b>{editId ? "Edit instruction" : "New instruction"}</b><small>{projName}</small></div>
          {!busy && !uploading && <button className="sh-x" onClick={() => { setFormOpen(false); setEditId(null); }}>✕</button>}
        </div>
        <div className="form-body">
          <div className="fld" style={{ marginBottom: 12 }}>
            <label className="ev-lbl">What is instructed (title)</label>
            <input className="ev-in" value={form.title} placeholder="e.g. Pendant light over the kitchen island, Unit 4" onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <label className="ev-lbl">The instruction, in words</label>
          <textarea className="ev-in" rows={5} style={{ fontSize: 15, lineHeight: 1.5 }} value={form.body} placeholder="What changes and where. e.g. Client instructs one additional pendant light centred over the kitchen island in Unit 4; switched with the existing island downlights. Cable, ceiling nog and point required." onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
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
          <label className="ev-lbl" style={{ marginTop: 14 }}>Trades this touches <span className="opt">· every generated check for these trades starts with this instruction</span></label>
          <div className="rf-filters" style={{ marginBottom: 0 }}>
            {categories.map((c) => (
              <button key={c} type="button" className={"rf-f" + (form.trades.includes(c) ? " act" : "")} onClick={() => setForm((f) => ({ ...f, trades: f.trades.includes(c) ? f.trades.filter((x) => x !== c) : [...f.trades, c] }))}>
                {c}
              </button>
            ))}
          </div>
          <label className="ev-lbl" style={{ marginTop: 14 }}>The client&apos;s document <span className="opt">· PDF or a photo of the letter; a PDF&apos;s text is read into the register</span></label>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => setPendingFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="co-drop" disabled={busy || uploading} onClick={() => fileRef.current?.click()}>
            {pendingFile ? `📎 ${pendingFile.name} - attaches on save` : "📎 Attach the instruction document"}
          </button>
          {err && <div className="ev-err">{err}</div>}
          <div className="form-actions">
            <button className="lg-btn" style={{ height: 46, margin: 0, width: "auto", padding: "0 18px" }} disabled={busy || uploading} onClick={() => { setFormOpen(false); setEditId(null); }}>Cancel</button>
            <button className="lg-btn primary" style={{ height: 46, margin: 0, flex: 1 }} disabled={busy || uploading || !form.title.trim()} onClick={() => void save()}>
              {busy || uploading ? "Saving…" : editId ? "Save changes" : "Raise the instruction"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (open) {
    const c = open;
    return (
      <>
        <button className="rf-back" onClick={() => { setOpen(null); void load(); }}>‹ Back to the register</button>
        <div className="rf-dhead">
          <span className="no">{c.label}</span>
          <span className="subj">{c.title}</span>
          <span className={"rf-pill " + (c.status === "open" ? "open" : c.status === "done" ? "answered" : "void")}>{c.status}</span>
          {c.issuedBy && <span className="rf-pill us">{ISSUERS.find(([v]) => v === c.issuedBy)?.[1] ?? c.issuedBy}</span>}
          <span className="meta">{c.dateIssued ? `Issued ${fmt(c.dateIssued)}` : `Raised ${fmt(c.createdAt)}`}</span>
        </div>
        {err && <div className="ev-err" style={{ marginBottom: 12 }}>{err}</div>}
        <div className="rf-cols">
          <div className="rf-thread">
            <div className="rf-card">
              <div className="k">The instruction{c.issuedByName ? ` · ${c.issuedByName}` : ""}</div>
              <div className="rf-q">{c.directs ?? "No wording on record - edit the instruction to add it."}</div>
              {c.file && (
                <div className="co-att" style={{ marginTop: 12 }}>
                  <span>📄</span>
                  <a href={`/api/instructions/file?id=${encodeURIComponent(c.id)}`} target="_blank" rel="noopener noreferrer">{c.fileName ?? "The document"}</a>
                  {c.fileText ? <small>text read in</small> : <small>no text (image)</small>}
                </div>
              )}
              {c.fileText && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12.5, fontWeight: 700, color: "var(--brand-d)", cursor: "pointer" }}>What the document says</summary>
                  <div className="rf-prop" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{c.fileText.slice(0, 6000)}</div>
                </details>
              )}
            </div>
            <div className="rf-card">
              <div className="k">Where it shows up</div>
              <p className="page-sub" style={{ margin: 0 }}>
                The assistant treats {c.label} as amending the drawings it touches. {c.trades.length ? `Every QA check generated for ${c.trades.join(", ")} on this site starts with this instruction as item one, phrased for that stage.` : "Tag the trades it touches (Edit) and every QA check generated for them will start with this instruction as item one."}
                {c.status !== "open" ? " It is no longer open, so it no longer goes on new checks." : ""}
              </p>
            </div>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachNow(c.id, f); }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={busy || uploading} onClick={() => startEdit(c)}>Edit</button>
              <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={busy || uploading} onClick={() => fileRef.current?.click()}>{uploading ? "Uploading…" : c.file ? "Replace document" : "📎 Attach document"}</button>
              {c.status === "open" ? (
                <button className="lg-btn primary" style={{ height: 40, margin: 0, width: "auto", padding: "0 16px", fontSize: 13, marginLeft: "auto" }} disabled={busy} onClick={() => void setStatus(c.id, "done")}>Mark done</button>
              ) : (
                <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13, marginLeft: "auto" }} disabled={busy} onClick={() => void setStatus(c.id, "open")}>Reopen</button>
              )}
              {c.status !== "void" && <button className="lg-btn" style={{ height: 40, margin: 0, width: "auto", padding: "0 14px", fontSize: 13 }} disabled={busy} onClick={() => { if (window.confirm(`Void ${c.label}? It stays on record but no longer counts.`)) void setStatus(c.id, "void"); }}>Void</button>}
            </div>
          </div>
          <div className="rf-rail">
            <div className="rf-card">
              <div className="k">Details</div>
              <div className="rf-kv"><span className="k2">Issued by</span><span className="v">{[ISSUERS.find(([v]) => v === c.issuedBy)?.[1], c.issuedByName].filter(Boolean).join(" · ") || "-"}</span></div>
              <div className="rf-kv"><span className="k2">Date</span><span className="v">{fmt(c.dateIssued ?? c.createdAt)}</span></div>
              <div className="rf-kv"><span className="k2">Location</span><span className="v">{c.location ?? "-"}</span></div>
              <div className="rf-kv"><span className="k2">Trades</span><span className="v" style={{ fontWeight: 600 }}>{c.trades.length ? c.trades.join(", ") : "-"}</span></div>
              <div className="rf-kv"><span className="k2">Amends</span><span className="v">{c.amendsDrawings.length ? c.amendsDrawings.map((a) => a.doc).join(", ") : "-"}</span></div>
              <div className="rf-kv"><span className="k2">Cost</span><span className="v">{c.cost ?? "-"}</span></div>
              {c.sourceRfiId && <div className="rf-kv"><span className="k2">From</span><span className="v">an answered RFI</span></div>}
              <div className="rf-kv"><span className="k2">Raised by</span><span className="v">{c.createdByName ?? "-"}</span></div>
            </div>
          </div>
        </div>
        {formSheet}
      </>
    );
  }

  return (
    <>
      <div className="rf-head">
        <div className="page-h" style={{ margin: 0 }}>Instructions</div>
        <button className="rf-new" onClick={() => { setErr(null); setForm(EMPTY); setEditId(null); setPendingFile(null); setFormOpen(true); }}>＋ New instruction</button>
      </div>
      {err && !formOpen && <div className="ev-err" style={{ marginBottom: 12 }}>{err}</div>}
      <div className="rf-strip">
        <div className="rf-tile"><b>{openCount}</b><span>open</span><small>go first on new checks</small></div>
        <div className="rf-tile"><b>{list.filter((c) => c.status === "done").length}</b><span>done</span><small>built and closed</small></div>
        <div className="rf-tile"><b>{list.filter((c) => c.file).length}</b><span>with the document</span><small>client&apos;s own words on file</small></div>
      </div>
      <div className="rf-filters">
        {(["open", "all", "done"] as const).map((f) => (
          <button key={f} className={"rf-f" + (filter === f ? " act" : "")} onClick={() => setFilter(f)}>{f === "open" ? "Open" : f === "all" ? "All" : "Done"}</button>
        ))}
      </div>
      <div className="rf-reg">
        {!loaded ? (
          <div className="page-sub" style={{ padding: 16 }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: "26px 20px", textAlign: "center" }}>
            <b style={{ fontSize: 15, color: "var(--navy)" }}>{list.length === 0 ? `No instructions on ${projName} yet` : "Nothing in this view"}</b>
            {list.length === 0 && (
              <p className="page-sub" style={{ margin: "8px auto 14px", maxWidth: 480 }}>
                A client or contract instruction changes what the drawings say. Raise it here with the document, tag the trades it touches, and every QA check generated for those trades starts with it - so the pendant light the client asked for is the first thing the electrician and the pre-line walk check.
              </p>
            )}
            {list.length === 0 && <button className="rf-new" style={{ margin: 0 }} onClick={() => { setForm(EMPTY); setEditId(null); setFormOpen(true); }}>＋ Raise the first one</button>}
          </div>
        ) : (
          <table>
            <thead><tr><th>No.</th><th>Instruction</th><th>From</th><th>Trades</th><th>Where</th><th>Status</th><th>Date</th><th style={{ textAlign: "right" }}>Doc</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} onClick={() => void openById(c.id)}>
                  <td className="num">{c.label}</td>
                  <td className="subj">{c.title}</td>
                  <td>{[ISSUERS.find(([v]) => v === c.issuedBy)?.[1], c.issuedByName].filter(Boolean).join(" · ") || "-"}</td>
                  <td>{c.trades.length ? c.trades.join(", ") : "-"}</td>
                  <td>{c.location ?? "-"}</td>
                  <td><span className={"rf-pill " + (c.status === "open" ? "open" : c.status === "done" ? "answered" : "void")}>{c.status}</span></td>
                  <td className="due">{fmt(c.dateIssued ?? c.createdAt)}</td>
                  <td className="days">{c.file ? "📄" : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {formSheet}
    </>
  );
}
