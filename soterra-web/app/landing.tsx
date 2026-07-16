"use client";
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

// Set CSS custom properties inline without fighting React's CSSProperties type.
const cvar = (o: Record<string, string>): CSSProperties => o as unknown as CSSProperties;

// Soterra public landing (Adam, 2026-07-16 rebuild).
// Positioning: two layers. Layer 1 = the project assistant people use today.
// Layer 2 = the company learning engine (the moat). Umbrella line = "Turning
// construction data into company intelligence." Partner-backed (AUT). Same
// blue/navy palette as the previous version. Rendered as the signed-out front
// page (app/page.tsx, with Clerk handlers) and at /preview/command.

function Cta({ kind, label, big, onAct }: { kind: "solid" | "ghost"; label: string; big?: boolean; onAct?: () => void }) {
  const cls = `${kind}${big ? " big" : ""}`;
  return onAct ? (
    <button type="button" className={cls} onClick={onAct}>{label}</button>
  ) : (
    <a className={cls} href="/">{label}</a>
  );
}

// Layer 1 capabilities — kept tight, no fluff (Adam's brief).
const DO_NOW = [
  "Reads and understands all your project documents: drawings, specs, schedules.",
  "Answers construction questions from your documents and the Building Code.",
  "Helps write and review RFIs.",
  "Checks plans for missing or conflicting information.",
  "Runs project communication through a shared calendar.",
  "Assigns tasks, deliveries and bookings.",
];

// Layer 2 — the kind of insight the learning engine surfaces over time.
const INSIGHTS = [
  {
    tag: "62 apartment projects",
    quote: "Waterproofing penetrations fail 28% more often than any other inspection.",
  },
  {
    tag: "Pre-line inspections",
    quote: "3 in 5 fail first time on your jobs, almost always on missing back blocking.",
  },
  {
    tag: "3 years of records",
    quote: "Before ceiling inspections, check these five items: they've caused 140 defects.",
  },
];

