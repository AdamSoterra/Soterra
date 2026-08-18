"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

// The sub's side of a QA defect - soterra.co.nz/fix/<token>.
//
// Behind the "Mark it fixed" button in the emailed defect. No account, no login:
// the token in the link is the authorisation (see lib/qaCloseout.ts). The sub is
// on a phone, at the wall, one hand free: show the defect, one photo, one note,
// one button. Marking it fixed hands the ball back to the builder.

type Defect = {
  company: string;
  project: string;
  defect: { title: string; detail: string | null; location: string | null; category: string | null };
  status: string; // open | sent | ready | submitted | closed
  hasFixPhoto: boolean;
  canSubmit: boolean;
};

// Downscale + re-encode to JPEG in the browser: a raw phone photo is 4-10 MB,
// and the upload goes through a serverless route with a small body cap. 1600px
// on the long edge is plenty to prove a fix.
async function compress(file: File): Promise<Blob> {
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
    return file; // if anything fails, send the original and let the route judge it
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function FixPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [d, setD] = useState<Defect | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/qa-fix?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (!r.ok) return setState("error");
        setD((await r.json()) as Defect);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries]);

  const pickPhoto = async (file: File) => {
    setErr(null);
    setUploading(true);
    try {
      const blob = await compress(file);
      const r = await fetch(`/api/qa-fix/photo?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "image/jpeg" },
        body: blob,
      });
      const j = (await r.json()) as { path?: string; error?: string };
      if (!r.ok || !j.path) {
        setErr(j.error ?? "That photo didn't upload. Try again.");
        return;
      }
      setPhotoPath(j.path);
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
    try {
      const r = await fetch("/api/qa-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, note, photoPath }),
      });
      const j = (await r.json()) as { ok?: boolean; defect?: Defect; error?: string };
      if (!r.ok || !j.ok) {
        setErr(j.error ?? "That didn't go through. Try again.");
      } else {
        if (j.defect) setD(j.defect);
        setDone(true);
      }
    } catch {
      setErr("That didn't go through. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (state === "loading") {
    return (
      <div className="ans">
        <div className="ans-card ans-center">Opening the item…</div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="ans">
        <div className="ans-card ans-center">
          <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
          <h1>Couldn&apos;t load the item</h1>
          <p>Probably a patchy connection. Your link is still good.</p>
          <div className="ans-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <button className="ans-btn primary" onClick={() => { setState("loading"); setTries((t) => t + 1); }}>
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (state === "invalid" || !d) {
    return (
      <div className="ans">
        <div className="ans-card ans-center">
          <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
          <h1>This link is no longer valid</h1>
          <p>Reply to the original email instead and the builder will log your update.</p>
        </div>
      </div>
    );
  }

  const alreadyIn = !d.canSubmit && !done; // marked fixed earlier, or moved on by the builder

  return (
    <div className="ans">
      <div className="ans-top">
        <Image src="/logo-mark.png" alt="" width={22} height={30} />
        <span className="ans-brand">SOTERRA</span>
        <span className="ans-proj">{d.company} · {d.project}</span>
      </div>

      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">Defect to fix</span>
          <span className={"ans-pill " + (d.status === "closed" ? "closed" : d.status === "sent" ? "open" : "answered")}>{d.status}</span>
          {d.defect.category && <span className="ans-pill dim">{d.defect.category}</span>}
        </div>
        <h1 className="ans-subj">{d.defect.title}</h1>
        <div className="ans-meta">{d.defect.location && <span>📍 {d.defect.location}</span>}</div>
        {d.defect.detail && (
          <>
            <div className="ans-klabel">What was pulled up</div>
            <div className="ans-q">{d.defect.detail}</div>
          </>
        )}
      </div>

      {done && (
        <div className="ans-done">✓ Marked fixed. {d.company} has been notified - you&apos;re done.</div>
      )}

      {alreadyIn && (
        <div className="ans-card ans-center">
          <p>This item has already been marked fixed. {d.company} has the ball now - nothing more needed from you.</p>
        </div>
      )}

      {d.canSubmit && !done && (
        <div className="ans-card">
          <div className="ans-klabel">Photo of the fix</div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickPhoto(f); }}
          />
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="qa-thumb" src={preview} alt="The fix" />
          ) : null}
          <button className="qa-photo" disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "Uploading…" : preview ? "Retake / choose another" : "📷 Take a photo of the fix"}
          </button>

          <div className="ans-klabel">Anything to add (optional)</div>
          <textarea
            className="ans-ta"
            placeholder="e.g. Redone to the detail, penetration fully sealed."
            value={note}
            maxLength={4000}
            onChange={(e) => setNote(e.target.value)}
          />
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            <button className="ans-btn primary" disabled={busy || uploading} onClick={() => void submit()}>
              {busy ? "Sending…" : "Mark it fixed"}
            </button>
          </div>
          <p className="ans-fine">This tells {d.company} the fix is done and sends them your photo. They sign it off from their end.</p>
        </div>
      )}

      <div className="ans-foot">
        Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this item - don&apos;t forward it.
      </div>
    </div>
  );
}
