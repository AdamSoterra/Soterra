"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { useClerk } from "@clerk/nextjs";

// ─── The external views: what a consultant or a sub sees ────────────────
//
// One set of components, two doors. The emailed link pages (/answer, /fix,
// /signoff, /correspondence) and the portal (/portal) render the SAME views;
// only the data source and the action endpoint differ, so a consultant sees
// an identical page whether they came from the email or from their list.
//
// Every view owns its own form state and takes an `act` callback that does
// the network call and returns { ok, data?, error? }. The .ans- CSS family
// (globals.css) is shared with the original token pages.

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";

export const fmtBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)} MB`);

/** Downscale + re-encode a phone photo to JPEG in the browser (4-10 MB raw
 *  → well under the route's body cap). 1600px is plenty to prove a fix. */
export async function compress(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement("img");
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("bad image"));
      img.src = url;
    });
    const max = 1600;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type Act<T> = Promise<{ ok: boolean; data?: T; error?: string }>;

// ─── chrome ────────────────────────────────────────────────────────────────

export function Shell({ company, project, children, foot, top }: { company?: string; project?: string; children: ReactNode; foot?: ReactNode; top?: ReactNode }) {
  return (
    <div className="ans">
      <div className="ans-top">
        <Image src="/logo-mark.png" alt="" width={22} height={30} />
        <span className="ans-brand">SOTERRA</span>
        {top}
        {(company || project) && (
          <span className="ans-proj">
            {[company, project].filter(Boolean).join(" · ")}
          </span>
        )}
      </div>
      {children}
      <div className="ans-foot">{foot ?? <>Sent with <b>Soterra</b> · soterra.co.nz</>}</div>
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="ans">
      <div className="ans-card ans-center">Opening {what}…</div>
    </div>
  );
}

export function ErrorCard({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="ans">
      <div className="ans-card ans-center">
        <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
        <h1>Couldn&apos;t load {what}</h1>
        <p>Probably a patchy connection. Your link is still good.</p>
        <div className="ans-actions" style={{ justifyContent: "center", marginTop: 14 }}>
          <button className="ans-btn primary" onClick={onRetry}>Try again</button>
        </div>
      </div>
    </div>
  );
}

export function InvalidCard({ hint }: { hint: string }) {
  return (
    <div className="ans">
      <div className="ans-card ans-center">
        <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
        <h1>This link is no longer valid</h1>
        <p>{hint}</p>
      </div>
    </div>
  );
}

/** The sign-in gate. `login` = no account signed in; `mismatch` = signed in
 *  on an address the item was not sent to. Sign-in/up open Clerk's modal
 *  and return to this very URL. */
export function LoginGate({ reason, what }: { reason: "login" | "mismatch"; what: string }) {
  const clerk = useClerk();
  const here = typeof window !== "undefined" ? window.location.href : "/";
  return (
    <div className="ans">
      <div className="ans-card ans-center">
        <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
        {reason === "login" ? (
          <>
            <h1>Sign in to open {what}</h1>
            <p>
              This link is private. Sign in with the email address it was sent to, or set up a free Soterra account on
              that address - it takes a minute and you will see everything sent to you, on every project.
            </p>
            <div className="ans-actions" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="ans-btn primary" onClick={() => clerk.openSignIn({ forceRedirectUrl: here })}>Sign in</button>
              <button className="ans-btn" onClick={() => clerk.openSignUp({ forceRedirectUrl: here })}>Create an account</button>
            </div>
          </>
        ) : (
          <>
            <h1>This link was sent to a different address</h1>
            <p>
              You are signed in on an email address this item was not sent to. Sign out and sign in with the address the
              email arrived at.
            </p>
            <div className="ans-actions" style={{ justifyContent: "center", marginTop: 16 }}>
              {/* No redirect: the page watches the signed-in state and re-checks the link itself. */}
              <button className="ans-btn primary" onClick={() => void clerk.signOut()}>Sign out</button>
            </div>
          </>
        )}
        <p className="ans-fine" style={{ marginTop: 16 }}>
          Trouble getting in? Reply to the original email instead and the builder will log your response.
        </p>
      </div>
    </div>
  );
}

// ─── RFI thread (the consultant's answer page) ─────────────────────────────

export type RfiThreadMsg = { type: string; authorSide: string; authorName: string | null; body: string; via?: string | null; attachments?: CorrFile[]; createdAt: string };
export type RfiThread = {
  company: string;
  project: string;
  rfi: {
    id?: string;
    label: string;
    revision: number;
    subject: string;
    status: string;
    discipline: string | null;
    priority: string;
    location: string | null;
    question: string;
    proposedSolution: string | null;
    codeRefs: string[];
    consultantName: string | null;
    consultantCompany: string | null;
    dateRaised: string | null;
    dateRequiredBy: string | null;
    dateAnswered: string | null;
    /** The RFI's own files (drawings, photos) - served through the caller's fileHref. */
    attachments?: CorrFile[];
    /** Where this side's files go; the upload doors sign only this folder. */
    uploadPrefix?: string;
  };
  messages: RfiThreadMsg[];
  sheets: { doc: string; page: number }[];
  canAnswer: boolean;
  canComment: boolean;
};

export function RfiThreadView({
  thread,
  sheetSrc,
  fileHref,
  uploadFile,
  act,
  defaultName,
  hideFoot,
}: {
  thread: RfiThread;
  sheetSrc: (doc: string, page: number) => string;
  /** Link for one of the RFI's files (the door decides: token or portal). */
  fileHref?: (path: string) => string;
  /** Direct-to-Blob upload for the consultant's own files; null/absent = no attachments on this door. */
  uploadFile?: ((file: File) => Promise<{ file?: CorrFile; error?: string }>) | null;
  act: (kind: "answer" | "comment", text: string, name: string, files: CorrFile[]) => Act<RfiThread>;
  defaultName?: string;
  hideFoot?: boolean;
}) {
  const [name, setName] = useState(defaultName || thread.rfi.consultantName || "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<CorrFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justAnswered, setJustAnswered] = useState(false);
  const [t, setT] = useState(thread);
  const fileRef = useRef<HTMLInputElement>(null);
  const r = t.rfi;
  const firstQ = t.messages.findIndex((m) => m.type === "question");
  const convo = t.messages.filter((_, i) => i !== firstQ);
  const overdue = r.status === "open" && r.dateRequiredBy && new Date() > new Date(r.dateRequiredBy);
  const href = fileHref ?? (() => "#");

  const pick = async (list: FileList | null) => {
    if (!list || !uploadFile) return;
    setErr(null);
    setUploading(true);
    try {
      for (const f of Array.from(list).slice(0, 10)) {
        const res = await uploadFile(f);
        if (res.file) setFiles((xs) => [...xs, res.file!]);
        else setErr(res.error ?? `${f.name} didn't upload.`);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const submit = async (kind: "answer" | "comment") => {
    // The official answer needs words; a comment can be just a file.
    if (busy || uploading) return;
    if (!text.trim() && (kind === "answer" || !files.length)) return;
    setBusy(true);
    setErr(null);
    const res = await act(kind, text, name, files);
    if (!res.ok) setErr(res.error ?? "That didn't go through. Try again.");
    else {
      if (res.data) setT(res.data);
      setText("");
      setFiles([]);
      if (kind === "answer") setJustAnswered(true);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">{r.label}</span>
          <span className={"ans-pill " + r.status}>{r.status}</span>
          {r.discipline && <span className="ans-pill dim">{r.discipline}</span>}
          {r.priority !== "normal" && <span className="ans-pill warn">{r.priority}</span>}
        </div>
        <h1 className="ans-subj">{r.subject}</h1>
        <div className="ans-meta">
          {r.location && <span>📍 {r.location}</span>}
          {r.dateRaised && <span>Raised {fmtDate(r.dateRaised)}</span>}
          {r.dateRequiredBy && r.status === "open" && (
            <span className={overdue ? "ans-due late" : "ans-due"}>
              {overdue ? "Overdue - was due " : "Response due "}
              {fmtDate(r.dateRequiredBy)}
            </span>
          )}
        </div>
        <div className="ans-klabel">Question</div>
        <div className="ans-q">{r.question}</div>
        {r.proposedSolution && (
          <>
            <div className="ans-klabel">{t.company}&apos;s proposed solution</div>
            <div className="ans-prop">{r.proposedSolution}</div>
          </>
        )}
        {r.codeRefs.length > 0 && (
          <div className="ans-refs">
            {r.codeRefs.map((c, i) => (
              <span className="ans-chip" key={i}>{c}</span>
            ))}
          </div>
        )}
        {t.sheets.map((s, i) => (
          <div className="ans-sheet" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sheetSrc(s.doc, s.page)} alt={`${s.doc} - the pinned detail`} />
            <small>{s.doc} · the pin marks the spot this RFI is about</small>
          </div>
        ))}
        {(r.attachments?.length ?? 0) > 0 && (
          <>
            <div className="ans-klabel">Attachments</div>
            <AttachmentList files={r.attachments ?? []} href={href} />
          </>
        )}
      </div>

      {convo.length > 0 && (
        <div className="ans-card">
          <div className="ans-klabel">Conversation</div>
          {convo.map((m, i) => (
            <div className={"ans-msg " + (m.authorSide === "consultant" ? "them" : "us")} key={i}>
              <div className="ans-msg-k">
                {m.type === "official_answer" ? "✓ Official answer · " : ""}
                {m.authorName ?? (m.authorSide === "consultant" ? "Consultant" : t.company)} · {fmtDate(m.createdAt)}
                {m.via === "email" ? " · by email" : ""}
              </div>
              <div className="ans-msg-b">{m.body}</div>
              <AttachmentList files={m.attachments ?? []} href={href} />
            </div>
          ))}
        </div>
      )}

      {justAnswered && (
        <div className="ans-done">✓ Answer logged against {r.label}. {t.company} has been notified - you&apos;re done.</div>
      )}

      {(t.canAnswer || t.canComment) && (
        <div className="ans-card">
          <div className="ans-klabel">{t.canAnswer ? "Your answer" : "Add to the thread"}</div>
          {!t.canAnswer && r.status === "answered" && !justAnswered && (
            <p className="ans-note">An answer is already logged; {t.company} has the ball. You can still add a note to the thread.</p>
          )}
          <input className="ans-in" placeholder="Your name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <textarea
            className="ans-ta"
            placeholder={t.canAnswer ? "Type the answer here - it goes straight into the RFI register." : "Type your note…"}
            value={text}
            maxLength={20000}
            onChange={(e) => setText(e.target.value)}
          />
          {uploadFile && (
            <>
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => void pick(e.target.files)} />
              {files.length > 0 && <AttachmentList files={files} href={href} />}
              <button className="qa-photo" style={{ marginTop: 9 }} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "📎 Attach a file (a marked-up sketch, a revised detail, a photo)"}
              </button>
            </>
          )}
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            {t.canAnswer && (
              <button className="ans-btn primary" disabled={busy || uploading || !text.trim()} onClick={() => void submit("answer")}>
                {busy ? "Sending…" : "Send as the official answer"}
              </button>
            )}
            <button className="ans-btn" disabled={busy || uploading || (!text.trim() && !files.length)} onClick={() => void submit("comment")}>
              {t.canAnswer ? "Send as a comment only" : busy ? "Sending…" : "Add the note"}
            </button>
          </div>
          {t.canAnswer && (
            <p className="ans-fine">The official answer closes out the question and stops the response clock. A comment is for clarifications - the RFI stays open.</p>
          )}
        </div>
      )}

      {r.status === "closed" && (
        <div className="ans-card ans-center">
          <p>This RFI is closed. Nothing further is needed from you.</p>
        </div>
      )}
      {!hideFoot && null}
    </>
  );
}

