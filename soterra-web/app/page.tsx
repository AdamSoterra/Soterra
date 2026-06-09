"use client";
import { useMemo, useState } from "react";

type Tab = "chat" | "calendar" | "plans";
type Screen = "login" | "onboard" | Tab | "sheet";
type Cite = { code: string; title: string; sub: string; ans: string; hlTag: string };
type Msg =
  | { role: "u"; text: string }
  | { role: "a"; src?: string; text: string; cite?: Cite; event?: { title: string; when: string } };

const FINISH_SHEET: Cite = {
  code: "A-602",
  title: "Internal Finishes Schedule",
  sub: "95% Detail Design · Sheet 47 of 85",
  ans: 'Unit 43 — living &amp; bedrooms: <b>Resene &quot;Alabaster&quot;</b> (half strength). Wet areas: <b>Resene &quot;Black White&quot;</b>, semi-gloss. Ceilings: <b>Resene &quot;Half White Pointer&quot;</b> throughout.',
  hlTag: "Unit 43 · finishes",
};
const FIRE_SHEET: Cite = {
  code: "A-110",
  title: "Fire & Acoustic Separations",
  sub: "95% Detail Design · Sheet 12 of 85",
  ans: 'Level 1–3 corridor walls: <b>60/60/60 (FRR)</b> — fire-rated <b>GIB Barrier&reg;</b> system, double-layer each side on a 92mm steel stud.',
  hlTag: "Corridor · FRR",
};

const SEED: Msg[] = [
  { role: "u", text: "What's the wall colour in unit 43?" },
  {
    role: "a",
    src: "📐 FROM YOUR PLANS",
    text:
      'Unit 43\'s living &amp; bedroom walls are <b>Resene &quot;Alabaster&quot;</b> (half strength). Wet areas (bathroom &amp; ensuite) are <b>Resene &quot;Black White&quot;</b>, semi-gloss.',
    cite: FINISH_SHEET,
  },
  { role: "u", text: "And the fire rating on the corridor walls?" },
  {
    role: "a",
    src: "📐 FROM YOUR PLANS",
    text:
      'The Level 1–3 corridor walls are rated <b>60/60/60 (FRR)</b> — a fire-rated <b>GIB Barrier&reg;</b> system, double-layer each side on a 92mm steel stud.',
    cite: FIRE_SHEET,
  },
  { role: "u", text: "Book the pre-line inspection for unit 49 this Friday 9am" },
  {
    role: "a",
    text: "Done — added it to your calendar. I'll remind the team the day before.",
    event: { title: "Pre-line inspection · Unit 49", when: "Fri 12 Jun · 9:00am" },
  },
];

const CHIPS = [
  "Beam size over the garage?",
  "Glazing spec — north elevation?",
  "Insulation R-value, external walls?",
  "Book a delivery",
];

