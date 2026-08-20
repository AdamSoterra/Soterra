"use client";
import { useState } from "react";

// Soterra public landing — product-first rebuild (2026-08-20).
// Flow: hero (calm) → what it does (the assistant) → how it works (3 sources
// into one sealed AI) → the proof (trackers) → why now (liability) → team → CTA.
// Rendered as the signed-out front page from app/page.tsx with Clerk handlers,
// and at /preview/command with none (buttons become no-ops there). All styles
// are scoped under .lp so nothing leaks into the app.

export default function Landing({ onLogin, onGetStarted }: { onLogin?: () => void; onGetStarted?: () => void }) {
  const [menu, setMenu] = useState(false);
  const go = () => onGetStarted?.();
  const login = () => onLogin?.();

  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Soterra" /><span>Soterra</span>
        </div>
        <nav className="links">
          <a href="#assistant">What it does</a>
          <a href="#how">How it works</a>
          <a href="#why">Why now</a>
          <a href="/team">Team</a>
        </nav>
        <div className="navcta">
          <button className="ghost" onClick={login}>Log in</button>
          <button className="solid" onClick={go}>Get set up</button>
        </div>
        <button className="burger" onClick={() => setMenu((o) => !o)} aria-label="Menu" aria-expanded={menu}>
          {menu ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 7h18M3 12h18M3 17h18" /></svg>
          )}
        </button>
      </header>
      {menu && (
        <div className="msheet">
          <a href="#assistant" onClick={() => setMenu(false)}>What it does</a>
          <a href="#how" onClick={() => setMenu(false)}>How it works</a>
          <a href="#why" onClick={() => setMenu(false)}>Why now</a>
          <a href="/team" onClick={() => setMenu(false)}>Team</a>
          <div className="msheet-cta">
            <button className="ghost" onClick={() => { setMenu(false); login(); }}>Log in</button>
            <button className="solid" onClick={() => { setMenu(false); go(); }}>Get set up</button>
          </div>
        </div>
      )}

      {/* HERO — calm, subtle motion */}
      <section className="hero">
        <div className="mesh" /><div className="grid" />
        <h1>Turning construction data into <span className="g">company intelligence.</span></h1>
        <div className="cta">
          <button className="solid" onClick={go}>Get set up</button>
          <button className="ghost" onClick={login}>Log in</button>
          <a className="ghost instbtn" href="/install">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.6" /><line x1="10.5" y1="18.5" x2="13.5" y2="18.5" /></svg>
            Install
          </a>
        </div>
        <div className="tryfree">No access code yet? <button className="linkbtn" onClick={go}>Ask it 5 questions free →</button></div>
        <div className="partners">
          <div className="pk">Built in partnership with</div>
          <div className="prow">
            <div className="plate"><span className="lg">
              <svg className="av-mark" viewBox="0 0 100 88" aria-hidden="true">
                <defs><linearGradient id="avg" x1="0" y1="0" x2="0.55" y2="1"><stop offset="0" stopColor="#2E9ED2" /><stop offset="1" stopColor="#14486B" /></linearGradient></defs>
                <polygon points="0,88 30,4 46,4 16,88" fill="#36B5E8" />
                <polygon points="30,4 46,4 66,62 50,62" fill="url(#avg)" />
                <polygon points="50,62 66,62 96,8 80,8" fill="#79BD44" />
              </svg><span className="av-txt">AUT<br />VENTURES</span></span></div>
            <div className="plate cisp"><span className="lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/partners/cisrc-globe.png" alt="" /><span className="cis-txt">AUT COMPUTER AND INFORMATION SCIENCES RESEARCH CENTRE</span></span></div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <div className="plate"><img className="autimg" src="/partners/aut.png" alt="AUT" /></div>
          </div>
        </div>
      </section>

      {/* WHAT IT DOES — the assistant */}
      <section className="band" id="assistant">
        <div className="center">
          <div className="kick">The assistant</div>
          <h2>It helps prevent rework and the delays that come with it, <span className="g">before the job and while it&apos;s underway.</span></h2>
          <p className="lead">The same assistant works both ends of the job.</p>
        </div>

        <div className="frow">
          <div className="ftext">
            <div className="fk">Before · catch the gaps</div>
            <h3>It reads your specs, PS1s and drawings, and flags what doesn&apos;t line up.</h3>
            <p>Contradictions between the spec, the PS1 and the architectural drawings. Gaps in the scope. Missing information. Soterra finds them before they become a variation.</p>
          </div>
          <div className="fvis">
            <div className="card">
              <div className="card-h">🔍 Gap check · Level 4 lining</div>
              <div className="card-b">
                <div className="gap-row"><span className="gap-doc">Spec (§9.4)</span><span className="gap-val">13mm fire-rated GIB to garage ceiling</span></div>
                <div className="gap-row"><span className="gap-doc">Arch A-210</span><span className="gap-val">10mm standard board noted</span></div>
                <div className="gap-row"><span className="gap-doc">Fire report</span><span className="gap-val">System requires 1× 13mm min.</span></div>
                <div className="flagrow"><span className="flagpill">Conflict</span><p>Drawing understates the spec and the fire report. Raise before lining, or it fails the fire inspection.</p></div>
              </div>
            </div>
          </div>
        </div>

        <div className="frow rev">
          <div className="ftext">
            <div className="fk">During · answer anything</div>
            <h3>Ask about any detail and get an answer cited to the exact page.</h3>
            <p>Your plans, the Building Code, a Standard or the manufacturer&apos;s manual: Soterra answers from whichever one governs, and links straight to the page it came from. No hunting through the drawing set.</p>
          </div>
          <div className="fvis">
            <div className="phone">
              <div className="pbar"><span className="pmark" /><b>43 Kauri Road</b></div>
              <div className="pbody">
                <div className="q">Do we need a cavity behind the cladding on the west wall?</div>
                <div className="a">
                  <div className="asrc">From your spec + E2/AS1</div>
                  <p><b>Yes</b>, a 20mm drained cavity on battens. Direct-fix isn&apos;t permitted in this wind zone.</p>
                  <div className="cite"><span className="ci">▦</span><span><b>Spec §8.2 · Cladding</b><small>Weathertightness · west elevation</small></span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="frow">
          <div className="ftext">
            <div className="fk">During · generate the QA that matters</div>
            <h3>Not a generic checklist. The exact checks that fail on <em>this</em> job.</h3>
            <p>Anyone can hand you a generic QA sheet and off you go. Soterra builds the sheet from this project&apos;s specs, plans and the Code, weighted by what your crew has failed before. You check what actually matters on this job, and every item says where it came from. H&amp;S plans work the same way.</p>
          </div>
          <div className="fvis">
            <div className="card qacard">
              <div className="card-h">✅ Pre-line QA · 43 Kauri Road · auto-generated</div>
              <div className="card-b qa">
                <div className="qi"><span className="qk" /><div><div className="qt">Insulation fitted tight, no gaps at dwangs</div><div className="qs hist">you failed this 6×</div></div></div>
                <div className="qi"><span className="qk" /><div><div className="qt">Building wrap lapped and taped at openings</div><div className="qs code">E2/AS1</div></div></div>
                <div className="qi"><span className="qk" /><div><div className="qt">Penetrations fire-stopped before lining</div><div className="qs code">C/AS2</div></div></div>
                <div className="qi"><span className="qk" /><div><div className="qt">Nogs in for all sheet edges and fixings</div><div className="qs">from your framing plan</div></div></div>
                <div className="qi"><span className="qk" /><div><div className="qt">Plumbing pre-line signed off</div><div className="qs">AC1229</div></div></div>
              </div>
              <div className="qafoot"><b>Every item traces to this job:</b> its specs, plans, Code or your history. Not a generic list.</div>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — convergence */}
      <section className="band cv" id="how">
        <div className="center">
          <div className="kick">How it works</div>
          <h2>Three sources of knowledge. <span className="g">One private AI.</span></h2>
          <p className="lead">Soterra brings three worlds together and seals them into an assistant that only your company can reach.</p>
        </div>
        <div className="cvgrid">
          <div className="src s1"><div className="st"><span className="sd" />Soterra base knowledge</div>
            <ul><li>NZ Building Code</li><li>Standards &amp; determinations</li><li>Manufacturer manuals</li><li>Industry best practice</li></ul></div>
          <div className="src s2"><div className="st"><span className="sd" />Your company knowledge</div>
            <ul><li>Every past project</li><li>Council inspections</li><li>Consultant inspections</li><li>Site reports</li></ul></div>
          <div className="src s3"><div className="st"><span className="sd" />This project</div>
            <ul><li>Drawings</li><li>Specifications</li><li>Schedules</li><li>PS1s, scopes &amp; reports</li></ul></div>
        </div>
        <div className="beams"><div className="beam" /><div className="beam" /><div className="beam" /></div>
        <div className="core">
          <span className="cl"><span className="lock">🔒</span> Your company&apos;s private assistant</span>
          <h3>One place to ask, check and prove.</h3>
          <p>Sealed to your company by the system. A separate space per project, access-gated, scoped to you. Your data never reaches another company.</p>
        </div>
        <p className="sec-note"><b>Your data is yours.</b> It never trains anyone else&apos;s assistant and never lands in a shared pool.</p>
      </section>

      {/* THE PROOF — trackers */}
      <section className="band pf">
        <div className="center">
          <div className="kick">The proof</div>
          <h2>It doesn&apos;t just help. <span className="g">It keeps score.</span></h2>
        </div>
        <div className="tk3">
          <div className="trk">
            <h4>RFI tracker</h4>
            <div className="tsub">Who holds the ball, and for how long.</div>
            <div className="tiles">
              <div className="tile"><b>7</b><span>open</span></div>
              <div className="tile"><b className="red">3</b><span>overdue</span></div>
              <div className="tile"><b>9 wd</b><span>avg answer</span></div>
            </div>
            <div className="scbar">
              <div className="scrow"><span className="nm">Structural</span><span className="bar"><span className="fill bad" style={{ width: "82%" }} /></span><span className="v">12 wd</span></div>
              <div className="scrow"><span className="nm">Fire</span><span className="bar"><span className="fill warn" style={{ width: "56%" }} /></span><span className="v">8 wd</span></div>
              <div className="scrow"><span className="nm">Services</span><span className="bar"><span className="fill" style={{ width: "34%" }} /></span><span className="v">5 wd</span></div>
            </div>
          </div>
          <div className="trk">
            <h4>QA close-out</h4>
            <div className="tsub">Every defect, from raised to signed off.</div>
            <div className="tiles">
              <div className="tile"><b>8</b><span>open</span></div>
              <div className="tile"><b className="grn">14</b><span>closed</span></div>
              <div className="tile"><b>6 wd</b><span>avg close</span></div>
            </div>
            <div className="scbar">
              <div className="scrow"><span className="nm">Interiors</span><span className="bar"><span className="fill bad" style={{ width: "70%" }} /></span><span className="v">6/10</span></div>
              <div className="scrow"><span className="nm">Fire sub</span><span className="bar"><span className="fill warn" style={{ width: "57%" }} /></span><span className="v">4/7</span></div>
              <div className="scrow"><span className="nm">Waterproof</span><span className="bar"><span className="fill" style={{ width: "83%" }} /></span><span className="v">5/6</span></div>
            </div>
          </div>
          <div className="trk">
            <h4>Internal QA</h4>
            <div className="tsub">Your own pre-checks, and what keeps failing.</div>
            <div className="tiles">
              <div className="tile"><b className="grn">71%</b><span>clean pass</span></div>
              <div className="tile"><b>14</b><span>checks</span></div>
              <div className="tile"><b>143</b><span>flagged</span></div>
            </div>
            <div className="scbar">
              <div className="scrow"><span className="nm">Plasterboard</span><span className="bar"><span className="fill bad" style={{ width: "90%" }} /></span><span className="v">22</span></div>
              <div className="scrow"><span className="nm">Fire-stop</span><span className="bar"><span className="fill warn" style={{ width: "58%" }} /></span><span className="v">14</span></div>
              <div className="scrow"><span className="nm">Weathertight</span><span className="bar"><span className="fill" style={{ width: "30%" }} /></span><span className="v">6</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* WHY NOW — the closer */}
      <section className="band why" id="why">
        <div className="center">
          <div className="kick">Why now</div>
          <h2>QA has never mattered <span className="g">more.</span></h2>
          <p className="lead">New Zealand is shifting more liability onto the people who build. When something fails, the only protection is proof you did it right. Soterra builds each QA check from this job&apos;s own specs, plans, Code and history, to make sure you check the things that actually matter.</p>
        </div>
        <div className="stats">
          <div className="stat"><b className="g">$2.5B</b><span>a year lost to defects in NZ residential construction</span></div>
          <div className="stat"><b>90%+</b><span>of NZ construction firms have hit project delays</span></div>
          <div className="stat"><b>~30%</b><span>of construction work can be rework</span></div>
        </div>
      </section>

      {/* TEAM strip */}
      <section className="band tight team center" id="team">
        <div className="kick">The team</div>
        <h2 className="th">Built in Aotearoa, with AUT.</h2>
        <div className="tstrip"><div className="tavs">
          <div className="tav">AD</div><div className="tav">ML</div><div className="tav">FM</div><div className="tav">FK</div><div className="tav">KM</div>
        </div></div>
        <a className="tlink" href="/team">Meet the team →</a>
      </section>

      {/* FINAL CTA */}
      <section className="final">
        <h2>Put your whole project <span className="g">to work.</span></h2>
        <p className="lead">Set up your company and get the crew asking in minutes.</p>
        <div className="cta" style={{ justifyContent: "center" }}>
          <button className="solid" onClick={go}>Get set up →</button>
          <button className="ghost" onClick={go}>Ask it 5 questions free</button>
        </div>
      </section>

      <footer className="foot">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" /><span>Soterra</span>
        </div>
        <div className="fl"><a href="#assistant">What it does</a><a href="#how">How it works</a><a href="#why">Why now</a><a href="/team">Team</a></div>
        <div className="fcopy">Turning construction data into company intelligence.</div>
      </footer>
    </div>
  );
}