// ─── Defect to fix (the sub's page) ────────────────────────────────────────

export type FixData = {
  company: string;
  project: string;
  kind?: string;
  id?: string;
  defect: { title: string; detail: string | null; location: string | null; category: string | null };
  status: string;
  hasFixPhoto: boolean;
  reviewNote?: string | null;
  canSubmit: boolean;
};

export function FixView({
  d,
  uploadPhoto,
  act,
}: {
  d: FixData;
  uploadPhoto: (blob: Blob) => Promise<{ path?: string; error?: string }>;
  act: (note: string, photoPath: string | null) => Act<FixData>;
}) {
  const [data, setData] = useState(d);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickPhoto = async (file: File) => {
    setErr(null);
    setUploading(true);
    try {
      const blob = await compress(file);
      const r = await uploadPhoto(blob);
      if (!r.path) {
        setErr(r.error ?? "That photo didn't upload. Try again.");
        return;
      }
      setPhotoPath(r.path);
      setPreview(URL.createObjectURL(blob));
    } catch {
      setErr("That photo didn't upload. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  };
  const submit = async () => {
    if (busy || uploading) return;
    setBusy(true);
    setErr(null);
    const res = await act(note, photoPath);
    if (!res.ok) setErr(res.error ?? "That didn't go through. Try again.");
    else {
      if (res.data) setData(res.data);
      setDone(true);
    }
    setBusy(false);
  };
  const alreadyIn = !data.canSubmit && !done;

  return (
    <>
      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">Defect to fix</span>
          <span className={"ans-pill " + (data.status === "closed" ? "closed" : data.status === "sent" ? "open" : "answered")}>{data.status}</span>
          {data.defect.category && <span className="ans-pill dim">{data.defect.category}</span>}
          {data.reviewNote && data.status === "sent" && <span className="ans-pill warn">redo</span>}
        </div>
        <h1 className="ans-subj">{data.defect.title}</h1>
        <div className="ans-meta">{data.defect.location && <span>📍 {data.defect.location}</span>}</div>
        {data.defect.detail && (
          <>
            <div className="ans-klabel">What was pulled up</div>
            <div className="ans-q">{data.defect.detail}</div>
          </>
        )}
        {data.reviewNote && data.status === "sent" && (
          <>
            <div className="ans-klabel">Bounced back with this note</div>
            <div className="ans-prop">{data.reviewNote}</div>
          </>
        )}
      </div>

      {done && <div className="ans-done">✓ Marked fixed. {data.company} has been notified - you&apos;re done.</div>}

      {alreadyIn && (
        <div className="ans-card ans-center">
          <p>This item has already been marked fixed. {data.company} has the ball now - nothing more needed from you.</p>
        </div>
      )}

      {data.canSubmit && !done && (
        <div className="ans-card">
          <div className="ans-klabel">Photo of the fix</div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); }} />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qa-thumb" src={preview} alt="The fix" />
          ) : null}
          <button className="qa-photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : preview ? "Retake / choose another" : "📷 Take a photo of the fix"}
          </button>
          <div className="ans-klabel">Anything to add (optional)</div>
          <textarea className="ans-ta" placeholder="e.g. Redone to the detail, penetration fully sealed." value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            <button className="ans-btn primary" disabled={busy || uploading} onClick={() => void submit()}>
              {busy ? "Sending…" : "Mark it fixed"}
            </button>
          </div>
          <p className="ans-fine">This tells {data.company} the fix is done and sends them your photo. They sign it off from their end.</p>
        </div>
      )}
    </>
  );
}