const Hamburger = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export default function Page() {
  const [screen, setScreen] = useState<Screen>("login");
  const [tab, setTab] = useState<Tab>("chat");
  const [lastTab, setLastTab] = useState<Tab>("chat");
  const [menuOpen, setMenuOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>(SEED);
  const [input, setInput] = useState("");
  const [obMode, setObMode] = useState<"setup" | "join">("setup");
  const [obStep, setObStep] = useState(1);
  const [sheet, setSheet] = useState<Cite>(FINISH_SHEET);

  const isTab = screen === "chat" || screen === "calendar" || screen === "plans";
  const on = (s: Screen) => (screen === s ? "screen on" : "screen");

  const enterApp = () => { setScreen("chat"); setTab("chat"); setLastTab("chat"); };
  const go = (t: Tab) => { setTab(t); setLastTab(t); setScreen(t); };
  const openSheet = (c: Cite) => { setSheet(c); setScreen("sheet"); };
  const closeSheet = () => setScreen(lastTab);
  const logout = () => { setMenuOpen(false); setScreen("login"); };

  const send = (text?: string) => {
    const t = (text ?? input).trim();
    if (!t) return;
    setMessages((m) => [
      ...m,
      { role: "u", text: t },
      {
        role: "a",
        src: "📐 FROM YOUR PLANS",
        text:
          'Here\'s what the drawings say — with the exact sheet to check. <span style="color:var(--mut)">(Demo: wired to live plan-search in the real app.)</span>',
        cite: {
          code: "A-200",
          title: "Floor Plan — Level 1",
          sub: "95% Detail Design · Sheet 21 of 85",
          ans: "This is the cited sheet the answer was read from. In the live app the relevant area is highlighted.",
          hlTag: "Reference",
        },
      },
    ]);
    setInput("");
  };

  const calCells = useMemo(() => {
    const events: Record<number, string[]> = { 9: ["bl"], 10: ["gr"], 12: ["bl", "nv"], 15: ["am"], 18: ["gr"], 23: ["bl"] };
    const cells: { n: number; today: boolean; dots: string[]; mut: boolean }[] = [];
    for (let d = 1; d <= 30; d++) cells.push({ n: d, today: d === 9, dots: events[d] || [], mut: false });
    for (let d = 1; d <= 5; d++) cells.push({ n: d, today: false, dots: [], mut: true });
    return cells;
  }, []);

  return (
    <div className="app">
      {/* ══ LOGIN ══ */}
      <section className={on("login")} id="login">
        <div className="lg-pill">Ask your plans</div>
        <div className="lg-mark">Soter<span>ra</span></div>
        <h1 className="lg-h">The answer&apos;s in the plans.<br /><b>Just ask.</b></h1>
        <p className="lg-sub">
          Your whole crew can ask any question about the project&apos;s drawings and specs — and get the answer in
          seconds, with the exact sheet to back it up.
        </p>
        <button className="lg-btn" onClick={enterApp}>
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
          </svg>
          Continue with Google
        </button>
        <button className="lg-btn primary" onClick={enterApp}>Continue with email</button>
        <div className="lg-alt">
          New company? <a onClick={() => { setObMode("setup"); setObStep(1); setScreen("onboard"); }}>Set up your project →</a><br />
          Joining your team? <a onClick={() => { setObMode("join"); setScreen("onboard"); }}>Enter an invite code →</a>
        </div>
      </section>

      {/* ══ ONBOARDING ══ */}
      <section className={on("onboard")} id="onboard">
        <div className="ob-top">
          <span className="ob-back" onClick={() => { if (obMode === "join" || obStep === 1) setScreen("login"); else setObStep(obStep - 1); }}>‹</span>
          <div className="ob-steps" style={{ visibility: obMode === "join" ? "hidden" : "visible" }}>
            <div className={"ob-dot" + (obStep >= 1 ? " on" : "")} />
            <div className={"ob-dot" + (obStep >= 2 ? " on" : "")} />
            <div className={"ob-dot" + (obStep >= 3 ? " on" : "")} />
          </div>
        </div>
        <div className="ob-body">
          {obMode === "join" ? (
            <>
              <div className="ob-k">Join your team</div>
              <div className="ob-h">Enter your invite code</div>
              <div className="ob-p">Your site manager shared a code or link. Pop it in and you&apos;re straight onto the project — no setup.</div>
              <div className="fld"><label>Invite code</label><input defaultValue="ARTH-7K42" style={{ letterSpacing: ".18em", fontWeight: 600, textTransform: "uppercase" }} /></div>
            </>
          ) : obStep === 1 ? (
            <>
              <div className="ob-k">Step 1 · Your project</div>
              <div className="ob-h">Set up your first project</div>
              <div className="ob-p">This is what your crew will ask questions about. You can add more projects later.</div>
              <div className="fld"><label>Company</label><input defaultValue="Arthur Road Construction" /></div>
              <div className="fld"><label>Project name</label><input defaultValue="1 Arthur Road" /></div>
              <div className="fld"><label>Type</label><input defaultValue="Multi-unit housing" /></div>
            </>
          ) : obStep === 2 ? (
            <>
              <div className="ob-k">Step 2 · The plans</div>
              <div className="ob-h">Upload the drawings &amp; specs</div>
              <div className="ob-p">Drop in everything for this project — architectural, structural, services, specs. Soterra reads &amp; indexes the lot.</div>
              <div className="drop"><div className="ic">⬆️</div><b>Drop PDFs here</b><small>or tap to browse</small></div>
              <div className="uplist">
                <UpItem t="A3" n="95% Detail Design" s="85 sheets" />
                <UpItem t="A1" n="P25-152 Detailed Design" s="78 sheets" />
                <UpItem t="EL" n="8084-ELEC-ESET" s="17 sheets" />
                <UpItem t="ME" n="8084-MECH-MSET" s="7 sheets" />
                <UpItem t="SP" n="95% Project Spec" s="280 pages" />
                <UpItem t="ST" n="Structural Spec" s="104 pages" />
              </div>
            </>
          ) : (
            <>
              <div className="ob-k">Step 3 · Your crew</div>
              <div className="ob-h">You&apos;re ready. Bring the team on.</div>
              <div className="ob-p">Share this code with anyone on site. They sign up, enter the code, and they&apos;re asking the plans in seconds — no seats to manage.</div>
              <div className="code-box"><small>Project invite code</small><div className="code">ARTH-7K42</div><div className="cap">1 Arthur Road · the whole crew, one code</div></div>
              <button className="bigbtn ghost" style={{ marginBottom: 0 }}>Copy invite link</button>
            </>
          )}
        </div>
        <div className="ob-foot">
          {obMode === "join" ? (
            <button className="bigbtn" onClick={enterApp}>Join 1 Arthur Road →</button>
          ) : obStep === 1 ? (
            <button className="bigbtn" onClick={() => setObStep(2)}>Next — add the plans →</button>
          ) : obStep === 2 ? (
            <button className="bigbtn" onClick={() => setObStep(3)}>Index 571 pages →</button>
          ) : (
            <button className="bigbtn" onClick={enterApp}>Enter Soterra →</button>
          )}
        </div>
      </section>

      {/* ══ CHAT / CALENDAR / PLANS — inside the flexible content area, above the tab bar ══ */}
      <div className="content">
      <section className={on("chat") + " tabbed"} id="chat">
        <div className="top">
          <div className="proj" onClick={() => setMenuOpen(true)}>
            <b>1 Arthur Road <span className="chev">▾</span></b>
            <small>Multi-unit housing · 6 documents</small>
          </div>
          <div className="sp" />
          <button className="icbtn" onClick={() => setMenuOpen(true)}><Hamburger /></button>
        </div>
        <div className="chat-scroll">
          <div className="daypill">Today</div>
          {messages.map((m, i) =>
            m.role === "u" ? (
              <div className="msg u" key={i}><div className="bub">{m.text}</div></div>
            ) : (
              <div className="msg a" key={i}>
                <div className="bub">
                  {m.src && <div className="src">{m.src}</div>}
                  <span dangerouslySetInnerHTML={{ __html: m.text }} />
                  {m.cite && (
                    <div className="cite" onClick={() => openSheet(m.cite!)}>
                      <div className="cic">📐</div>
                      <div className="ct"><b>{m.cite.code} · {m.cite.title}</b><small>{m.cite.sub}</small></div>
                      <div className="ca">›</div>
                    </div>
                  )}
                  {m.event && (
                    <div className="evcard">
                      <div className="bar" />
                      <div className="et"><b>{m.event.title}</b><small>{m.event.when}</small></div>
                      <div className="ec">🗓️</div>
                    </div>
                  )}
                </div>
              </div>
            )
          )}
        </div>
        <div className="composer">
          <div className="chips">
            {CHIPS.map((c) => <div className="chip" key={c} onClick={() => send(c)}>{c}</div>)}
          </div>
          <div className="inbar">
            <input
              value={input}
              placeholder="Ask your plans or anything on site…"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            />
            <button className="send" onClick={() => send()}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
            </button>
          </div>
        </div>
      </section>

      {/* ══ CALENDAR ══ */}
      <section className={on("calendar") + " tabbed"} id="calendar">
        <div className="top">
          <div className="proj"><b>Calendar</b><small>1 Arthur Road</small></div>
          <div className="sp" />
          <button className="icbtn" onClick={() => setMenuOpen(true)}><Hamburger /></button>
        </div>
        <div className="cal-wrap">
          <div className="cal-head"><b>June 2026</b><div className="cal-nav"><button>‹</button><button>›</button></div></div>
          <div className="cal-grid">
            <div className="cal-dow"><div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div></div>
            <div className="cal-days">
              {calCells.map((c, i) => (
                <div className={"cd" + (c.today ? " today" : "") + (c.mut ? " mut" : "")} key={i}>
                  {c.n}
                  {c.dots.length > 0 && <div className="dots">{c.dots.map((d, j) => <span className={"d " + d} key={j} />)}</div>}
                </div>
              ))}
            </div>
          </div>
          <div className="agenda">
            <div className="ag-k">This week</div>
            <Ev bar="var(--blue)" when="FRI 12 9:00am" title="Pre-line inspection · Unit 49" sub="Booked from chat" tag="Inspection" tagBg="rgba(14,116,189,.1)" tagFg="var(--blue)" />
            <Ev bar="var(--green)" when="WED 10 7:30am" title="GIB delivery — Level 2" sub="Carter Holt · 142 sheets" tag="Delivery" tagBg="rgba(16,185,129,.12)" tagFg="var(--green)" />
            <Ev bar="var(--navy)" when="FRI 12 6:00am" title="Slab pour — Block C" sub="Weather check Thu PM" tag="Pour" tagBg="rgba(10,37,64,.1)" tagFg="var(--navy)" />
            <Ev bar="var(--amber)" when="MON 15 —" title="PS3 due — plumbing" sub="Reminder · chase subcontractor" tag="Reminder" tagBg="rgba(245,158,11,.14)" tagFg="var(--amber)" />
          </div>
        </div>
      </section>

      {/* ══ PLANS ══ */}
      <section className={on("plans") + " tabbed"} id="plans">
        <div className="top">
          <div className="proj"><b>Plans &amp; specs</b><small>1 Arthur Road</small></div>
          <div className="sp" />
          <button className="icbtn" onClick={() => setMenuOpen(true)}><Hamburger /></button>
        </div>
        <div className="plans-wrap">
          <div className="idx">
            <div><div className="big">571</div><small>pages indexed</small></div>
            <div style={{ flex: 1 }}>
              <small>Every drawing &amp; spec on this project, searchable in seconds.</small>
              <span className="grn">● Ready — last updated today</span>
            </div>
          </div>
          <div className="pg-k">Architectural</div>
          <Doc ic="arc" tag="A3" name="95% Detail Design" sub="85 sheets · floor plans, elevations, details" onClick={() => openSheet(FINISH_SHEET)} />
          <Doc ic="arc" tag="A1" name="P25-152-FDS-08 — Detailed Design" sub="78 sheets · A1" onClick={() => openSheet(FINISH_SHEET)} />
          <div className="pg-k" style={{ marginTop: 16 }}>Services</div>
          <Doc ic="srv" tag="ELEC" name="8084-ELEC-ESET" sub="17 sheets · power, lighting, data" onClick={() => openSheet(FINISH_SHEET)} />
          <Doc ic="srv" tag="MECH" name="8084-MECH-MSET" sub="7 sheets · HVAC, ventilation" onClick={() => openSheet(FINISH_SHEET)} />
          <div className="pg-k" style={{ marginTop: 16 }}>Specifications</div>
          <Doc ic="spc" tag="SPEC" name="95% Project Spec" sub="280 pages · materials, finishes, workmanship" onClick={() => openSheet(FINISH_SHEET)} />
          <Doc ic="spc" tag="STR" name="P25-152-SPC-01 — Structural Spec" sub="104 pages" onClick={() => openSheet(FINISH_SHEET)} />
        </div>
      </section>

      </div>

      {/* ══ SHEET VIEW ══ */}
      <section className={on("sheet")} id="sheet">
        <div className="sh-top">
          <span className="bk" onClick={closeSheet}>‹</span>
          <div className="ti"><b>{sheet.code}</b><small>{sheet.title}</small></div>
          <button className="icbtn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
          </button>
        </div>
        <div className="sh-canvas">
          <div className="sheetpaper">
            <div className="frame" />
            <div className="hl" style={{ left: "14%", top: "30%", width: "30%", height: "16%" }} />
            <div className="hltag" style={{ left: "14%", top: "24%" }}>{sheet.hlTag}</div>
            <div className="tb"><b>{sheet.code}</b><span>{sheet.title}</span><br /><span style={{ color: "#9AA7B4" }}>1 Arthur Rd · 95% Detail Design</span></div>
          </div>
        </div>
        <div className="sh-ans">
          <div className="src">📐 ANSWER FROM THIS SHEET</div>
          <p dangerouslySetInnerHTML={{ __html: sheet.ans }} />
        </div>
      </section>

      {/* ══ BOTTOM TABS ══ */}
      {isTab && (
        <nav className="tabs">
          <button className={"tab" + (tab === "chat" ? " act" : "")} onClick={() => go("chat")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.8-.8L3 21l1.9-5.2A8.4 8.4 0 1 1 21 11.5z" /></svg>
            Chat
          </button>
          <button className={"tab" + (tab === "calendar" ? " act" : "")} onClick={() => go("calendar")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path d="M3 9h18M8 2.5v4M16 2.5v4" /></svg>
            Calendar
          </button>
          <button className={"tab" + (tab === "plans" ? " act" : "")} onClick={() => go("plans")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 3 7.5 12 12l9-4.5L12 3z" /><path d="M3 12l9 4.5L21 12M3 16.5 12 21l9-4.5" /></svg>
            Plans
          </button>
        </nav>
      )}

      {/* ══ MENU ══ */}
      <div className={"scrim" + (menuOpen ? " on" : "")} onClick={() => setMenuOpen(false)} />
      <div className={"menu" + (menuOpen ? " on" : "")}>
        <div className="grab" />
        <div className="mrow"><span className="mi">🏗️</span> 1 Arthur Road <span className="proj-tag">Current</span></div>
        <div className="mrow"><span className="mi">➕</span> Switch / add project</div>
        <div className="mrow"><span className="mi">👥</span> Crew &amp; invite code</div>
        <div className="mrow"><span className="mi">⬆️</span> Upload more plans</div>
        <div className="mrow sep"><span className="mi">⚙️</span> Settings</div>
        <div className="mrow" onClick={logout}><span className="mi">↩️</span> Sign out</div>
      </div>
    </div>
  );
}

function UpItem({ t, n, s }: { t: string; n: string; s: string }) {
  return (
    <div className="upitem"><div className="dot">{t}</div><div className="nm">{n}<small>{s}</small></div><div className="ok">✓</div></div>
  );
}
function Ev(p: { bar: string; when: string; title: string; sub: string; tag: string; tagBg: string; tagFg: string }) {
  const [d, time] = [p.when.split(" ").slice(0, 2).join(" "), p.when.split(" ").slice(2).join(" ")];
  return (
    <div className="ev">
      <div className="bar" style={{ background: p.bar }} />
      <div className="when">{d}<br />{time}</div>
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
