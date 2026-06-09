"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";

type Tab = "assistant" | "calendar" | "tasks" | "plans" | "upload";
type Cite = { code: string; title: string; sub: string; ans: string; hlTag: string };
type Msg =
  | { role: "u"; text: string }
  | { role: "a"; src?: string; text: string; cite?: Cite; event?: { title: string; when: string }; pending?: boolean };

const CHIPS = [
  "What's the fire rating on the exterior doors?",
  "What GIB do I use in the bathrooms?",
  "Beam size over the garage?",
  "Insulation R-value — external walls?",
];

const DEMO_SHEET: Cite = {
  code: "A-602",
  title: "Internal Finishes Schedule",
  sub: "95% Detail Design · Sheet 47 of 85",
  ans: 'Unit 43 — living &amp; bedrooms: <b>Resene "Alabaster"</b> (half strength). Wet areas: <b>Resene "Black White"</b>, semi-gloss. Ceilings: <b>Resene "Half White Pointer"</b> throughout.',
  hlTag: "Unit 43 · finishes",
};

const I = {
  chat: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" /></svg>),
  cal: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>),
  plans: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 3 7.5 12 12l9-4.5L12 3z" /><path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" /></svg>),
  up: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0L7 9m5-5 5 5M4 20h16" /></svg>),
  tasks: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 6h12M9 12h12M9 18h12" /><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>),
};
const NAV: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "assistant", label: "Assistant", icon: I.chat },
  { id: "calendar", label: "Calendar", icon: I.cal },
  { id: "tasks", label: "Tasks", icon: I.tasks },
  { id: "plans", label: "Plans", icon: I.plans },
  { id: "upload", label: "Upload", icon: I.up },
];