// ─── Sign-off (the consultant's page) ──────────────────────────────────────

export type SignoffData = {
  company: string;
  project: string;
  id?: string;
  defect: { title: string; detail: string | null; location: string | null; category: string | null };
  subLine: string;
  fixNote: string | null;
  hasFixPhoto: boolean;
  status: string;
  canSignoff: boolean;
};

export function SignoffView({
  d,
  photoSrc,
  act,
}: {
  d: SignoffData;
  photoSrc: string;
  act: (decision: "approve" | "reject", note: string) => Act<SignoffData & { approved?: boolean }>;
}) {
  const [data, setData] = useState(d);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);

  const decide = async (decision: "approve" | "reject") => {
    if (busy) return;
    if (decision === "reject" && !note.trim()) {
      setErr("Add a note so the sub knows what to put right.");
      return;
    }
    setBusy(true);
    setErr(null);
    const res = await act(decision, note);
    if (!res.ok) setErr(res.error ?? "That didn't go through. Try again.");
    else {
      if (res.data) setData(res.data);
      setOutcome(decision === "approve" ? "approved" : "rejected");
    }
    setBusy(false);
  };

  return (
    <>
      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">Sign-off</span>
          <span className={"ans-pill " + (data.status === "closed" ? "answered" : data.status === "sent" ? "open" : "dim")}>{data.status}</span>
          {data.defect.category && <span className="ans-pill dim">{data.defect.category}</span>}
        </div>
        <h1 className="ans-subj">{data.defect.title}</h1>
        <div className="ans-meta">{data.defect.location && <span>📍 {data.defect.location}</span>}</div>
        {data.defect.detail && (
          <>
            <div className="ans-klabel">What was pulled up</div>
            <div className="ans-q">{data.defect.detail}</div>
          </>
        )}
        <div className="ans-klabel">{data.subLine} marked it fixed</div>
        {data.fixNote ? <div className="ans-prop">{data.fixNote}</div> : <div className="ans-note">No note left.</div>}
        {data.hasFixPhoto && (
          <div className="ans-sheet">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoSrc} alt="Photo of the fix" />
            <small>Photo of the fix, taken by {data.subLine}</small>
          </div>
        )}
      </div>

      {outcome === "approved" && <div className="ans-done">✓ Signed off. {data.company} has been notified and the item is closed.</div>}
      {outcome === "rejected" && (
        <div className="ans-done" style={{ background: "#FFF7ED", borderColor: "#FDBA74", color: "#B45309" }}>
          ↩ Bounced back to the sub with your note. {data.company} has been notified.
        </div>
      )}

      {data.canSignoff && !outcome && (
        <div className="ans-card">
          <div className="ans-klabel">Your note (required to bounce back)</div>
          <textarea className="ans-ta" placeholder="Optional if you're signing off. If bouncing back, say what still needs doing." value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            <button className="ans-btn primary" disabled={busy} onClick={() => void decide("approve")}>{busy ? "Sending…" : "Sign it off"}</button>
            <button className="ans-btn" disabled={busy} onClick={() => void decide("reject")}>Bounce back</button>
          </div>
          <p className="ans-fine">Signing off closes the item. Bouncing it back sends it to the sub to redo, with your note.</p>
        </div>
      )}

      {!data.canSignoff && !outcome && (
        <div className="ans-card ans-center">
          <p>This item has already been actioned. Nothing further is needed from you.</p>
        </div>
      )}
    </>
  );
}

