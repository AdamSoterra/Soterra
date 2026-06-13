"use client";
import { useEffect } from "react";

// Soterra landing — Direction B: "Bold / site energy".
// Dark navy hero with a blueprint grid + building outline that draws itself in.
export default function PreviewB() {
  useEffect(() => {
    const els = document.querySelectorAll(".lpb .rv");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lpb">
      <style>{CSS}</style>

      <section className="hero">
        <svg className="bp" viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <pattern id="g" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0H0V40" fill="none" stroke="rgba(120,190,255,.12)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="800" height="600" fill="url(#g)" />
          <g className="draw" fill="none" stroke="rgba(120,200,255,.55)" strokeWidth="2">
            <path d="M150 430 L150 220 L400 110 L650 220 L650 430 Z" />
            <path d="M150 430 L650 430" />
            <path d="M280 430 L280 320 L380 320 L380 430" />
            <rect x="470" y="300" width="90" height="70" />
            <path d="M400 110 L400 200" />
          </g>
          <circle className="ping" cx="525" cy="335" r="6" fill="#41C3FF" />
        </svg>

        <header className="nav">
          <div className="brand">Soter<span className="lite">ra</span></div>
          <a className="login" href="/">Log in</a>
        </header>

        <div className="hcopy rv in">
          <div className="pill">For the whole site team</div>
          <h1>The answer's<br />in the plans.<br /><em>Just ask.</em></h1>
          <p>Soterra reads your whole drawing set so your crew can ask it anything — and get the answer in seconds, cited to the exact sheet. Plus the site calendar, all in one chat.</p>
          <div className="cta">
            <a className="btn primary" href="/">Get set up</a>
            <a className="btn ghost" href="/">Log in →</a>
          </div>
        </div>
      </section>

      <section className="stats">
        {[
          { n: "571", l: "pages read in one project — answered in seconds" },
          { n: "0", l: "guesses — every answer cites the actual sheet" },
          { n: "1", l: "chat for plans, calendar and the whole crew" },
        ].map((s, i) => (
          <div className="stat rv" style={{ transitionDelay: `${i * 90}ms` }} key={s.l}>
            <div className="big grad">{s.n}</div>
            <p>{s.l}</p>
          </div>
        ))}
      </section>

      <section className="feats">
        {[
          { i: "📐", t: "Ask your plans", d: "Materials, fire ratings, dimensions, finishes — answered from your drawings, with the sheet to prove it." },
          { i: "🗓️", t: "Organise your site", d: "Inspections, deliveries, pours and to-dos — booked from chat, the crew in sync." },
          { i: "👷", t: "One code, whole crew", d: "Share an invite code; everyone on site asks the same brain." },
        ].map((f, i) => (
          <div className="card rv" style={{ transitionDelay: `${i * 90}ms` }} key={f.t}>
            <div className="fi">{f.i}</div><b>{f.t}</b><p>{f.d}</p>
          </div>
        ))}
      </section>

      <section className="final rv">
        <h2>Stop digging through drawings.</h2>
        <p>Get your project set up and your crew asking today.</p>
        <a className="btn primary big" href="/">Get set up →</a>
      </section>

      <footer className="foot"><span className="brand">Soter<span className="lite">ra</span></span><span>Ask anything about your project, or organise your site calendar.</span></footer>
    </div>
  );
}

const CSS = `
.lpb{--brand:#0E8FE6;--navy:#0C2A47;--slate:#52698A;--mut:#94A6BE;--line:#E6EFF9;--grad:linear-gradient(140deg,#41C3FF 0%,#0A8DED 100%);color:var(--navy);min-height:100vh;overflow-x:hidden;background:#fff}
.lpb .grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lpb .rv{opacity:0;transform:translateY(20px);transition:opacity .7s,transform .7s}
.lpb .rv.in{opacity:1;transform:none}
.lpb .hero{position:relative;min-height:88vh;background:radial-gradient(1200px 700px at 70% 10%,#123a5e,#0C2A47 60%);color:#fff;overflow:hidden;display:flex;flex-direction:column}
.lpb .bp{position:absolute;inset:0;width:100%;height:100%;opacity:.9}
.lpb .draw path,.lpb .draw rect{stroke-dasharray:1400;stroke-dashoffset:1400;animation:draw 3.2s ease forwards}
.lpb .draw path:nth-child(2){animation-delay:.5s}.lpb .draw path:nth-child(3){animation-delay:1s}.lpb .draw rect{animation-delay:1.5s}.lpb .draw path:nth-child(5){animation-delay:2s}
.lpb .ping{opacity:0;animation:ping 2.4s ease 2.6s infinite}
@keyframes draw{to{stroke-dashoffset:0}}
@keyframes ping{0%{opacity:0;r:6}40%{opacity:1}100%{opacity:0;r:22}}
.lpb .nav{position:relative;z-index:2;display:flex;align-items:center;justify-content:space-between;padding:22px 7vw}
.lpb .brand{font-size:22px;font-weight:800;color:#fff;letter-spacing:-.01em}
.lpb .brand .lite{color:#7FC4FF}
.lpb .login{font-size:14px;font-weight:600;color:#fff;text-decoration:none;padding:9px 18px;border:1px solid rgba(255,255,255,.25);border-radius:11px}
.lpb .login:hover{border-color:#7FC4FF;background:rgba(255,255,255,.06)}
.lpb .hcopy{position:relative;z-index:2;margin:auto 7vw;max-width:760px;padding:40px 0}
.lpb .pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#9ED3FF;background:rgba(120,200,255,.1);border:1px solid rgba(120,200,255,.25);padding:7px 16px;border-radius:30px;margin-bottom:26px}
.lpb h1{font-size:clamp(42px,7vw,88px);line-height:.98;letter-spacing:-.04em;font-weight:800;margin-bottom:26px}
.lpb h1 em{font-style:normal;color:#7FC4FF}
.lpb .hcopy>p{font-size:18px;line-height:1.6;color:rgba(255,255,255,.78);max-width:560px;margin-bottom:32px}
.lpb .cta{display:flex;gap:13px;flex-wrap:wrap}
.lpb .btn{font-size:15px;font-weight:600;padding:15px 30px;border-radius:13px;text-decoration:none;transition:transform .15s,box-shadow .15s}
.lpb .btn.primary{background:var(--grad);color:#fff;box-shadow:0 14px 34px rgba(10,141,237,.45)}
.lpb .btn.primary:hover{transform:translateY(-2px)}
.lpb .btn.ghost{color:#fff;border:1px solid rgba(255,255,255,.3)}
.lpb .btn.ghost:hover{border-color:#7FC4FF}
.lpb .btn.big{padding:18px 40px;font-size:16px}
.lpb .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;max-width:1000px;margin:0 auto;padding:70px 7vw 40px;text-align:center}
.lpb .stat .big{font-size:clamp(48px,6vw,76px);font-weight:800;line-height:1}
.lpb .stat p{font-size:14.5px;color:var(--slate);margin-top:10px;line-height:1.5}
.lpb .feats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1100px;margin:0 auto;padding:30px 7vw 70px}
.lpb .card{background:#F6FAFF;border:1px solid var(--line);border-radius:18px;padding:28px 24px}
.lpb .card .fi{font-size:30px;margin-bottom:14px}
.lpb .card b{font-size:18px;display:block;margin-bottom:8px}
.lpb .card p{font-size:14.5px;line-height:1.6;color:var(--slate)}
.lpb .final{text-align:center;padding:50px 7vw 80px;max-width:760px;margin:0 auto}
.lpb h2{font-size:clamp(28px,4vw,46px);font-weight:300;letter-spacing:-.02em;margin-bottom:14px}
.lpb .final p{font-size:17px;color:var(--slate);margin-bottom:28px}
.lpb .foot{display:flex;align-items:center;justify-content:space-between;padding:28px 7vw;background:#0C2A47;color:rgba(255,255,255,.6);font-size:13px;flex-wrap:wrap;gap:8px}
.lpb .foot .brand{font-size:16px}
@media(max-width:860px){.lpb .stats,.lpb .feats{grid-template-columns:1fr}.lpb .hero{min-height:80vh}}
`;
