"use client";
import { useEffect } from "react";
import type { CSSProperties } from "react";

// Set CSS custom properties inline without fighting React's CSSProperties type.
const cvar = (o: Record<string, string>): CSSProperties => o as unknown as CSSProperties;

// Soterra public landing — clean/pro "company intelligence" direction (Adam, 2026-07-04).
// Light, minimal, Soterra blue/navy; animated charts + phone/tablet app mockups + a
// BIM-style building that assembles itself. Single source of truth: rendered as the
// signed-out front page (app/page.tsx, with Clerk handlers) and at /preview/command.

function Cta({ kind, label, big, onAct }: { kind: "solid" | "ghost"; label: string; big?: boolean; onAct?: () => void }) {
  const cls = `${kind}${big ? " big" : ""}`;
  return onAct ? (
    <button type="button" className={cls} onClick={onAct}>{label}</button>
  ) : (
    <a className={cls} href="/">{label}</a>
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
          <a href="#does">What it does</a>
          <a href="#intel">Intelligence</a>
          <a href="#safe">Why it&apos;s safe</a>
        </nav>
        <div className="navcta">
          <Cta kind="ghost" label="Log in" onAct={onLogin} />
          <Cta kind="solid" label="Get set up" onAct={onGetStarted} />
        </div>
      </header>

      <section className="hero">
        <div className="hcopy rv in">
          <div className="pill"><span className="dotlive" /> An intelligent partner for every site</div>
          <h1>Turning construction data into <span className="g">company intelligence.</span></h1>
          <p className="lead"><b>Your 24/7 site manager.</b> Knows your plans, runs your schedule, and keeps the whole crew in the loop.</p>
          <div className="cta">
            <Cta kind="solid" big label="Get set up" onAct={onGetStarted} />
            <Cta kind="ghost" big label="Log in" onAct={onLogin} />
          </div>
          <div className="trust">✓ Every answer cited to your actual drawings — never guessed</div>
        </div>

        <div className="hvis rv in">
          <div className="phone">
            <div className="ph-top"><span className="ph-cam" /></div>
            <div className="ph-screen">
              <div className="ph-bar"><img src="/logo-mark.png" alt="" />{/* eslint-disable-line @next/next/no-img-element */}<b>1 Arthur Road</b></div>
              <div className="q">What&apos;s the fire rating on the exterior doors?</div>
              <div className="dots"><i /><i /><i /></div>
              <div className="a">
                <div className="a-src">From your plans</div>
                <p><b>FRR 60</b> — fire-rated 60 minutes. Leaf 910 × 2240 × 48&nbsp;mm.</p>
                <div className="cite"><span className="ci">▦</span><span className="ct"><b>ED003 · Door Schedule</b><small>95% Detail Design · p60/85</small></span></div>
              </div>
            </div>
          </div>
          <div className="chip chart-chip">
            <div className="cc-h">This week on site</div>
            <div className="cc-bars">
              {["42%", "68%", "90%", "55%", "74%"].map((h, i) => (
                <span key={i} style={cvar({ "--h": h })} />
              ))}
            </div>
          </div>
          <div className="chip note-chip">
            <span className="nc-dot" />
            <div><b>Pre-line inspection booked</b><small>Tomorrow · 9:00 · crew notified</small></div>
          </div>
        </div>
      </section>

      <section className="logos rv">
        <div className="stat"><b className="g">571</b><small>pages read on one project — answered in seconds</small></div>
        <div className="stat"><b className="g">0</b><small>guesses — every answer cites the exact sheet</small></div>
        <div className="stat"><b className="g">1</b><small>place for plans, schedule &amp; the whole crew</small></div>
      </section>

      <section className="does" id="does">
        <div className="frow rv">
          <div className="ftext">
            <div className="fk">Ask your plans</div>
            <h2>Any question about the drawings, answered on the spot.</h2>
            <p>Fire ratings, GIB specs, beam sizes, setouts — ask in plain words and get the answer in seconds, pointed at the exact sheet. It never guesses; if it isn&apos;t in your plans, it tells you.</p>
            <div className="fchk"><span>Cited to the sheet</span><span>Never guessed</span><span>Whole crew, one login</span></div>
          </div>
          <div className="fvis">
            <div className="tablet">
              <div className="tb-q">What R-value for the external walls?</div>
              <div className="tb-a"><div className="a-src">From your plans</div><p><b>R 2.8</b> batts to all external timber-framed walls.</p><div className="cite sm"><span className="ci">▦</span><span className="ct"><b>SP-04 · Thermal &amp; Moisture</b><small>p2/14</small></span></div></div>
            </div>
          </div>
        </div>

        <div className="frow rev rv">
          <div className="ftext">
            <div className="fk">Run the site</div>
            <h2>Inspections, deliveries and pours — booked from one chat.</h2>
            <p>Just say it — &ldquo;pre-line inspection Tuesday 9am&rdquo; — and it&apos;s on the shared calendar, with the crew notified. Nothing slips, nobody double-books, the whole team stays in sync.</p>
            <div className="fchk"><span>One shared calendar</span><span>Booked from chat</span><span>Crew notified</span></div>
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
      </section>

      <section className="intel" id="intel">
        <div className="intel-head rv">
          <div className="fk center">Company intelligence</div>
          <h2>Every project rolls up into one clear picture.</h2>
          <p>Plans, inspections and progress across every site — turned into the numbers that actually run the business.</p>
        </div>
        <div className="dash rv">
          <div className="d-card d-bars">
            <div className="d-h">Site activity <span>last 6 weeks</span></div>
            <div className="bars">
              {[38, 55, 47, 72, 63, 88].map((h, i) => (
                <span key={i} className="bar" style={cvar({ "--h": `${h}%`, "--d": `${i * 90}ms` })} />
              ))}
            </div>
            <div className="d-x"><span>W1</span><span>W2</span><span>W3</span><span>W4</span><span>W5</span><span>W6</span></div>
          </div>
          <div className="d-card d-ring">
            <div className="d-h">Answered from plans</div>
            <svg viewBox="0 0 120 120" className="ring">
              <circle className="ring-bg" cx="60" cy="60" r="48" />
              <circle className="ring-fg" cx="60" cy="60" r="48" />
            </svg>
            <div className="ring-num"><b>98%</b><small>cited, zero guesses</small></div>
          </div>
          <div className="d-card d-metrics">
            <div className="m"><b className="g">4</b><small>active sites</small></div>
            <div className="m"><b className="g">1,240</b><small>plan pages indexed</small></div>
            <div className="m"><b className="g">36</b><small>inspections on track</small></div>
            <div className="m"><b className="g">0</b><small>missed this month</small></div>
          </div>
        </div>
      </section>

      <section className="bim">
        <div className="bim-copy rv">
          <div className="fk">Your project, as a model you can ask</div>
          <h2>From the whole set of drawings to one place that answers.</h2>
          <p>Soterra reads every page — architectural, structural, services, specs — and holds it as one connected project your whole crew can question, anytime.</p>
        </div>
        <div className="bim-vis rv">
          <div className="floor-shadow" aria-hidden="true" />
          <svg className="iso" viewBox="0 0 460 360" aria-hidden="true">
            <g className="bld">
              <path className="face fr" d="M230 170 L350 110 L350 262 L230 322 Z" />
              <path className="face fl" d="M110 110 L230 170 L230 322 L110 262 Z" />
              <path className="face ft" d="M110 110 L230 50 L350 110 L230 170 Z" />
              <line className="fln f1" x1="110" y1="149" x2="230" y2="209" /><line className="fln f1" x1="230" y1="209" x2="350" y2="149" />
              <line className="fln f2" x1="110" y1="188" x2="230" y2="248" /><line className="fln f2" x1="230" y1="248" x2="350" y2="188" />
              <line className="fln f3" x1="110" y1="227" x2="230" y2="287" /><line className="fln f3" x1="230" y1="287" x2="350" y2="227" />
              <line className="mul" x1="150" y1="130" x2="150" y2="282" /><line className="mul" x1="190" y1="150" x2="190" y2="302" />
              <line className="mul" x1="270" y1="150" x2="270" y2="302" /><line className="mul" x1="310" y1="130" x2="310" y2="282" />
            </g>
            <g className="pin p1"><circle className="halo" cx="300" cy="150" r="12" /><circle className="dot" cx="300" cy="150" r="5" /></g>
            <g className="pin p2"><circle className="halo" cx="168" cy="205" r="11" /><circle className="dot" cx="168" cy="205" r="4.5" /></g>
            <g className="pin p3"><circle className="halo" cx="250" cy="262" r="11" /><circle className="dot" cx="250" cy="262" r="4.5" /></g>
          </svg>
          <div className="bim-tip"><div className="a-src">From your plans</div><p>Exterior doors: <b>FRR 60</b></p><small>ED003 · Door Schedule</small></div>
        </div>
      </section>

      <section className="safe" id="safe">
        <div className="rv">
          <div className="fk center">Safe to use on site</div>
          <h2>It never invents a code, a rating, or a number.</h2>
          <p>Soterra only answers from the drawings and specs you upload, and shows you the exact sheet every time. That&apos;s the line between a tool you can trust on site and one you can&apos;t.</p>
        </div>
      </section>

      <section className="final rv">
        <h2>Put your whole project to work.</h2>
        <p>Set up your site and get the crew asking in minutes.</p>
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
/* hero */
.lp .hero{display:grid;grid-template-columns:1.06fr .94fr;gap:50px;align-items:center;max-width:1240px;margin:0 auto;padding:64px 7vw 70px}
.lp .pill{display:inline-flex;align-items:center;gap:9px;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--brand-d);background:rgba(14,143,230,.07);border:1px solid rgba(14,143,230,.16);padding:8px 15px;border-radius:30px;margin-bottom:24px}
.lp h1{font-size:clamp(36px,4.9vw,60px);line-height:1.05;letter-spacing:-.035em;font-weight:300;margin-bottom:22px}
.lp h1 .g{font-weight:700}
.lp .lead{font-size:18px;line-height:1.6;color:var(--slate);max-width:500px;margin-bottom:30px}
.lp .lead b{color:var(--navy);font-weight:600}
.lp .cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.lp .trust{font-size:13.5px;color:var(--mut);font-weight:500}
/* hero visual */
.lp .hvis{position:relative;display:flex;justify-content:center;min-height:440px}
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
.lp .cite.sm{margin-top:9px}
.lp .cite .ci{width:30px;height:30px;border-radius:8px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:14px;flex-shrink:0}
.lp .cite .ct{min-width:0}.lp .cite .ct b{display:block;font-size:11.5px;color:var(--navy)}.lp .cite .ct small{font-size:10.5px;color:var(--mut)}
@keyframes lpfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
.lp .chip{position:absolute;background:#fff;border:1px solid var(--line);border-radius:15px;box-shadow:0 18px 44px rgba(12,42,71,.14);padding:13px 15px}
.lp .chart-chip{right:2%;top:12%;width:150px;animation:lpfloat 5s ease-in-out .4s infinite}
.lp .cc-h{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);margin-bottom:11px}
.lp .cc-bars{display:flex;align-items:flex-end;gap:7px;height:52px}
.lp .cc-bars span{flex:1;height:var(--h);background:var(--grad);border-radius:4px;opacity:.9}
.lp .note-chip{left:-2%;bottom:8%;display:flex;align-items:center;gap:11px;width:210px;animation:lpfloat 5.6s ease-in-out .8s infinite}
.lp .nc-dot{width:34px;height:34px;border-radius:10px;background:rgba(16,185,129,.12);position:relative;flex-shrink:0}
.lp .nc-dot::after{content:"";position:absolute;inset:0;margin:auto;width:9px;height:9px;border-radius:50%;background:var(--green)}
.lp .note-chip b{font-size:12.5px;color:var(--navy);display:block}.lp .note-chip small{font-size:11px;color:var(--slate)}
/* stat band */
.lp .logos{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:980px;margin:0 auto;padding:20px 7vw 30px}
.lp .stat{text-align:center}
.lp .stat b{font-size:clamp(38px,5vw,58px);font-weight:700;line-height:1;display:block}
.lp .stat small{display:block;font-size:13.5px;color:var(--slate);margin-top:10px;line-height:1.5;max-width:220px;margin-left:auto;margin-right:auto}
/* feature rows */
.lp .does{max-width:1120px;margin:0 auto;padding:50px 7vw;display:flex;flex-direction:column;gap:70px}
.lp .frow{display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:center}
.lp .frow.rev .ftext{order:2}
.lp .fk{font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-d);margin-bottom:14px}
.lp .fk.center{text-align:center}
.lp .ftext h2{font-size:clamp(24px,3vw,34px);font-weight:300;letter-spacing:-.025em;line-height:1.16;margin-bottom:15px}
.lp .ftext h2{font-weight:600}
.lp .ftext>p{font-size:16px;line-height:1.66;color:var(--slate)}
.lp .fchk{display:flex;flex-wrap:wrap;gap:8px 10px;margin-top:20px}
.lp .fchk span{font-size:12.5px;font-weight:600;color:var(--brand-d);background:rgba(14,143,230,.06);border:1px solid rgba(14,143,230,.14);padding:7px 12px;border-radius:9px}
.lp .fvis{display:flex;justify-content:center}
.lp .tablet{width:100%;max-width:400px;background:#fff;border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 30px 66px rgba(12,42,71,.1)}
.lp .tb-q{margin-left:auto;width:fit-content;max-width:88%;background:var(--grad);color:#fff;font-size:13.5px;font-weight:500;padding:11px 15px;border-radius:15px 15px 4px 15px}
.lp .tb-a{margin-top:13px;background:var(--bg);border:1px solid var(--line);border-radius:15px 15px 15px 4px;padding:14px 15px}
.lp .tb-a p{font-size:13.5px;color:var(--slate)}.lp .tb-a p b{color:var(--navy)}
.lp .tablet.cal{padding:20px 20px 8px}
.lp .cal-h{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin-bottom:14px}
.lp .cal-row{display:flex;align-items:center;gap:14px;padding:7px 0}
.lp .cal-d{font-size:11px;font-weight:700;color:var(--slate);width:32px;text-transform:uppercase}
.lp .cal-ev{flex:1;min-height:34px;display:flex;align-items:center;padding:0 13px;font-size:13px;color:var(--navy);background:var(--bg);border:1px solid var(--line);border-radius:9px}
.lp .cal-ev.b{border-left:3px solid var(--brand)}.lp .cal-ev.a{border-left:3px solid var(--amber)}.lp .cal-ev.g{border-left:3px solid var(--green)}.lp .cal-ev.p{border-left:3px solid var(--purple)}
/* intelligence / charts */
.lp .intel{max-width:1120px;margin:0 auto;padding:40px 7vw 60px}
.lp .intel-head{text-align:center;max-width:640px;margin:0 auto 40px}
.lp .intel-head h2{font-size:clamp(26px,3.4vw,40px);font-weight:600;letter-spacing:-.025em;margin-bottom:14px}
.lp .intel-head p{font-size:17px;line-height:1.6;color:var(--slate)}
.lp .dash{display:grid;grid-template-columns:1.4fr 1fr 1.1fr;gap:18px}
.lp .d-card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 12px 40px rgba(12,42,71,.07)}
.lp .d-h{font-size:13px;font-weight:600;color:var(--navy);margin-bottom:18px}.lp .d-h span{color:var(--mut);font-weight:500;font-size:12px}
.lp .bars{display:flex;align-items:flex-end;gap:12px;height:150px}
.lp .bars .bar{flex:1;height:8px;background:var(--grad);border-radius:6px 6px 3px 3px;transform-origin:bottom;transform:scaleY(0)}
.lp .rv.in .bars .bar{animation:lpbar .9s cubic-bezier(.2,.7,.2,1) forwards;animation-delay:var(--d)}
@keyframes lpbar{to{height:var(--h);transform:scaleY(1)}}
.lp .d-x{display:flex;gap:12px;margin-top:10px}.lp .d-x span{flex:1;text-align:center;font-size:10.5px;color:var(--mut)}
.lp .d-ring{display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative}
.lp .ring{width:150px;height:150px;transform:rotate(-90deg)}
.lp .ring-bg{fill:none;stroke:var(--line);stroke-width:12}
.lp .ring-fg{fill:none;stroke:url(#lpgrad);stroke:#0A8DED;stroke-width:12;stroke-linecap:round;stroke-dasharray:301.6;stroke-dashoffset:301.6}
.lp .rv.in .ring-fg{animation:lpring 1.4s cubic-bezier(.2,.7,.2,1) .2s forwards}
@keyframes lpring{to{stroke-dashoffset:6}}
.lp .ring-num{position:absolute;text-align:center}.lp .ring-num b{font-size:30px;font-weight:700;color:var(--navy);display:block}.lp .ring-num small{font-size:11px;color:var(--slate)}
.lp .d-metrics{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-content:center}
.lp .d-metrics .m b{font-size:30px;font-weight:700;line-height:1;display:block}
.lp .d-metrics .m small{font-size:12px;color:var(--slate);display:block;margin-top:5px}
/* bim */
.lp .bim{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center;max-width:1120px;margin:0 auto;padding:50px 7vw}
.lp .bim-copy h2{font-size:clamp(24px,3vw,34px);font-weight:600;letter-spacing:-.025em;line-height:1.16;margin-bottom:15px}
.lp .bim-copy>p{font-size:16px;line-height:1.66;color:var(--slate)}
.lp .bim-vis{position:relative}
.lp .iso{display:block;width:100%;height:auto;overflow:visible}
.lp .floor-shadow{position:absolute;left:50%;bottom:8%;width:60%;height:40px;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(12,42,71,.14),transparent 70%);filter:blur(3px)}
.lp .bld{opacity:0}
.lp .rv.in .bld{animation:lprise 1s ease .15s forwards}
@keyframes lprise{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
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
/* safe */
.lp .safe{max-width:760px;margin:0 auto;padding:60px 7vw;text-align:center}
.lp .safe h2{font-size:clamp(25px,3.3vw,38px);font-weight:600;letter-spacing:-.025em;margin-bottom:16px;line-height:1.14}
.lp .safe p{font-size:17px;line-height:1.7;color:var(--slate);max-width:600px;margin:0 auto}
/* final */
.lp .final{text-align:center;max-width:720px;margin:0 auto;padding:40px 7vw 90px}
.lp .final h2{font-size:clamp(28px,3.8vw,44px);font-weight:300;letter-spacing:-.03em;margin-bottom:14px}
.lp .final p{font-size:17px;color:var(--slate);margin-bottom:28px}
.lp .foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;max-width:1240px;margin:0 auto;padding:28px 7vw;border-top:1px solid var(--line)}
.lp .foot .brand{font-size:16px}.lp .foot .brand img{height:22px}
.lp .foot>span{font-size:13px;color:var(--mut)}
@media(max-width:900px){.lp .hero{grid-template-columns:1fr;gap:44px;padding-top:44px}.lp .links{display:none}.lp .logos{grid-template-columns:1fr;gap:28px}.lp .frow,.lp .bim{grid-template-columns:1fr;gap:32px}.lp .frow.rev .ftext{order:0}.lp .dash{grid-template-columns:1fr}.lp .hvis{min-height:400px}}
`;
