"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// The consultant's side of an RFI - soterra.co.nz/answer/<token>.
//
// This is the page behind the "Answer this RFI online" button in the emailed
// RFI. No account, no login: the token in the link is the authorisation (see
// lib/rfi.ts). It shows the full thread - question, pinned sheets, follow-ups
// - and takes the answer straight into the register: open → answered, the
// response clock stops, and whoever raised it gets the notice.
//
// The consultant is likely on a phone, in a carpark, between site visits:
// one column, big type, the question first, the box at the bottom.

type ThreadMsg = {
  type: string; // question | official_answer | followup
  authorSide: string; // contractor | consultant
  authorName: string | null;
  body: string;
  createdAt: string;
};
type Thread = {
  company: string;
  project: string;
  rfi: {
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
    costImpact: string;
    costEstimate: string | null;
    programmeImpact: string;
    programmeDays: number | null;
    consultantName: string | null;
    consultantCompany: string | null;
    dateRaised: string | null;
    dateRequiredBy: string | null;
    dateAnswered: string | null;
  };
  messages: ThreadMsg[];
  sheets: { doc: string; page: number }[];
  canAnswer: boolean;
  canComment: boolean;
};

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : "";

export default function AnswerPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [thread, setThread] = useState<Thread | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "invalid" | "error">("loading");
  const [tries, setTries] = useState(0);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [justAnswered, setJustAnswered] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch(`/api/rfi-answer?token=${encodeURIComponent(token)}`);
        // Only a real 404 means the link is dead. A flaky site connection or
        // a server hiccup must NOT show the permanent dead-end - it gets a
        // retry instead.
        if (r.status === 404) {
          setState("invalid");
          return;
        }
        if (!r.ok) {
          setState("error");
          return;
        }
        const d = (await r.json()) as Thread;
        setThread(d);
        setName(d.rfi.consultantName ?? "");
        setState("ready");
      } catch {
        setState("error");
      }
    })();
  }, [token, tries]);

  const submit = async (kind: "answer" | "comment") => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/rfi-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, kind, body: text, authorName: name }),
      });
      const d = (await r.json()) as { ok?: boolean; thread?: Thread; error?: string };
      if (!r.ok || !d.ok) {
        setErr(d.error ?? "That didn't go through. Try again.");
      } else {
        if (d.thread) setThread(d.thread);
        setText("");
        if (kind === "answer") setJustAnswered(true);
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
        <div className="ans-card ans-center">Opening the RFI…</div>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className="ans">
        <div className="ans-card ans-center">
          <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
          <h1>Couldn&apos;t load the RFI</h1>
          <p>Probably a patchy connection. Your link is still good.</p>
          <div className="ans-actions" style={{ justifyContent: "center", marginTop: 14 }}>
            <button
              className="ans-btn primary"
              onClick={() => {
                setState("loading");
                setTries((t) => t + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (state === "invalid" || !thread) {
    return (
      <div className="ans">
        <div className="ans-card ans-center">
          <Image src="/logo-mark.png" alt="Soterra" width={34} height={46} />
          <h1>This link is no longer valid</h1>
          <p>
            The RFI it pointed to may have been withdrawn. Reply to the original email instead and the
            builder will log your response.
          </p>
        </div>
      </div>
    );
  }

  const r = thread.rfi;
  // The initial question is shown as its own block; keep it out of the
  // conversation list so it doesn't render twice.
  const firstQ = thread.messages.findIndex((m) => m.type === "question");
  const convo = thread.messages.filter((_, i) => i !== firstQ);
  const overdue = r.status === "open" && r.dateRequiredBy && new Date() > new Date(r.dateRequiredBy);

  return (
    <div className="ans">
      <div className="ans-top">
        <Image src="/logo-mark.png" alt="" width={22} height={30} />
        <span className="ans-brand">SOTERRA</span>
        <span className="ans-proj">
          {thread.company} · {thread.project}
        </span>
      </div>

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
            <div className="ans-klabel">{thread.company}&apos;s proposed solution</div>
            <div className="ans-prop">{r.proposedSolution}</div>
          </>
        )}
        {r.codeRefs.length > 0 && (
          <div className="ans-refs">
            {r.codeRefs.map((c, i) => (
              <span className="ans-chip" key={i}>
                {c}
              </span>
            ))}
          </div>
        )}
        {thread.sheets.map((s, i) => (
          <div className="ans-sheet" key={i}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/rfi-answer/sheet?token=${encodeURIComponent(token)}&doc=${encodeURIComponent(s.doc)}&page=${s.page}`}
              alt={`${s.doc} - the pinned detail`}
            />
            <small>
              {s.doc} · the pin marks the spot this RFI is about
            </small>
          </div>
        ))}
      </div>

      {convo.length > 0 && (
        <div className="ans-card">
          <div className="ans-klabel">Conversation</div>
          {convo.map((m, i) => (
            <div className={"ans-msg " + (m.authorSide === "consultant" ? "them" : "us")} key={i}>
              <div className="ans-msg-k">
                {m.type === "official_answer" ? "✓ Official answer · " : ""}
                {m.authorName ?? (m.authorSide === "consultant" ? "Consultant" : thread.company)} ·{" "}
                {fmtDate(m.createdAt)}
              </div>
              <div className="ans-msg-b">{m.body}</div>
            </div>
          ))}
        </div>
      )}

      {justAnswered && (
        <div className="ans-done">
          ✓ Answer logged against {r.label}. {thread.company} has been notified - you&apos;re done.
        </div>
      )}

      {(thread.canAnswer || thread.canComment) && (
        <div className="ans-card">
          <div className="ans-klabel">
            {thread.canAnswer ? "Your answer" : "Add to the thread"}
          </div>
          {!thread.canAnswer && r.status === "answered" && !justAnswered && (
            <p className="ans-note">
              An answer is already logged; {thread.company} has the ball. You can still add a note to
              the thread.
            </p>
          )}
          <input
            className="ans-in"
            placeholder="Your name"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="ans-ta"
            placeholder={
              thread.canAnswer
                ? "Type the answer here - it goes straight into the RFI register."
                : "Type your note…"
            }
            value={text}
            maxLength={20000}
            onChange={(e) => setText(e.target.value)}
          />
          {err && <div className="ans-err">{err}</div>}
          <div className="ans-actions">
            {thread.canAnswer && (
              <button className="ans-btn primary" disabled={busy || !text.trim()} onClick={() => void submit("answer")}>
                {busy ? "Sending…" : "Send as the official answer"}
              </button>
            )}
            <button className="ans-btn" disabled={busy || !text.trim()} onClick={() => void submit("comment")}>
              {thread.canAnswer ? "Send as a comment only" : busy ? "Sending…" : "Add the note"}
            </button>
          </div>
          {thread.canAnswer && (
            <p className="ans-fine">
              The official answer closes out the question and stops the response clock. A comment is
              for clarifications - the RFI stays open.
            </p>
          )}
        </div>
      )}

      {r.status === "closed" && (
        <div className="ans-card ans-center">
          <p>This RFI is closed. Nothing further is needed from you.</p>
        </div>
      )}

      <div className="ans-foot">
        Sent with <b>Soterra</b> · soterra.co.nz · This link is private to this RFI - don&apos;t forward it.
      </div>
    </div>
  );
}