const CSS = `
.lp{--brand:#0E8FE6;--brand-d:#0A78C8;--navy:#0C2A47;--ink:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F6FAFF;--line:#E7EFF9;--line2:#EEF4FB;--grad:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);--green:#10B981;--amber:#F59E0B;--purple:#8B5CF6;--red:#EF4444;
  font-family:var(--font,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif);color:var(--ink);line-height:1.5;min-height:100vh;overflow-x:hidden;
  background:radial-gradient(760px 420px at 82% -6%,rgba(65,195,255,.12),transparent 62%),radial-gradient(680px 420px at 0% 0%,rgba(10,141,237,.05),transparent 55%),var(--bg)}
.lp *{box-sizing:border-box;margin:0;padding:0}
.lp a{text-decoration:none;color:inherit}
.lp button{font-family:inherit;cursor:pointer;border:none;background:transparent;color:inherit}
.lp .g{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp h1,.lp h2,.lp h3{color:var(--navy);text-wrap:balance}
.lp .kick{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand-d)}
.lp .lead{color:var(--slate)}
/* nav */
.lp .nav{position:sticky;top:0;z-index:40;display:flex;align-items:center;gap:28px;padding:14px 7vw;background:rgba(246,250,255,.8);backdrop-filter:blur(14px);border-bottom:1px solid var(--line2)}
.lp .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:var(--navy);letter-spacing:-.01em}
.lp .brand img{height:29px;width:auto;display:block}
.lp .links{display:flex;gap:24px;flex:1;font-size:14px;color:var(--slate);font-weight:500}
.lp .links a:hover{color:var(--navy)}
.lp .navcta{display:flex;gap:10px}
.lp .burger{display:none;color:var(--navy);padding:6px}
.lp .msheet{display:none}
.lp .ghost{color:var(--navy);font-size:13.5px;font-weight:600;padding:9px 16px;border:1px solid var(--line);border-radius:11px;background:#fff}
.lp .ghost:hover{border-color:var(--brand)}
.lp .solid{background:var(--grad);color:#fff;font-size:13.5px;font-weight:600;padding:10px 17px;border-radius:11px;box-shadow:0 10px 24px rgba(10,141,237,.28)}
.lp .solid:hover{filter:brightness(1.05)}
/* hero */
.lp .hero{position:relative;min-height:82vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px 7vw 46px;overflow:hidden}
.lp .hero .mesh{position:absolute;inset:0;z-index:0;background:radial-gradient(460px 320px at 22% 34%,rgba(65,195,255,.14),transparent 60%),radial-gradient(500px 340px at 80% 66%,rgba(10,141,237,.10),transparent 60%);animation:lpmesh 14s ease-in-out infinite}
@keyframes lpmesh{0%,100%{transform:translate(0,0)}50%{transform:translate(-16px,-12px)}}
.lp .hero .grid{position:absolute;inset:-2px;z-index:0;opacity:.42;background-image:linear-gradient(rgba(14,143,230,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(14,143,230,.08) 1px,transparent 1px);background-size:42px 42px;animation:lpgrid 22s linear infinite;-webkit-mask-image:radial-gradient(circle at 50% 42%,#000 60%,transparent 100%);mask-image:radial-gradient(circle at 50% 42%,#000 60%,transparent 100%)}
@keyframes lpgrid{to{background-position:42px 42px}}
.lp .hero h1{position:relative;z-index:2;font-weight:300;font-size:clamp(38px,6vw,70px);line-height:1.03;letter-spacing:-.04em;max-width:15ch}
.lp .hero h1 .g{font-weight:700}
.lp .cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;position:relative;z-index:2;margin-top:34px}
.lp .cta .solid,.lp .cta .ghost{padding:12px 20px;font-size:14.5px;border-radius:12px}
.lp .cta .instbtn{color:var(--brand-d);border-color:rgba(14,143,230,.32);display:inline-flex;align-items:center;gap:7px;background:#fff}
.lp .tryfree{position:relative;z-index:2;margin-top:16px;font-size:13.5px;color:var(--slate)}
.lp .linkbtn{color:var(--brand-d);font-weight:600;font-size:13.5px;border-bottom:1px solid rgba(14,143,230,.4);border-radius:0;padding:0}
/* partners */
.lp .partners{position:relative;z-index:2;margin-top:44px;display:flex;flex-direction:column;align-items:center;gap:16px}
.lp .pk{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--mut)}
.lp .prow{display:flex;gap:14px;justify-content:center;align-items:stretch;flex-wrap:wrap}
.lp .plate{background:#fff;border:1px solid var(--line);border-radius:14px;padding:14px 22px;min-height:76px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 24px rgba(12,42,71,.05)}
.lp .plate .autimg{height:46px;width:auto;display:block}
.lp .plate.cisp img{height:42px;width:auto;display:block}
.lp .lg{display:flex;align-items:center;gap:12px}
.lp .av-mark{width:46px;height:40px;flex-shrink:0}
.lp .av-txt{font-size:14px;line-height:1.16;font-weight:800;color:#4D5F6E;letter-spacing:.07em;text-align:left}
.lp .cis-txt{font-size:10.5px;line-height:1.35;color:#243B4A;text-align:left;font-weight:800;letter-spacing:.02em;max-width:150px}
/* section shell */
.lp .band{position:relative;max-width:1120px;margin:0 auto;padding:74px 7vw}
.lp .band.tight{padding:56px 7vw}
.lp .center{text-align:center;max-width:760px;margin:0 auto}
.lp .center h2{font-size:clamp(27px,3.6vw,42px);font-weight:600;letter-spacing:-.028em;line-height:1.14;margin:14px 0 14px}
.lp .center .lead{font-size:17px;line-height:1.62}
/* why + stats */
.lp .why{background:linear-gradient(180deg,#fff,rgba(246,250,255,0))}
.lp .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:960px;margin:34px auto 0}
.lp .stat{background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px 22px;text-align:center;box-shadow:0 10px 30px rgba(12,42,71,.05)}
.lp .stat b{display:block;font-size:clamp(28px,4vw,42px);font-weight:800;letter-spacing:-.03em;color:var(--navy);line-height:1}
.lp .stat span{display:block;margin-top:10px;font-size:13.5px;color:var(--slate);line-height:1.4}
/* feature rows */
.lp .frow{display:grid;grid-template-columns:1fr 1fr;gap:52px;align-items:center;margin-top:44px}
.lp .frow.rev .ftext{order:2}
.lp .fk{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-d);margin-bottom:12px}
.lp .ftext h3{font-size:clamp(21px,2.6vw,29px);font-weight:600;letter-spacing:-.022em;line-height:1.2;margin-bottom:12px}
.lp .ftext p{font-size:16px;line-height:1.62;color:var(--slate)}
.lp .fvis{display:flex;justify-content:center}
/* cards */
.lp .card{background:#fff;border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px rgba(12,42,71,.10);width:100%;max-width:400px;overflow:hidden}
.lp .card.qacard{max-width:420px}
.lp .card-h{padding:13px 16px;border-bottom:1px solid var(--line2);font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);display:flex;align-items:center;gap:8px}
.lp .card-b{padding:16px}
.lp .gap-row{display:flex;gap:12px;align-items:flex-start;padding:11px 0;border-top:1px solid var(--line2)}
.lp .gap-row:first-child{border-top:none}
.lp .gap-doc{font-size:11px;font-weight:700;color:var(--slate);width:88px;flex-shrink:0}
.lp .gap-val{font-size:13.5px;color:var(--navy)}
.lp .flagrow{margin-top:12px;background:rgba(239,68,68,.06);border:1px solid rgba(239,68,68,.2);border-radius:12px;padding:11px 13px;display:flex;gap:10px;align-items:center}
.lp .flagpill{font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#fff;background:var(--red);padding:4px 9px;border-radius:20px;flex-shrink:0}
.lp .flagrow p{font-size:12.5px;color:#7f1d1d}
/* generated QA sheet */
.lp .qa{display:flex;flex-direction:column;gap:0}
.lp .qi{display:flex;gap:11px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line2)}
.lp .qi:first-child{border-top:none;padding-top:2px}
.lp .qk{width:17px;height:17px;border:2px solid var(--brand);border-radius:5px;flex-shrink:0;margin-top:1px}
.lp .qt{font-size:13px;color:var(--navy);font-weight:500;line-height:1.3}
.lp .qs{font-size:10.5px;color:var(--brand-d);margin-top:3px;font-weight:700;letter-spacing:.02em}
.lp .qs.hist{color:var(--purple)}.lp .qs.code{color:var(--green)}
.lp .qafoot{padding:13px 16px;border-top:1px solid var(--line2);font-size:11.5px;color:var(--slate);line-height:1.45}
.lp .qafoot b{color:var(--navy)}
/* phone */
.lp .phone{width:264px;background:#fff;border:1px solid var(--line);border-radius:30px;box-shadow:0 40px 80px rgba(12,42,71,.16);padding:12px;animation:lpfloat 6s ease-in-out infinite}
@keyframes lpfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
.lp .pbar{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--slate);padding:5px 4px 12px;border-bottom:1px solid var(--line2)}
.lp .pmark{width:18px;height:18px;border-radius:5px;background:var(--grad)}.lp .pbar b{color:var(--navy)}
.lp .pbody{padding:14px 6px 6px;min-height:250px}
.lp .q{margin-left:auto;width:fit-content;max-width:86%;background:var(--grad);color:#fff;font-size:12px;font-weight:500;padding:9px 12px;border-radius:14px 14px 4px 14px}
.lp .a{margin-top:12px;background:#fff;border:1px solid var(--line);border-radius:14px 14px 14px 4px;padding:11px 12px;box-shadow:0 6px 18px rgba(12,42,71,.06)}
.lp .asrc{font-size:9px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-d);margin-bottom:6px}
.lp .a p{font-size:11.5px;line-height:1.45;color:var(--slate)}.lp .a p b{color:var(--navy)}
.lp .cite{margin-top:10px;display:flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:11px;padding:8px 10px;background:linear-gradient(180deg,rgba(65,195,255,.05),transparent)}
.lp .cite .ci{width:28px;height:28px;border-radius:7px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:13px}
.lp .cite b{display:block;font-size:11px;color:var(--navy)}.lp .cite small{font-size:10px;color:var(--mut)}
/* convergence */
.lp .cv{background:linear-gradient(180deg,rgba(246,250,255,0),#fff)}
.lp .cvgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:940px;margin:40px auto 0}
.lp .src{display:block;background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 10px 30px rgba(12,42,71,.05)}
.lp .src .st{font-size:14px;font-weight:700;color:var(--navy);margin-bottom:12px;display:flex;align-items:center;gap:9px}
.lp .src .sd{width:10px;height:10px;border-radius:3px}
.lp .src.s1 .sd{background:var(--brand)}.lp .src.s2 .sd{background:var(--purple)}.lp .src.s3 .sd{background:var(--amber)}
.lp .src ul{list-style:none;display:flex;flex-direction:column;gap:7px}
.lp .src li{font-size:12.5px;color:var(--slate);display:flex;gap:8px;align-items:center}
.lp .src li::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--mut);flex-shrink:0}
.lp .beams{display:flex;justify-content:center;gap:80px;margin:8px auto 0;max-width:600px;height:44px}
.lp .beam{width:2px;background:linear-gradient(180deg,rgba(14,143,230,.1),var(--brand),rgba(14,143,230,.1));background-size:100% 220%;animation:lpbeam 1.8s linear infinite}
@keyframes lpbeam{0%{background-position:0 130%}100%{background-position:0 -130%}}
.lp .beam:nth-child(2){animation-delay:.4s}.lp .beam:nth-child(3){animation-delay:.8s}
.lp .core{max-width:520px;margin:0 auto;background:linear-gradient(180deg,#0C2A47,#0A2038);color:#fff;border-radius:20px;padding:24px 26px;text-align:center;box-shadow:0 26px 60px rgba(12,42,71,.28)}
.lp .core .cl{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#5FD0FF}
.lp .core h3{color:#fff;font-size:21px;font-weight:700;margin:10px 0 6px}
.lp .core p{font-size:13.5px;color:#B7CCE4;line-height:1.5}
.lp .lock{width:34px;height:34px;border-radius:10px;background:rgba(95,208,255,.16);display:inline-flex;align-items:center;justify-content:center;color:#5FD0FF;font-size:16px}
.lp .sec-note{max-width:640px;margin:26px auto 0;text-align:center;font-size:14.5px;color:var(--slate)}
.lp .sec-note b{color:var(--navy)}
/* proof */
.lp .pf{background:#fff}
.lp .tk3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1000px;margin:40px auto 0}
.lp .trk{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 14px 40px rgba(12,42,71,.06)}
.lp .trk h4{font-size:15px;color:var(--navy);margin-bottom:4px}
.lp .trk .tsub{font-size:12.5px;color:var(--slate);margin-bottom:14px}
.lp .tiles{display:flex;gap:8px;flex-wrap:wrap}
.lp .tile{flex:1;min-width:74px;background:var(--bg);border:1px solid var(--line);border-radius:11px;padding:9px 10px}
.lp .tile b{display:block;font-size:17px;font-weight:800;color:var(--navy)}
.lp .tile b.red{color:var(--red)}.lp .tile b.grn{color:var(--green)}
.lp .tile span{font-size:10px;color:var(--slate);font-weight:600}
.lp .scbar{margin-top:12px;display:flex;flex-direction:column;gap:6px}
.lp .scrow{display:flex;align-items:center;gap:8px;font-size:11.5px}
.lp .scrow .nm{width:74px;color:var(--navy);font-weight:600;flex-shrink:0}
.lp .scrow .bar{flex:1;height:7px;border-radius:4px;background:var(--line2);overflow:hidden}
.lp .scrow .fill{display:block;height:100%;background:var(--grad)}
.lp .scrow .fill.warn{background:var(--amber)}.lp .scrow .fill.bad{background:var(--red)}
.lp .scrow .v{width:42px;text-align:right;color:var(--slate);font-variant-numeric:tabular-nums}
/* team */
.lp .team{background:linear-gradient(180deg,rgba(246,250,255,0),#fff)}
.lp .team .th{font-size:clamp(24px,3.2vw,36px);font-weight:600;letter-spacing:-.025em;margin:12px 0 6px}
.lp .tstrip{display:flex;align-items:center;justify-content:center;margin:24px 0 18px}
.lp .tavs{display:flex}
.lp .tav{width:60px;height:60px;border-radius:50%;background:var(--grad);border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:17px;margin-left:-12px;box-shadow:0 8px 20px rgba(10,141,237,.24)}
.lp .tav:first-child{margin-left:0}
.lp .tlink{display:inline-flex;align-items:center;gap:7px;font-size:14.5px;font-weight:600;color:var(--brand-d)}
/* final */
.lp .final{position:relative;text-align:center;max-width:720px;margin:0 auto;padding:70px 7vw 40px}
.lp .final h2{font-size:clamp(28px,3.8vw,44px);font-weight:300;letter-spacing:-.03em;margin-bottom:14px}
.lp .final .lead{font-size:17px;margin-bottom:26px}
.lp .foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;max-width:1240px;margin:0 auto;padding:26px 7vw;border-top:1px solid var(--line)}
.lp .foot .brand{font-size:16px}.lp .foot .brand img{height:22px}
.lp .foot .fl{display:flex;gap:18px;font-size:13px;color:var(--slate)}
.lp .foot .fl a:hover{color:var(--navy)}
.lp .foot .fcopy{font-size:12.5px;color:var(--mut)}
@media(max-width:900px){
  .lp .links{display:none}
  .lp .navcta{display:none}
  .lp .burger{display:flex;align-items:center}
  .lp .nav{padding:9px 6vw;gap:10px}
  .lp .msheet{display:flex;flex-direction:column;position:sticky;top:47px;z-index:39;background:#fff;border-bottom:1px solid var(--line);padding:6px 6vw 16px;box-shadow:0 16px 34px rgba(12,42,71,.1)}
  .lp .msheet a{padding:13px 2px;font-size:15.5px;font-weight:600;color:var(--navy);border-bottom:1px solid var(--line2)}
  .lp .msheet-cta{display:flex;gap:10px;margin-top:14px}
  .lp .msheet-cta button{flex:1;text-align:center;padding:13px 0;border-radius:12px;font-size:15px;font-weight:600}
  .lp .frow{grid-template-columns:1fr;gap:26px}
  .lp .frow.rev .ftext{order:0}
  .lp .stats,.lp .cvgrid,.lp .tk3{grid-template-columns:1fr}
  .lp .beams{display:none}
}
@media(max-width:560px){
  .lp .band{padding:52px 6vw}
  .lp .hero{min-height:auto;padding:46px 6vw 40px}
  .lp .foot{padding:22px 6vw}
  .lp .foot .fl{order:3;flex-basis:100%}
  .lp .partners{margin-top:32px}
  .lp .prow{gap:10px}
  .lp .plate{padding:11px 15px;min-height:64px}
  .lp .core{padding:20px 18px}
  .lp .card,.lp .card.qacard{max-width:100%}
}
@media(prefers-reduced-motion:reduce){.lp *{animation:none!important}}
`;
