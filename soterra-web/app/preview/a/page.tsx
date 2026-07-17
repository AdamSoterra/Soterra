"use client";
import { useEffect } from "react";

// Soterra landing — Direction A: "Clean / product-first".
// Self-playing chat demo (question → cited answer), crisp SaaS feel.
// Self-contained (inline styles, scoped under .lpa) so it can't touch the app.
export default function PreviewA() {
  useEffect(() => {
    const els = document.querySelectorAll(".lpa .rv");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lpa">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand grad">Soterra</div>
        <a className="login" href="/">Log in</a>
      </header>

      <section className="hero">
        <div className="hcopy rv">
          <div className="pill">AI site assistant</div>
          <h1>Ask anything about your project.<br /><span className="grad">Run your whole site.</span></h1>
          <p>Your crew gets instant, plan-backed answers — and your site calendar, inspections and to-dos, all from one chat. No more digging through 500 pages of drawings.</p>
          <div className="cta">
            <a className="btn primary" href="/">Get set up</a>
            <a className="btn ghost" href="/">Log in</a>
          </div>
          <div className="trustline">✓ Every answer backed by your actual drawings — never guessed</div>
        </div>

        <div className="hdemo rv">
          <div className="chat">
            <div className="bar"><span className="dot r" /><span className="dot y" /><span className="dot g" /><b>43 Kauri Road</b></div>
            <div className="scene">
              <div className="q">What's the fire rating on the exterior doors?</div>
              <div className="typing"><i /><i /><i /></div>
              <div className="a">
                <div className="src">📐 FROM YOUR PLANS</div>
                <p><b>FRR 60</b> — fire-rated 60 mins. Leaf 910 × 2240 × 48 mm.</p>
                <div className="cite"><div className="ci">📐</div><div className="ct"><b>ED003 · Door Schedule</b><small>95% Detail Design · p60 of 85</small></div><div className="ca">›</div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="feats">
        {[
          { i: "📐", t: "Ask your plans", d: "Any question about the drawings or specs, answered in seconds — with the exact sheet to back it up." },
          { i: "🗓️", t: "Run the site calendar", d: "Inspections, deliveries, pours and to-dos — book them straight from chat, the whole crew in sync." },
          { i: "👷", t: "Your whole crew, one login", d: "Share one invite code. Everyone on site gets the same answers, instantly." },
        ].map((f, i) => (
          <div className="card rv" style={{ transitionDelay: `${i * 90}ms` }} key={f.t}>
            <div className="fi">{f.i}</div>
            <b>{f.t}</b>
            <p>{f.d}</p>
          </div>
        ))}
      </section>

      <section className="how rv">
        <h2>Live in minutes</h2>
        <div className="steps">
          {[
            { n: "1", t: "Upload your plans", d: "Drop the whole set — Soterra reads & indexes every page." },
            { n: "2", t: "Ask anything", d: "Materials, ratings, dimensions, finishes — cited to the sheet." },
            { n: "3", t: "Run the site", d: "Book inspections & deliveries from the same chat." },
          ].map((s) => (
            <div className="step" key={s.n}><div className="num">{s.n}</div><b>{s.t}</b><p>{s.d}</p></div>
          ))}
        </div>
      </section>

      <section className="final rv">
        <h2>Put your plans to work.</h2>
        <p>Set up your project and get your crew asking in minutes.</p>
        <a className="btn primary big" href="/">Get set up →</a>
      </section>

      <footer className="foot"><span className="grad">Soterra</span><span>The answer's in the plans. Just ask.</span></footer>
    </div>
  );
}

const CSS = `
.lpa{--brand:#0E8FE6;--navy:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F6FAFF;--line:#E6EFF9;--grad:linear-gradient(140deg,#41C3FF 0%,#0A8DED 100%);color:var(--navy);min-height:100vh;overflow-x:hidden}
.lpa .grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lpa .rv{opacity:0;transform:translateY(20px);transition:opacity .7s ease,transform .7s ease}
.lpa .rv.in{opacity:1;transform:none}
.lpa .nav{display:flex;align-items:center;justify-content:space-between;padding:20px 7vw;position:sticky;top:0;background:rgba(246,250,255,.8);backdrop-filter:blur(12px);z-index:20}
.lpa .brand{font-size:22px;font-weight:700}
.lpa .login{font-size:14px;font-weight:600;color:var(--navy);text-decoration:none;padding:9px 18px;border:1px solid var(--line);border-radius:11px;background:#fff}
.lpa .login:hover{border-color:var(--brand)}
.lpa .hero{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center;padding:60px 7vw 80px;max-width:1240px;margin:0 auto}
.lpa .pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand);background:rgba(14,143,230,.08);border:1px solid rgba(14,143,230,.16);padding:7px 15px;border-radius:30px;margin-bottom:22px}
.lpa h1{font-size:clamp(34px,4.6vw,58px);line-height:1.06;letter-spacing:-.03em;font-weight:300;margin-bottom:20px}
.lpa h1 .grad,.lpa h1 b{font-weight:700}
.lpa .hcopy>p{font-size:17px;line-height:1.65;color:var(--slate);max-width:520px;margin-bottom:30px}
.lpa .cta{display:flex;gap:12px;flex-wrap:wrap}
.lpa .btn{font-size:15px;font-weight:600;padding:14px 26px;border-radius:13px;text-decoration:none;display:inline-block;transition:transform .15s,box-shadow .15s}
.lpa .btn.primary{background:var(--grad);color:#fff;box-shadow:0 12px 30px rgba(10,141,237,.32)}
.lpa .btn.primary:hover{transform:translateY(-2px);box-shadow:0 16px 38px rgba(10,141,237,.4)}
.lpa .btn.ghost{background:#fff;color:var(--navy);border:1px solid var(--line)}
.lpa .btn.ghost:hover{border-color:var(--brand)}
.lpa .btn.big{padding:17px 38px;font-size:16px}
.lpa .trustline{margin-top:22px;font-size:13.5px;color:var(--mut);font-weight:500}
/* chat demo */
.lpa .hdemo{display:flex;justify-content:center}
.lpa .chat{width:100%;max-width:420px;background:#fff;border:1px solid var(--line);border-radius:22px;box-shadow:0 30px 70px rgba(12,42,71,.16);overflow:hidden}
.lpa .chat .bar{display:flex;align-items:center;gap:7px;padding:14px 18px;border-bottom:1px solid var(--line);font-size:12.5px;color:var(--slate)}
.lpa .chat .bar b{margin-left:6px;color:var(--navy)}
.lpa .dot{width:10px;height:10px;border-radius:50%}.lpa .dot.r{background:#FF5F57}.lpa .dot.y{background:#FEBC2E}.lpa .dot.g{background:#28C840}
.lpa .scene{padding:22px 18px 26px;min-height:300px;position:relative}
.lpa .scene .q{margin-left:auto;max-width:80%;background:var(--grad);color:#fff;padding:12px 16px;border-radius:16px 16px 5px 16px;font-size:14px;box-shadow:0 8px 18px rgba(10,141,237,.25);opacity:0;animation:aq 9s infinite}
.lpa .scene .typing{margin-top:16px;display:inline-flex;gap:5px;background:#fff;border:1px solid var(--line);padding:12px 15px;border-radius:14px;opacity:0;animation:atype 9s infinite}
.lpa .scene .typing i{width:7px;height:7px;border-radius:50%;background:#9DC4E6;animation:bnc 1.2s infinite}
.lpa .scene .typing i:nth-child(2){animation-delay:.15s}.lpa .scene .typing i:nth-child(3){animation-delay:.3s}
.lpa .scene .a{margin-top:14px;background:#fff;border:1px solid var(--line);border-radius:16px 16px 16px 5px;padding:14px 16px;box-shadow:0 8px 22px rgba(12,42,71,.07);opacity:0;transform:translateY(10px);animation:aa 9s infinite}
.lpa .scene .a .src{font-size:10.5px;font-weight:700;letter-spacing:.05em;color:var(--brand);margin-bottom:7px}
.lpa .scene .a p{font-size:14px;line-height:1.5}
.lpa .scene .a p b{color:var(--navy)}
.lpa .cite{margin-top:11px;border:1px solid var(--line);background:linear-gradient(180deg,rgba(65,195,255,.05),rgba(10,141,237,.03));border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:11px}
.lpa .cite .ci{width:34px;height:34px;border-radius:9px;background:#fff;border:1px solid var(--line);display:flex;align-items:center;justify-content:center}
.lpa .cite .ct{flex:1;min-width:0}.lpa .cite .ct b{display:block;font-size:12.5px}.lpa .cite .ct small{font-size:11px;color:var(--slate)}
.lpa .cite .ca{color:var(--brand);font-size:18px}
@keyframes aq{0%,4%{opacity:0;transform:translateY(8px)}10%,92%{opacity:1;transform:none}100%{opacity:0}}
@keyframes atype{0%,14%{opacity:0}18%,30%{opacity:1}34%,100%{opacity:0}}
@keyframes aa{0%,33%{opacity:0;transform:translateY(10px)}40%,92%{opacity:1;transform:none}100%{opacity:0}}
@keyframes bnc{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-5px);opacity:1}}
/* features */
.lpa .feats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1100px;margin:0 auto;padding:30px 7vw 70px}
.lpa .card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:28px 24px;box-shadow:0 6px 26px rgba(12,42,71,.05)}
.lpa .card .fi{font-size:30px;margin-bottom:14px}
.lpa .card b{font-size:18px;display:block;margin-bottom:8px}
.lpa .card p{font-size:14.5px;line-height:1.6;color:var(--slate)}
/* how */
.lpa .how{max-width:1000px;margin:0 auto;padding:20px 7vw 70px;text-align:center}
.lpa h2{font-size:clamp(26px,3.4vw,40px);font-weight:300;letter-spacing:-.02em;margin-bottom:36px}
.lpa .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.lpa .step{text-align:left}
.lpa .step .num{width:42px;height:42px;border-radius:12px;background:var(--grad);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;margin-bottom:14px;box-shadow:0 8px 18px rgba(10,141,237,.3)}
.lpa .step b{font-size:17px;display:block;margin-bottom:6px}
.lpa .step p{font-size:14px;color:var(--slate);line-height:1.6}
/* final */
.lpa .final{text-align:center;padding:70px 7vw;max-width:760px;margin:0 auto}
.lpa .final p{font-size:17px;color:var(--slate);margin-bottom:28px}
.lpa .foot{display:flex;align-items:center;justify-content:space-between;padding:30px 7vw;border-top:1px solid var(--line);font-size:13px;color:var(--mut);flex-wrap:wrap;gap:8px}
.lpa .foot .grad{font-weight:700;font-size:16px}
@media(max-width:860px){.lpa .hero{grid-template-columns:1fr;gap:36px}.lpa .feats,.lpa .steps{grid-template-columns:1fr}.lpa .hdemo{order:-1}}
`;