export default function Page() {
  const [tab, setTab] = useState<Tab>("assistant");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<Cite | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tasks, setTasks] = useState([
    { id: 1, title: "Send RFI — beam size over the garage", due: "Today", who: "You", vis: "me", done: false },
    { id: 2, title: "Order GIB for Level 3", due: "Wed 17", who: "Site mgr", vis: "team", done: false },
    { id: 3, title: "Chase plumber — PS3 sign-off", due: "Mon 15", who: "You", vis: "me", done: false },
    { id: 4, title: "Confirm slab pour weather window", due: "Thu 11", who: "Foreman", vis: "team", done: false },
    { id: 5, title: "Pre-line QA — Unit 49", due: "Done", who: "You", vis: "team", done: true },
  ]);
  const toggleTask = (id: number) => setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const { isLoaded, isSignedIn, user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const send = async (text?: string) => {
    const t = (text ?? input).trim();
    if (!t || busy) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto";
    setBusy(true);
    setTab("assistant");
    setMessages((m) => [...m, { role: "u", text: t }, { role: "a", text: "…", pending: true }]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: t }),
      });
      const data = await res.json();
      const ans = String(data.answer || data.error || "Sorry, something went wrong.");
      const sm = ans.match(/\n*\s*Source:\s*([^\n]+)\s*$/i);
      const body = sm ? ans.slice(0, sm.index).trim() : ans;
      const cite = sm ? makeCite(sm[1].trim(), body) : undefined;
      setMessages((prev) => [...prev.slice(0, -1), { role: "a", src: "📐 FROM YOUR PLANS", text: fmt(body), cite }]);
    } catch {
      setMessages((prev) => [...prev.slice(0, -1), { role: "a", text: "Sorry — couldn't reach the plans just now. Try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const calCells = useMemo(() => {
    const events: Record<number, string[]> = { 9: ["bl"], 10: ["gr"], 12: ["bl", "nv"], 15: ["am"], 18: ["gr"], 23: ["bl"] };
    const cells: { n: number; today: boolean; dots: string[]; mut: boolean }[] = [];
    for (let d = 1; d <= 30; d++) cells.push({ n: d, today: d === 9, dots: events[d] || [], mut: false });
    for (let d = 1; d <= 5; d++) cells.push({ n: d, today: false, dots: [], mut: true });
    return cells;
  }, []);

  if (!isLoaded) return <div className="boot" />;

  /* ─── Signed out: login ─── */
  if (!isSignedIn) {
    return (
      <div className="login">
        <div className="login-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="lg-logo" src="/logo-mark.png" alt="Soterra" />
          <div className="lg-pill">Ask your plans</div>
          <h1 className="lg-h">The answer&apos;s in the plans.<br /><b className="grad">Just ask.</b></h1>
          <p className="lg-sub">
            Your whole crew can ask any question about the project&apos;s drawings and specs — and get the answer in
            seconds, with the exact sheet to back it up.
          </p>
          <button className="lg-btn" onClick={() => clerk.openSignIn()}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" /><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" /><path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" /><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" /></svg>
            Continue with Google
          </button>
          <button className="lg-btn primary" onClick={() => clerk.openSignIn()}>Continue with email</button>
          <div className="lg-alt">
            New company? <a onClick={() => clerk.openSignUp()}>Set up your project →</a><br />
            Joining your team? <a onClick={() => clerk.openSignUp()}>Enter an invite code →</a>
          </div>
        </div>
      </div>
    );
  }

  const firstName =
    user?.firstName || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || user?.username || "there";
  const initials = (firstName[0] || "S").toUpperCase();

  const cbox = (
    <div className="cbox">
      <textarea
        ref={taRef}
        rows={1}
        value={input}
        placeholder="Ask your plans, or anything on site…"
        onChange={(e) => {
          setInput(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
        }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
      />
      <div className="crow">
        <span className="hint">Enter to send · Shift+Enter for a new line</span>
        <div className="ract">
          <button className="attach" title="Attach">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.5 12.5 21a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L10 18.6a1.7 1.7 0 0 1-2.3-2.3l7.8-7.8" /></svg>
          </button>
          <button className="send" disabled={busy || !input.trim()} onClick={() => send()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" /></svg>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="shell">
      {/* ─── top nav ─── */}
      <header className="topnav">
        <div className="brand grad" onClick={() => setTab("assistant")}>Soterra</div>
        <nav className="navtabs">
          {NAV.map((n) => (
            <button key={n.id} className={"navtab" + (tab === n.id ? " act" : "")} onClick={() => setTab(n.id)}>
              {n.icon}<span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="navright">
          <div className="proj-chip"><span className="dot" /> 1 Arthur Road <small>· 6 docs</small></div>
          <button className="avatar" onClick={() => setMenuOpen((o) => !o)}>{initials}</button>
          {menuOpen && (
            <div className="menu">
              <div className="mrow"><span className="mi">🏗️</span><div><b>1 Arthur Road</b><br /><small>Multi-unit housing</small></div></div>
              <div className="mrow"><span className="mi">➕</span> Switch / add project</div>
              <div className="mrow"><span className="mi">👥</span> Crew &amp; invite code</div>
              <div className="mrow sep" onClick={() => clerk.signOut()}><span className="mi">↩️</span> Sign out</div>
            </div>
          )}
        </div>
      </header>

      <div className="content">
        {/* ─── ASSISTANT ─── */}
        {tab === "assistant" && (
          <div className="assistant">
            {messages.length === 0 ? (
              <div className="hero-full">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="hero-logo" src="/logo-mark.png" alt="Soterra" />
                <h1>Hi <b className="grad">{firstName}</b>, how can I help?</h1>
                <div className="hero-composer">{cbox}</div>
              </div>
            ) : (
              <>
                <div className="asst-scroll" ref={scrollRef}>
                  <div className="asst-inner">
                    <div className="thread">
                      {messages.map((m, i) =>
                        m.role === "u" ? (
                          <div className="msg u" key={i}><div className="bub">{m.text}</div></div>
                        ) : (
                          <div className="msg a" key={i}>
                            <div className="bub">
                              {m.src && <div className="src">{m.src}</div>}
                              {m.pending ? (
                                <span className="typing"><i /><i /><i /></span>
                              ) : (
                                <span dangerouslySetInnerHTML={{ __html: m.text }} />
                              )}
                              {m.cite && (
                                <div className="cite" onClick={() => setSheet(m.cite!)}>
                                  <div className="cic">📐</div>
                                  <div className="ct"><b>{m.cite.code} · {m.cite.title}</b><small>{m.cite.sub}</small></div>
                                  <div className="ca">›</div>
                                </div>
                              )}
                              {m.event && (
                                <div className="evcard"><div className="bar" /><div className="et"><b>{m.event.title}</b><small>{m.event.when}</small></div><div className="ec">🗓️</div></div>
                              )}
                            </div>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                </div>
                <div className="composer-wrap"><div className="composer">{cbox}</div></div>
              </>
            )}
          </div>
        )}

        {/* ─── CALENDAR ─── */}
        {tab === "calendar" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Calendar</div>
            <div className="page-sub">1 Arthur Road · site schedule (NZ time)</div>
            <div className="cal-top"><b>June 2026</b><div className="cal-nav"><button>‹</button><button>›</button></div></div>
            <div className="cal-card">
              <div className="cal-dow"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>
              <div className="cal-days">
                {calCells.map((c, i) => (
                  <div className={"cd" + (c.today ? " today" : "") + (c.mut ? " mut" : "")} key={i}>
                    {c.n}{c.dots.length > 0 && <div className="dots">{c.dots.map((d, j) => <span className={"d " + d} key={j} />)}</div>}
                  </div>
                ))}
              </div>
            </div>
            <div className="ag-k">This week</div>
            <Ev bar="var(--blue)" when="FRI 12 · 9:00am" title="Pre-line inspection · Unit 49" sub="Booked from chat · You" tag="Inspection" tagBg="rgba(14,116,189,.1)" tagFg="var(--blue)" />
            <Ev bar="var(--green)" when="WED 10 · 7:30am" title="GIB delivery — Level 2" sub="Carter Holt · 142 sheets" tag="Delivery" tagBg="rgba(16,185,129,.12)" tagFg="var(--green)" />
            <Ev bar="var(--navy)" when="FRI 12 · 6:00am" title="Slab pour — Block C" sub="Weather check Thu PM · whole crew" tag="Pour" tagBg="rgba(10,37,64,.1)" tagFg="var(--navy)" />
            <Ev bar="var(--amber)" when="MON 15 · —" title="PS3 due — plumbing" sub="Private reminder · just you" tag="Reminder" tagBg="rgba(245,158,11,.14)" tagFg="var(--amber)" />
          </div></div>
        )}

        {/* ─── TASKS ─── */}
        {tab === "tasks" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Tasks</div>
            <div className="page-sub">1 Arthur Road · your to-dos and the team&apos;s — what&apos;s coming up</div>
            {tasks.map((t) => (
              <div className={"task" + (t.done ? " done" : "")} key={t.id}>
                <div className="cb" onClick={() => toggleTask(t.id)}>{t.done ? "✓" : ""}</div>
                <div className="tk"><b>{t.title}</b><small>{t.who}{t.due !== "Done" ? ` · due ${t.due}` : ""}</small></div>
                <span className={"vis " + t.vis}>{t.vis === "team" ? "Team" : "Just me"}</span>
              </div>
            ))}
            <button className="task-add">＋ Add a task</button>
          </div></div>
        )}

        {/* ─── PLANS ─── */}
        {tab === "plans" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Plans &amp; specs</div>
            <div className="page-sub">1 Arthur Road · every drawing &amp; spec, searchable in seconds</div>
            <div className="idx">
              <div><div className="big">571</div><small>pages indexed</small></div>
              <div style={{ flex: 1 }}><small>Architectural, structural, services and specs — all read and searchable.</small><span className="grn">● Ready — last updated today</span></div>
            </div>
            <div className="pg-k">Architectural</div>
            <div className="docs">
              <Doc ic="arc" tag="A3" name="95% Detail Design" sub="85 sheets · plans, elevations" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="arc" tag="A1" name="P25-152-FDS-08" sub="78 sheets · detailed design" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
            <div className="pg-k" style={{ marginTop: 18 }}>Services</div>
            <div className="docs">
              <Doc ic="srv" tag="ELEC" name="8084-ELEC-ESET" sub="17 sheets · power, lighting, data" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="srv" tag="MECH" name="8084-MECH-MSET" sub="7 sheets · HVAC, ventilation" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
            <div className="pg-k" style={{ marginTop: 18 }}>Specifications</div>
            <div className="docs">
              <Doc ic="spc" tag="SPEC" name="95% Project Spec" sub="280 pages · materials, finishes" onClick={() => setSheet(DEMO_SHEET)} />
              <Doc ic="spc" tag="STR" name="P25-152-SPC-01 — Structural" sub="104 pages" onClick={() => setSheet(DEMO_SHEET)} />
            </div>
          </div></div>
        )}

        {/* ─── UPLOAD ─── */}
        {tab === "upload" && (
          <div className="page"><div className="page-inner">
            <div className="page-h">Upload plans</div>
            <div className="page-sub">Add drawings &amp; specs to this project</div>
            <div className="drop">
              <div className="ic">⬆️</div>
              <b>Drop PDFs here</b>
              <p>Architectural, structural, services, specs — Soterra reads &amp; indexes the lot so your crew can ask it anything.</p>
              <span className="soon">Wiring up next</span>
            </div>
          </div></div>
        )}
      </div>

      {/* ─── sheet modal ─── */}
      {sheet && (
        <div className="scrim" onClick={() => setSheet(null)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sh-top">
              <div className="ti"><b>{sheet.code}</b><small>{sheet.title}</small></div>
              <button className="sh-x" onClick={() => setSheet(null)}>✕</button>
            </div>
            <div className="sh-canvas">
              <div className="sheetpaper">
                <div className="frame" /><div className="hl" /><div className="hltag">{sheet.hlTag}</div>
                <div className="tb"><b>{sheet.code}</b><span>{sheet.title}</span><br /><span style={{ color: "#9AA7B4" }}>1 Arthur Rd</span></div>
              </div>
            </div>
            <div className="sh-ans"><div className="src">📐 ANSWER FROM THIS SHEET</div><p dangerouslySetInnerHTML={{ __html: sheet.ans }} /></div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── helpers ── */
function fmt(s: string): string {
  return s
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n+/g, "<br/>");
}
function makeCite(sourceLine: string, body: string): Cite {
  const parts = sourceLine.split("·").map((x) => x.trim()).filter(Boolean);
  const doc = parts[0] || "Source";
  const code = parts.find((p, i) => i > 0 && /[A-Z]/.test(p) && /\d/.test(p)) || doc;
  const rest = parts.filter((p) => p !== doc && p !== code).join(" · ");
  return { code, title: rest || doc, sub: doc, ans: fmt(body), hlTag: code };
}
function Ev(p: { bar: string; when: string; title: string; sub: string; tag: string; tagBg: string; tagFg: string }) {
  return (
    <div className="ev">
      <div className="bar" style={{ background: p.bar }} />
      <div className="when">{p.when}</div>
      <div className="body"><b>{p.title}</b><small>{p.sub}</small></div>
      <div className="tag" style={{ background: p.tagBg, color: p.tagFg }}>{p.tag}</div>
    </div>
  );
}
function Doc(p: { ic: string; tag: string; name: string; sub: string; onClick: () => void }) {
  return (
    <div className="doc" onClick={p.onClick}>
      <div className={"ic " + p.ic}>{p.tag}</div>
      <div className="dt"><b>{p.name}</b><small>{p.sub}</small></div>
      <div className="arr">›</div>
    </div>
  );
}
