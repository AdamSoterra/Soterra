"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// The consultant's side of a QA defect - soterra.co.nz/signoff/<token>.
//
// Behind the "Sign it off" button in the emailed sign-off request. No account,
// no login: the token in the link is the authorisation (see lib/qaCloseout.ts).
// The sub has marked the defect fixed and attached a photo; the consultant sees
// the photo and either signs it off (closed) or bounces it back (the sub redoes).

type Defect = {
  company: string;
  project: string;
  defect: { title: string; detail: string | null; location: string | null; category: string | null };
  subLine: string;
  fixNote: string | null;
  hasFixPhoto: boolean;
  status: string; // submitted | closed | sent
  canSignoff: boolean;
};

export default function SignoffPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [d, setD] = useState<Defect | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [tries, setTries] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"approved" | "rejected" | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/qa-signoff?token=${encodeURIComponent(token)}`);
        if (r.status === 404) return setState("invalid");
        if (!r.ok) return setState("error");
        setD((await r.json()) as Defect);
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries]);

  const decide = async (decision: "approve" | "reject") => {
    if (busy) return;
    if (decision === "reject" && !note.trim()) {
      setErr("Add a note so the sub knows what to put right.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/qa-signoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, decision, note }),
      });
      const j = (await r.json()) as { ok?: boolean; approved?: boolean; defect?: Defect; error?: string };
      if (!r.ok || !j.ok) {
        setErr(j.error ?? "That didn't go through. Try again.");
      } else {
        if (j.defect) setD(j.defect);
        setOutcome(j.approved ? "approved" : "rejected");
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
          <p>Reply to the original email instead and the builder will log your decision.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ans">
      <div className="ans-top">
        <Image src="/logo-mark.png" alt="" width={22} height={30} />
        <span className="ans-brand">SOTERRA</span>
        <span className="ans-proj">{d.company} · {d.project}</span>
      </div>

      <div className="ans-card">
        <div className="ans-head">
          <span className="ans-no">Sign-off</span>
          <span className={"ans-pill " + (d.status === "closed" ? "answered" : d.status === "sent" ? "open" : "dim")}>{d.status}</span>
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
        <div className="ans-klabel">{d.subLine} marked it fixed</div>
        {d.fixNote ? <div className="ans-prop">{d.fixNote}</div> : <div className="ans-note">No note left.</div>}
        {d.hasFixPhoto && (
          <div className="ans-sheet">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/qa-fix/photo?token=${encodeURIComponent(token)}`} alt="Photo of the fix" />
            <small>Photo of the fix, taken by {d.subLine}</small>
          </div>
        )}
      </div>

      {outcome === "approved" && (
        <div className="ans-done">✓ Signed off. {d.company} has been notified and the item is closed.</div>
      )}
      {outcome === "rejected" && (
        <div className="ans-done" style={{ background: "#FFF7ED", borderColor: "#FDBA74", color: "#B45309" }}>
          ↩ Bounced back to the sub with your note. {d.company} has been notified.
        </div>
      )}

      {d.canSignoff && !outcome && (
        <div className="ans-card">
          <div className="ans-klabel">Your note (required to bounce back)</div>
          <textarea
            className="ans-ta"
            placeholder="Optional if you're signing off. If bouncing back, say what still needs doing."
            value={note}
            maxLength={4000}
            onChange={(e) => setNote(e.target.value)}
          />
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            <button className="ans-btn primary" disabled={busy} onClick={() => void decide("approve")}>
              {busy ? "Sending…" : "Sign it off"}
            </button>
            <button className="ans-btn" disabled={busy} onClick={() => void decide("reject")}>
              Bounce back
            </button>
          </div>
          <p className="ans-fine">Signing off closes the item. Bouncing it back sends it to the sub to redo, with your note.</p>
        </div>
      )}

      {!d.canSignoff && !outcome && (
        <div className="ans-card ans-center">
          <p>This item has already been actioned. Nothing further is needed from you.</p>
        </div>
      )}

      <div className="ans-foot">
        Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this item - don&apos;t forward it.
      </div>
    </div>
  );
}