// ─── Correspondence (notice / instruction / transmittal / letter) ──────────

export type CorrFile = { filename: string; path: string; bytes: number; contentType: string };
export type CorrViewData = {
  company: string;
  project: string;
  item: {
    id: string;
    label: string;
    type: string;
    typeLabel: string;
    subject: string;
    body: string;
    status: string;
    responseRequired: boolean;
    dateDue: string | null;
    dateSent: string | null;
    toName: string | null;
    toCompany: string | null;
    sentByName: string | null;
    attachments: CorrFile[];
    uploadPrefix: string;
  };
  messages: { id: string; authorSide: string; authorName: string | null; via: string | null; body: string; createdAt: string; attachments: CorrFile[] }[];
  canReply: boolean;
};

export function AttachmentList({ files, href }: { files: CorrFile[]; href: (path: string) => string }) {
  if (!files.length) return null;
  return (
    <div className="ans-files">
      {files.map((f) => (
        <a key={f.path} className="ans-file" href={href(f.path)} target="_blank" rel="noopener noreferrer">
          <span className="ans-file-ic">{/\.pdf$/i.test(f.filename) ? "📄" : /\.(jpe?g|png|webp)$/i.test(f.filename) ? "🖼" : "📎"}</span>
          <span className="ans-file-n">{f.filename}</span>
          <span className="ans-file-b">{fmtBytes(f.bytes)}</span>
        </a>
      ))}
    </div>
  );
}