// ─── Partner logos — SVG recreations traced from the official brand images
// (Adam, 2026-07-16): AUT Ventures peak mark, AUT outline wordmark, and the
// CISRC red network-globe with its navy background removed (transparent vector,
// text flipped dark so it reads on the light plates). ───
function LogoVentures() {
  return (
    <div className="lg">
      <svg className="av-mark" viewBox="0 0 100 88" aria-hidden="true">
        <defs>
          <linearGradient id="avgrad" x1="0" y1="0" x2="0.55" y2="1">
            <stop offset="0" stopColor="#2E9ED2" />
            <stop offset="1" stopColor="#14486B" />
          </linearGradient>
        </defs>
        {/* light-blue upstroke → gradient downstroke → green upstroke */}
        <polygon points="0,88 30,4 46,4 16,88" fill="#36B5E8" />
        <polygon points="30,4 46,4 66,62 50,62" fill="url(#avgrad)" />
        <polygon points="50,62 66,62 96,8 80,8" fill="#79BD44" />
      </svg>
      <span className="av-txt">AUT<br />VENTURES</span>
    </div>
  );
}
function LogoAUT() {
  return (
    <div className="lg">
      {/* Real AUT mark (transparent PNG lifted from the official file) */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="aut-img" src="/partners/aut.png" alt="AUT" />
    </div>
  );
}
function LogoCIS() {
  return (
    <div className="lg">
      {/* Real CISRC globe, lifted off its maroon background; text set dark for the light plate */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="cis-img" src="/partners/cisrc-globe.png" alt="" />
      <span className="cis-txt">AUT COMPUTER AND INFORMATION<br />SCIENCES RESEARCH CENTRE</span>
    </div>
  );
}

// ─── Layer 1 phone demo — a sped-up, looping construction conversation that
// shows the two sources (plans + NZ Building Code) and a calendar action.
// Facts signed off by Adam 2026-07-16. ───
type DemoTurn = { q: string; src: string | null; ans: ReactNode; cite?: { code: string; sub: string }; tag?: string };
const DEMO_TURNS: DemoTurn[] = [
  {
    q: "What's the fire rating on the exterior doors?",
    src: "From your plans",
    ans: <><b>FRR 60</b>, fire-rated 60 minutes. Leaf 910 × 2240 × 48&nbsp;mm.</>,
    cite: { code: "ED003 · Door Schedule", sub: "95% Detail Design · p60/85" },
  },
  {
    q: "Does the code need a cavity behind the weatherboards?",
    src: "From the NZ Building Code",
    ans: <><b>E2/AS1</b> calls for a drained cavity behind absorbent claddings like weatherboard. Confirm with your designer.</>,
    cite: { code: "E2/AS1 · External Moisture", sub: "NZ Building Code" },
  },
  {
    q: "Book the pre-line inspection for Tuesday 9am.",
    src: null,
    ans: <>Booked. <b>Pre-line inspection, Tue 9:00 AM.</b> Crew notified.</>,
    tag: "✓ Added to the shared calendar",
  },
];

// ─── Layer 3 model — an isometric structural-frame building (floor slabs +
// columns), so it reads as an actual building model rather than a plain box. ───
function FrameBuilding() {
  const hd = 55, t = 7, gap = 34;
  const cyOf = (k: number) => 135 + gap * k;
  const cols: [number, number, number, number][] = [
    [120, 135, 271, 6], [340, 135, 271, 6], [230, 190, 326, 6],
    [175, 162.5, 298.5, 4], [285, 162.5, 298.5, 4],
  ];
  const floors = [4, 3, 2, 1, 0].map(cyOf); // draw bottom → top for correct overlap
  return (
    <svg className="iso" viewBox="0 0 460 380" aria-hidden="true">
      <defs>
        <linearGradient id="fbTop" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#EFF4FA" /><stop offset="1" stopColor="#DBE6F1" /></linearGradient>
      </defs>
      <ellipse cx="230" cy="340" rx="130" ry="19" fill="rgba(12,42,71,.12)" />
      <g className="bld">
        <g stroke="#8397AC" strokeLinecap="round" fill="none">
          {cols.map(([x, y1, y2, w], i) => <line key={i} x1={x} y1={y1} x2={x} y2={y2} strokeWidth={w} />)}
        </g>
        {floors.map((cy, i) => (
          <g key={i}>
            <path d={`M120 ${cy} L230 ${cy + hd} L230 ${cy + hd + t} L120 ${cy + t} Z`} fill="#B4C2D3" />
            <path d={`M230 ${cy + hd} L340 ${cy} L340 ${cy + t} L230 ${cy + hd + t} Z`} fill="#A2B2C6" />
            <polygon points={`230,${cy - hd} 340,${cy} 230,${cy + hd} 120,${cy}`} fill="url(#fbTop)" stroke="#ffffff" strokeWidth="1" />
          </g>
        ))}
      </g>
    </svg>
  );
}

function ChatDemo() {
  // 3 frames per turn: 0 = question in, 1 = typing dots, 2 = answer.
  const [f, setF] = useState(0);
  useEffect(() => {
    const delays = [1000, 1100, 2800, 1000, 1100, 2800, 1000, 1100, 2800];
    const id = setTimeout(() => setF((x) => (x + 1) % delays.length), delays[f]);
    return () => clearTimeout(id);
  }, [f]);
  const turn = Math.floor(f / 3);
  const stage = f % 3;
  const t = DEMO_TURNS[turn];
  return (
    <div className="phone">
      <div className="ph-top"><span className="ph-cam" /></div>
      <div className="ph-screen">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <div className="ph-bar"><img src="/logo-mark.png" alt="" /><b>1 Arthur Road</b></div>
        <div className="chat">
          <div className="q pop" key={`q${turn}`}>{t.q}</div>
          {stage === 1 && <div className="dots pop"><i /><i /><i /></div>}
          {stage === 2 && (
            <div className="a pop" key={`a${turn}`}>
              {t.src && <div className="a-src">{t.src}</div>}
              <p>{t.ans}</p>
              {t.cite && (
                <div className="cite"><span className="ci">▦</span><span className="ct"><b>{t.cite.code}</b><small>{t.cite.sub}</small></span></div>
              )}
              {t.tag && <div className="cal-ok">{t.tag}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Landing({ onLogin, onGetStarted }: { onLogin?: () => void; onGetStarted?: () => void }) {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.16 }
    );
    document.querySelectorAll(".lp .rv").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" />
          <span>Soterra</span>
        </div>
        <nav className="links">
          <a href="#now">What it does</a>
          <a href="#vision">The vision</a>
          <a href="#safe">Why it&apos;s safe</a>
        </nav>
        <div className="navcta">
          <Cta kind="ghost" label="Log in" onAct={onLogin} />
          <Cta kind="solid" label="Get set up" onAct={onGetStarted} />
        </div>
      </header>

      {/* ─── HERO — deliberately simple ─── */}
      <section className="hero">
        <div className="pill rv in"><span className="dotlive" /> AI project assistant + company learning engine</div>
        <h1 className="rv in">Turning construction data into <span className="g">company intelligence.</span></h1>
        <p className="lead rv in">
          An AI assistant that knows your whole project today, and a learning engine that captures
          knowledge from every project to reduce mistakes on the next one.
        </p>
        <div className="cta rv in">
          <Cta kind="solid" big label="Get set up" onAct={onGetStarted} />
          <Cta kind="ghost" big label="Log in" onAct={onLogin} />
        </div>
        <div className="trust rv in">✓ Every answer cited to your actual drawings, never guessed</div>
      </section>

      {/* ─── PARTNERS ─── */}
      <section className="partners rv">
        <div className="pk">Built in partnership with</div>
        <div className="prow">
          <div className="plate"><LogoVentures /></div>
          <div className="plate wide"><LogoCIS /></div>
          <div className="plate"><LogoAUT /></div>
        </div>
      </section>

      {/* ─── LAYER 1 — what it does today ─── */}
      <section className="layer" id="now">
        <div className="lhead rv">
          <div className="lbadge"><span>Layer 1</span> The project assistant</div>
          <h2>Run your projects with <span className="g">Soterra.</span></h2>
        </div>

        <div className="frow rv">
          <div className="ftext">
            <div className="fk">Answers from your plans</div>
            <h3>Soterra understands your drawings, specifications and project documents, so your team spends less time searching and more time building.</h3>
            <p>Fire ratings, GIB specs, beam sizes and setouts are answered in seconds, with references to the exact sheet.</p>
          </div>
          <div className="fvis">
            <ChatDemo />
          </div>
        </div>

        <div className="frow rev rv">
          <div className="ftext">
            <div className="fk">Run the site</div>
            <h3>Inspections, deliveries and pours, booked from one chat.</h3>
            <p>Just say it, &ldquo;pre-line inspection Tuesday 9am&rdquo;, and it&apos;s on the shared calendar with the crew notified. Nothing slips, nobody double-books.</p>
          </div>
          <div className="fvis">
            <div className="tablet cal">
              <div className="cal-h">This week</div>
              <div className="cal-row"><span className="cal-d">Mon</span><span className="cal-ev b">Steel delivery · 7:30</span></div>
              <div className="cal-row"><span className="cal-d">Tue</span><span className="cal-ev a">Council inspection · 9:00</span></div>
              <div className="cal-row"><span className="cal-d">Wed</span><span className="cal-ev" /></div>
              <div className="cal-row"><span className="cal-d">Thu</span><span className="cal-ev g">Blocklayers on site</span></div>
              <div className="cal-row"><span className="cal-d">Fri</span><span className="cal-ev p">Slab pour · 6 crew</span></div>
            </div>
          </div>
        </div>

        <ul className="bullets rv">
          {DO_NOW.map((b, i) => (
            <li key={i}><span className="bx">✓</span>{b}</li>
          ))}
        </ul>
      </section>

      {/* ─── LAYER 2 — the learning engine (the vision) ─── */}
      <section className="vision" id="vision">
        <div className="vhead rv">
          <div className="lbadge dark"><span>Layer 2</span> The learning engine</div>
          <h2>It learns your history to predict and prevent mistakes <span className="g">before they happen.</span></h2>
          <p>Soterra learns from your previous projects, using the project data you already have, reliable council and consultant QA, to prevent rework and delays before they repeat.</p>
        </div>

        <div className="insights rv">
          {INSIGHTS.map((it, i) => (
            <div key={i} className="ins" style={cvar({ "--d": `${i * 110}ms` })}>
              <div className="ins-tag">{it.tag}</div>
              <p className="ins-q">&ldquo;{it.quote}&rdquo;</p>
            </div>
          ))}
        </div>

      </section>

      {/* ─── LAYER 3 — plans + code + history in one model ─── */}
      <section className="layer3" id="together">
        <div className="l3-copy rv">
          <div className="lbadge"><span>Layer 3</span> One connected model</div>
          <h2>Your history, your live plans and the Building Code, <span className="g">together in one AI.</span></h2>
          <p>This is where Soterra is heading: everything it knows becomes one model your whole crew can question. It answers from your live drawings, checks against the Building Code, and warns you with what every past project has taught it.</p>
          <div className="rnd"><span className="rnd-dot" /> In active development with AUT&apos;s research centre · 2 masters theses in progress</div>
        </div>
        <div className="l3-vis rv">
          <FrameBuilding />
        </div>
      </section>

      {/* ─── SAFE ─── */}
      <section className="safe" id="safe">
        <div className="rv">
          <div className="safe-tick" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path d="M20 6 9 17l-5-5" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
          <div className="fk center">Safe to use on site</div>
          <h2>Every answer is backed by your project.</h2>
          <p>Soterra only answers using your drawings, specifications and approved references. Every response links back to the exact document, so you always know where the information came from.</p>
        </div>
      </section>

      {/* ─── FINAL ─── */}
      <section className="final rv">
        <h2>Put your whole project to work.</h2>
        <p>Set up your company and get the crew asking in minutes.</p>
        <Cta kind="solid" big label="Get set up →" onAct={onGetStarted} />
      </section>

      <footer className="foot">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" /><span>Soterra</span>
        </div>
        <span>Turning construction data into company intelligence.</span>
      </footer>
    </div>
  );
}

const CSS = `
.lp{--brand:#0E8FE6;--brand-d:#0A78C8;--navy:#0C2A47;--ink:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F6FAFF;--line:#E7EFF9;--line2:#EEF4FB;--grad:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);--green:#10B981;--amber:#F59E0B;--purple:#8B5CF6;color:var(--ink);font-family:var(--font);min-height:100vh;overflow-x:hidden;background:
  radial-gradient(760px 420px at 82% -6%,rgba(65,195,255,.12),transparent 62%),
  radial-gradient(680px 420px at 0% 0%,rgba(10,141,237,.05),transparent 55%),var(--bg)}
.lp *{box-sizing:border-box}
.lp .g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp a{text-decoration:none}
.lp button{font-family:var(--font);cursor:pointer;border:none;background:transparent;color:inherit}
.lp .rv{opacity:0;transform:translateY(22px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.lp .rv.in{opacity:1;transform:none}
.lp .dotlive{width:7px;height:7px;border-radius:50%;background:var(--green);display:inline-block;box-shadow:0 0 0 0 rgba(16,185,129,.5);animation:lpp 2s infinite}
@keyframes lpp{0%{box-shadow:0 0 0 0 rgba(16,185,129,.45)}70%{box-shadow:0 0 0 7px rgba(16,185,129,0)}100%{box-shadow:0 0 0 0 rgba(16,185,129,0)}}
/* nav */
.lp .nav{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:30px;padding:16px 7vw;background:rgba(246,250,255,.75);backdrop-filter:blur(14px);border-bottom:1px solid var(--line2)}
.lp .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;letter-spacing:-.01em}
.lp .brand img{height:28px;width:auto}
.lp .links{display:flex;gap:26px;flex:1}
.lp .links a{color:var(--slate);font-size:14px;font-weight:500}
.lp .links a:hover{color:var(--navy)}
.lp .navcta{display:flex;gap:10px}
.lp .ghost{color:var(--navy);font-size:14px;font-weight:600;padding:9px 17px;border:1px solid var(--line);border-radius:11px;background:#fff}
.lp .ghost:hover{border-color:var(--brand)}
.lp .solid{background:var(--grad);color:#fff;font-size:14px;font-weight:600;padding:10px 18px;border-radius:11px;box-shadow:0 10px 26px rgba(10,141,237,.28)}
.lp .solid:hover{filter:brightness(1.05)}
.lp .big{padding:15px 28px;font-size:15px;border-radius:13px}
/* hero - simple, centered */
.lp .hero{max-width:900px;margin:0 auto;padding:70px 7vw 40px;text-align:center;display:flex;flex-direction:column;align-items:center}
.lp .pill{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--brand-d);background:rgba(14,143,230,.07);border:1px solid rgba(14,143,230,.16);padding:8px 15px;border-radius:30px;margin-bottom:26px}
.lp h1{font-size:clamp(38px,6vw,68px);line-height:1.04;letter-spacing:-.038em;font-weight:300;margin-bottom:24px;max-width:14ch}
.lp h1 .g{font-weight:700}
.lp .lead{font-size:19px;line-height:1.6;color:var(--slate);max-width:620px;margin-bottom:32px}
.lp .lead b{color:var(--navy);font-weight:600}
.lp .cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:20px}
.lp .trust{font-size:13.5px;color:var(--mut);font-weight:500}
/* partners */
.lp .partners{max-width:1000px;margin:0 auto;padding:24px 7vw 52px;text-align:center}
.lp .pk{font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mut);margin-bottom:20px}
.lp .prow{display:flex;gap:16px;justify-content:center;align-items:stretch;flex-wrap:wrap}
.lp .plate{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 24px;min-height:78px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(12,42,71,.05)}
.lp .lg{display:flex;align-items:center;gap:12px}
.lp .av-mark{width:46px;height:40px;flex-shrink:0}
.lp .av-txt{font-size:14px;line-height:1.16;font-weight:800;color:#4D5F6E;letter-spacing:.07em;text-align:left;align-self:flex-end;padding-bottom:2px}
.lp .aut-img{height:48px;width:auto;display:block}
.lp .cis-img{width:42px;height:42px;flex-shrink:0}
.lp .cis-txt{font-size:10.5px;line-height:1.35;color:#243B4A;text-align:left;font-weight:800;letter-spacing:.02em}
/* layer sections */
.lp .layer{max-width:1120px;margin:0 auto;padding:40px 7vw 20px}
.lp .lhead{text-align:center;max-width:840px;margin:0 auto 48px}
.lp .lhead h2{font-size:clamp(27px,3.6vw,42px);font-weight:600;letter-spacing:-.028em;line-height:1.14;margin-bottom:0}
.lp .lbadge{display:inline-flex;align-items:center;gap:14px;font-size:24px;font-weight:700;color:var(--navy);margin-bottom:20px;letter-spacing:-.015em}
.lp .lbadge span{font-size:16px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fff;background:var(--grad);padding:10px 19px;border-radius:24px;box-shadow:0 9px 22px rgba(10,141,237,.32)}
.lp .lbadge.dark span{background:var(--navy);box-shadow:0 9px 22px rgba(12,42,71,.34)}
.lp .vhead h2,.lp .safe h2{font-size:clamp(27px,3.6vw,42px);font-weight:600;letter-spacing:-.028em;line-height:1.13;margin-bottom:15px}
.lp .lhead>p,.lp .vhead>p{font-size:17px;line-height:1.62;color:var(--slate)}
.lp .frow{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center;margin-bottom:56px}
.lp .frow.rev .ftext{order:2}
.lp .fk{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-d);margin-bottom:14px}
.lp .fk.center{text-align:center}
.lp .ftext h3{font-size:clamp(22px,2.6vw,30px);font-weight:600;letter-spacing:-.022em;line-height:1.18;margin-bottom:14px}
.lp .ftext>p{font-size:16px;line-height:1.64;color:var(--slate)}
.lp .fvis{display:flex;justify-content:center}
/* phone */
.lp .phone{width:270px;background:#fff;border:1px solid var(--line);border-radius:34px;box-shadow:0 40px 80px rgba(12,42,71,.16),0 8px 22px rgba(12,42,71,.06);padding:12px 12px 20px;animation:lpfloat 6s ease-in-out infinite}
.lp .ph-top{display:flex;justify-content:center;padding:4px 0 12px}
.lp .ph-cam{width:52px;height:6px;border-radius:6px;background:#E4ECF6}
.lp .ph-screen{background:var(--bg);border-radius:22px;padding:14px 13px;min-height:390px}
.lp .ph-bar{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--slate);margin-bottom:16px}
.lp .ph-bar img{height:18px}.lp .ph-bar b{color:var(--navy)}
.lp .q{margin-left:auto;width:fit-content;max-width:88%;background:var(--grad);color:#fff;font-size:12.5px;font-weight:500;padding:10px 13px;border-radius:14px 14px 4px 14px;box-shadow:0 8px 18px rgba(10,141,237,.28)}
.lp .dots{margin-top:12px;width:fit-content;display:inline-flex;gap:5px;background:#fff;border:1px solid var(--line);padding:10px 13px;border-radius:12px}
.lp .dots i{width:6px;height:6px;border-radius:50%;background:#A9C9E8;animation:lpb 1.2s infinite}
.lp .dots i:nth-child(2){animation-delay:.15s}.lp .dots i:nth-child(3){animation-delay:.3s}
@keyframes lpb{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.lp .a{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:13px 14px;box-shadow:0 6px 18px rgba(12,42,71,.06)}
.lp .a-src{font-size:9.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-d);margin-bottom:7px}
.lp .a p{font-size:12.5px;line-height:1.5;color:var(--slate)}.lp .a p b{color:var(--navy)}
.lp .cite{margin-top:11px;display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:11px;padding:9px 10px;background:linear-gradient(180deg,rgba(65,195,255,.05),transparent)}
.lp .cite .ci{width:30px;height:30px;border-radius:8px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:14px;flex-shrink:0}
.lp .cite .ct{min-width:0}.lp .cite .ct b{display:block;font-size:11.5px;color:var(--navy)}.lp .cite .ct small{font-size:10.5px;color:var(--mut)}
@keyframes lpfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
.lp .chat{min-height:312px}
.lp .pop{animation:lppop .38s cubic-bezier(.2,.7,.2,1)}
@keyframes lppop{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}
.lp .cal-ok{margin-top:11px;font-size:11.5px;font-weight:600;color:var(--green);background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.22);border-radius:10px;padding:8px 11px}
/* tablet / calendar */
.lp .tablet{width:100%;max-width:400px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 30px 66px rgba(12,42,71,.1)}
.lp .tablet.cal{padding:20px 20px 8px}
.lp .cal-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-bottom:14px}
.lp .cal-row{display:flex;align-items:center;gap:14px;padding:7px 0}
.lp .cal-d{font-size:11px;font-weight:700;color:var(--slate);width:32px;text-transform:uppercase}
.lp .cal-ev{flex:1;min-height:34px;display:flex;align-items:center;padding:0 13px;font-size:13px;color:var(--navy);background:var(--bg);border:1px solid var(--line);border-radius:9px}
.lp .cal-ev.b{border-left:3px solid var(--brand)}.lp .cal-ev.a{border-left:3px solid var(--amber)}.lp .cal-ev.g{border-left:3px solid var(--green)}.lp .cal-ev.p{border-left:3px solid var(--purple)}
/* bullets */
.lp .bullets{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:14px 34px;max-width:900px;margin:8px auto 0;padding:0}
.lp .bullets li{display:flex;gap:12px;font-size:15.5px;line-height:1.5;color:var(--navy);align-items:flex-start}
.lp .bx{flex-shrink:0;width:22px;height:22px;border-radius:7px;background:rgba(14,143,230,.1);color:var(--brand-d);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;margin-top:1px}
/* vision / layer 2 */
.lp .vision{max-width:1120px;margin:0 auto;padding:60px 7vw}
.lp .vhead{text-align:center;max-width:700px;margin:0 auto 40px}
.lp .insights{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-bottom:26px}
.lp .ins{background:linear-gradient(180deg,#0C2A47,#0A2038);color:#fff;border-radius:18px;padding:24px 22px;box-shadow:0 20px 50px rgba(12,42,71,.22);opacity:0;transform:translateY(16px)}
.lp .rv.in .ins{animation:lprise .7s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:var(--d)}
.lp .ins-tag{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#5FD0FF;margin-bottom:14px}
.lp .ins-q{font-size:16.5px;line-height:1.5;font-weight:500;color:#EAF4FF}
.lp .vnote{text-align:center;font-size:16px;color:var(--slate);max-width:620px;margin:0 auto 20px}
.lp .vnote{font-weight:500}
/* bim */
.lp .bim{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center;margin-top:40px}
.lp .bim-copy h3{font-size:clamp(22px,2.6vw,30px);font-weight:600;letter-spacing:-.022em;line-height:1.18;margin-bottom:14px}
.lp .bim-copy>p{font-size:16px;line-height:1.64;color:var(--slate);margin-bottom:20px}
.lp .rnd{display:inline-flex;align-items:center;gap:9px;font-size:13px;font-weight:500;color:var(--brand-d);background:rgba(14,143,230,.06);border:1px solid rgba(14,143,230,.14);padding:9px 14px;border-radius:11px;line-height:1.4}
.lp .rnd-dot{width:8px;height:8px;border-radius:50%;background:var(--green);flex-shrink:0;box-shadow:0 0 0 0 rgba(16,185,129,.5);animation:lpp 2s infinite}
.lp .bim-vis{position:relative}
.lp .iso{display:block;width:100%;height:auto;overflow:visible}
.lp .floor-shadow{position:absolute;left:50%;bottom:8%;width:60%;height:40px;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(12,42,71,.14),transparent 70%);filter:blur(3px)}
.lp .bld{opacity:0}
.lp .rv.in .bld{animation:lprise2 1s ease .15s forwards}
@keyframes lprise{to{opacity:1;transform:none}}
@keyframes lprise2{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
.lp .face{stroke:#fff;stroke-width:1;stroke-linejoin:round}
.lp .ft{fill:#BFE2FF}.lp .fl{fill:#1683DC}.lp .fr{fill:#3FA7F0}
.lp .fln{stroke:rgba(255,255,255,.5);stroke-width:1;opacity:0}
.lp .rv.in .fln{animation:lpshow .5s ease forwards}
.lp .rv.in .fln.f1{animation-delay:.7s}.lp .rv.in .fln.f2{animation-delay:.85s}.lp .rv.in .fln.f3{animation-delay:1s}
.lp .mul{stroke:rgba(255,255,255,.28);stroke-width:1}
@keyframes lpshow{to{opacity:1}}
.lp .pin{opacity:0}.lp .rv.in .pin{animation:lpshow .4s ease forwards}
.lp .rv.in .pin.p1{animation-delay:1.2s}.lp .rv.in .pin.p2{animation-delay:1.4s}.lp .rv.in .pin.p3{animation-delay:1.6s}
.lp .pin .dot{fill:#0A8DED;stroke:#fff;stroke-width:2}
.lp .pin .halo{fill:rgba(10,141,237,.22);transform-box:fill-box;transform-origin:center;animation:lphalo 2.2s ease-out infinite}
@keyframes lphalo{0%{transform:scale(.5);opacity:.6}80%{transform:scale(1.7);opacity:0}100%{opacity:0}}
.lp .bim-tip{position:absolute;right:4%;top:16%;width:185px;background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px 14px;box-shadow:0 18px 44px rgba(12,42,71,.16);opacity:0}
.lp .rv.in .bim-tip{animation:lptip .6s ease 1.5s forwards,lpfloat 5s ease-in-out 2s infinite}
.lp .bim-tip p{font-size:14px;color:var(--slate)}.lp .bim-tip p b{color:var(--navy);font-weight:700}
.lp .bim-tip small{font-size:11.5px;color:var(--mut);font-family:ui-monospace,'SF Mono',Menlo,monospace}
@keyframes lptip{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
/* layer 3 */
.lp .layer3{display:grid;grid-template-columns:1fr 1.05fr;gap:50px;align-items:center;max-width:1120px;margin:0 auto;padding:20px 7vw 60px}
.lp .l3-copy h2{font-size:clamp(24px,3vw,34px);font-weight:600;letter-spacing:-.025em;line-height:1.16;margin-bottom:15px}
.lp .l3-copy>p{font-size:16px;line-height:1.64;color:var(--slate);margin-bottom:20px}
.lp .l3-vis{position:relative}
.lp .l3wire line{stroke:var(--mut);stroke-width:1.4;stroke-dasharray:3 3}
.lp .l3pindot circle{fill:#fff;stroke:var(--brand);stroke-width:2}
.lp .l3chip rect{fill:#fff;stroke:var(--line);stroke-width:1}
.lp .l3chip text{font-size:13px;font-weight:600;fill:var(--navy);font-family:var(--font)}
/* safe */
.lp .safe{max-width:760px;margin:0 auto;padding:40px 7vw 30px;text-align:center}
.lp .safe-tick{width:58px;height:58px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;margin:0 auto 22px;box-shadow:0 12px 30px rgba(10,141,237,.32)}
.lp .safe-tick svg{width:30px;height:30px}
.lp .safe p{font-size:17px;line-height:1.7;color:var(--slate);max-width:600px;margin:0 auto}
/* final */
.lp .final{text-align:center;max-width:720px;margin:0 auto;padding:50px 7vw 90px}
.lp .final h2{font-size:clamp(28px,3.8vw,44px);font-weight:300;letter-spacing:-.03em;margin-bottom:14px}
.lp .final p{font-size:17px;color:var(--slate);margin-bottom:28px}
.lp .foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;max-width:1240px;margin:0 auto;padding:28px 7vw;border-top:1px solid var(--line)}
.lp .foot .brand{font-size:16px}.lp .foot .brand img{height:22px}
.lp .foot>span{font-size:13px;color:var(--mut)}
@media(max-width:900px){
  .lp .links{display:none}
  .lp .frow{grid-template-columns:1fr;gap:32px;margin-bottom:44px}
  .lp .frow.rev .ftext{order:0}
  .lp .bullets{grid-template-columns:1fr;gap:12px}
  .lp .insights{grid-template-columns:1fr}
  .lp .bim{grid-template-columns:1fr;gap:32px}
  .lp .layer3{grid-template-columns:1fr;gap:28px}
  .lp .prow{gap:12px}
}
`;