export function CorrespondenceView({
  view,
  fileHref,
  uploadFile,
  act,
  defaultName,
}: {
  view: CorrViewData;
  fileHref: (path: string) => string;
  /** Direct-to-Blob upload for a reply's attachments; null = no attachments on this door. */
  uploadFile: ((file: File) => Promise<{ file?: CorrFile; error?: string }>) | null;
  act: (text: string, name: string, files: CorrFile[]) => Act<CorrViewData>;
  defaultName?: string;
}) {
  const [v, setV] = useState(view);
  const [name, setName] = useState(defaultName || view.item.toName || "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<CorrFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const it = v.item;
  const overdue = it.status === "sent" && it.responseRequired && it.dateDue && new Date() > new Date(it.dateDue);

  const pick = async (list: FileList | null) => {
    if (!list || !uploadFile) return;
    setErr(null);
    setUploading(true);
    try {
      for (const f of Array.from(list).slice(0, 10)) {
        const r = await uploadFile(f);
        if (r.file) setFiles((xs) => [...xs, r.file!]);
        else setErr(r.error ?? `${f.name} didn't upload.`);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const submit = async () => {
    if ((!text.trim() && !files.length) || busy || uploading) return;
    setBusy(true);
    setErr(null);
    const res = await act(text, name, files);
    if (!res.ok) setErr(res.error ?? "That didn't go through. Try again.");
    else {
      if (res.data) setV(res.data);
      setText("");
      setFiles([]);
      setSent(true);
    }
    setBusy(false);
  };

  return (
    <>
      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">{it.label}</span>
          <span className={"ans-pill " + (it.status === "closed" ? "closed" : it.status === "responded" ? "answered" : it.responseRequired ? "open" : "dim")}>
            {it.status === "sent" ? (it.responseRequired ? "response needed" : "for your records") : it.status}
          </span>
          <span className="ans-pill dim">{it.typeLabel}</span>
        </div>
        <h1 className="ans-subj">{it.subject}</h1>
        <div className="ans-meta">
          {it.dateSent && <span>Sent {fmtDate(it.dateSent)}{it.sentByName ? ` by ${it.sentByName}` : ""}</span>}
          {it.responseRequired && it.dateDue && it.status === "sent" && (
            <span className={overdue ? "ans-due late" : "ans-due"}>{overdue ? "Overdue - was due " : "Response due "}{fmtDate(it.dateDue)}</span>
          )}
        </div>
        <div className="ans-klabel">{it.typeLabel}</div>
        <div className="ans-q">{it.body}</div>
        {it.attachments.length > 0 && (
          <>
            <div className="ans-klabel">Attachments</div>
            <AttachmentList files={it.attachments} href={fileHref} />
          </>
        )}
      </div>

      {v.messages.length > 0 && (
        <div className="ans-card">
          <div className="ans-klabel">Conversation</div>
          {v.messages.map((m) => (
            <div className={"ans-msg " + (m.authorSide === "external" ? "them" : "us")} key={m.id}>
              <div className="ans-msg-k">
                {m.authorName ?? (m.authorSide === "external" ? "You" : v.company)} · {fmtDate(m.createdAt)}{m.via === "email" ? " · by email" : ""}
              </div>
              <div className="ans-msg-b">{m.body}</div>
              <AttachmentList files={m.attachments} href={fileHref} />
            </div>
          ))}
        </div>
      )}

      {sent && <div className="ans-done">✓ Sent. {v.company} has been notified.</div>}

      {v.canReply && (
        <div className="ans-card">
          <div className="ans-klabel">{it.responseRequired && it.status === "sent" ? "Your response" : "Reply"}</div>
          <input className="ans-in" placeholder="Your name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          <textarea className="ans-ta" placeholder="Type your reply - it goes straight into the thread." value={text} maxLength={20000} onChange={(e) => setText(e.target.value)} />
          {uploadFile && (
            <>
              <input ref={fileRef} type="file" multiple style={{ display: "none" }} onChange={(e) => void pick(e.target.files)} />
              {files.length > 0 && <AttachmentList files={files} href={fileHref} />}
              <button className="qa-photo" style={{ marginTop: 9 }} disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? "Uploading…" : "📎 Attach a file (drawings, photos, documents)"}
              </button>
            </>
          )}
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            <button className="ans-btn primary" disabled={busy || uploading || (!text.trim() && !files.length)} onClick={() => void submit()}>
              {busy ? "Sending…" : "Send"}
            </button>
          </div>
          <p className="ans-fine">Your reply and any files are logged against {it.label} and {v.company} is told straight away.</p>
        </div>
      )}

      {it.status === "closed" && (
        <div className="ans-card ans-center">
          <p>This item is closed. Nothing further is needed from you.</p>
        </div>
      )}
    </>
  );
}
