"use client";
import { useEffect } from "react";

// Soterra landing — Direction C: "Calm / trust-first".
// Editorial, airy, a drawing sheet with a scanning highlight + floating answer.
export default function PreviewC() {
  useEffect(() => {
    const els = document.querySelectorAll(".lpc .rv");
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.15 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="lpc">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand grad">Soterra</div>
        <a className="login" href="/">Log in</a>
      </header>

      <section className="hero rv in">
        <div className="pill">Backed by your plans — never guessed</div>
        <h1>Every answer,<br />backed by your<br /><span className="grad">actual drawings.</span></h1>
        <p>Ask anything about your project and get a clear, plan-cited answer in seconds — or organise your whole site calendar. If it's not in your plans, Soterra tells you. No bluffing.</p>
        <div className="cta">
          <a className="btn primary" href="/">Get set up</a>
          <a className="btn ghost" href="/">Log in</a>
        </div>

        <div className="sheetwrap rv">
          <div className="sheet">
            <div className="frame" />
            <div className="hl" />
            <div className="hltag">FRR 60 · ED003</div>
            <div className="tb"><b>ED003</b><span>Door Schedule</span><br /><span className="mut">1 Arthur Rd · p60/85</span></div>
            <div className="scan" />
          </div>
          <div className="chip">
            <div className="src">📐 From your plans</div>
            <p>Exterior doors: <b>FRR 60</b>, 910×2240×48mm leaf.</p>
          </div>
        </div>
      </section>

      <section className="ask rv">
        <div className="ask-h">Ask it anything on site</div>
        <div className="qs">
          {[
            "What's the fire rating on the exterior doors?",
            "What GIB do I use in the bathrooms?",
            "Beam size over the garage?",
            "Insulation R-value — external walls?",
            "Book a GIB delivery for next Tuesday 1pm",
            "What's on this week?",
          ].map((q, i) => (
            <div className="q rv" style={{ transitionDelay: `${i * 70}ms` }} key={q}>{q}</div>
          ))}
        </div>
      </section>

      <section className="trust rv">
        <h2>Trust every answer.</h2>
        <p>Soterra only answers from the drawings and specs you upload — and shows you the exact sheet every time. It never invents a code, a rating or a number. That's what makes it safe to use on site.</p>
      </section>

      <section className="feats">
        {[
          { t: "Read your whole set", d: "Architectural, structural, services, specs — every page indexed and searchable." },
          { t: "Run the site calendar", d: "Inspections, deliveries, pours and to-dos, booked straight from chat." },
          { t: "Your whole crew", d: "One invite code, everyone asking the same plan-backed brain." },
        ].map((f, i) => (
          <div className="card rv" style={{ transitionDelay: `${i * 90}ms` }} key={f.t}><b>{f.t}</b><p>{f.d}</p></div>
        ))}
      </section>

      <section className="final rv">
        <h2>The answer's in the plans.</h2>
        <a className="btn primary big" href="/">Get your project set up →</a>
      </section>

      <footer className="foot"><span className="grad">Soterra</span><span>Just ask.</span></footer>
    </div>
  );
}

const CSS = `
.lpc{--brand:#0E8FE6;--navy:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F6FAFF;--line:#E6EFF9;--amber:#F59E0B;--grad:linear-gradient(140deg,#41C3FF 0%,#0A8DED 100%);color:var(--navy);min-height:100vh;overflow-x:hidden;background:#FBFDFF}
.lpc .grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lpc .rv{opacity:0;transform:translateY(22px);transition:opacity .8s,transform .8s}
.lpc .rv.in{opacity:1;transform:none}
.lpc .nav{display:flex;align-items:center;justify-content:space-between;padding:22px 8vw}
.lpc .brand{font-size:22px;font-weight:700}
.lpc .login{font-size:14px;font-weight:600;color:var(--navy);text-decoration:none;padding:9px 18px;border:1px solid var(--line);border-radius:11px;background:#fff}
.lpc .login:hover{border-color:var(--brand)}
.lpc .hero{max-width:840px;margin:0 auto;padding:48px 8vw 60px;text-align:center}
.lpc .pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--brand);background:rgba(14,143,230,.07);border:1px solid rgba(14,143,230,.15);padding:8px 16px;border-radius:30px;margin-bottom:28px}
.lpc h1{font-size:clamp(38px,5.4vw,66px);line-height:1.05;letter-spacing:-.03em;font-weight:300;margin-bottom:24px}
.lpc h1 .grad{font-weight:700}
.lpc .hero>p{font-size:18px;line-height:1.7;color:var(--slate);max-width:600px;margin:0 auto 30px}
.lpc .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.lpc .btn{font-size:15px;font-weight:600;padding:14px 28px;border-radius:13px;text-decoration:none;transition:transform .15s,box-shadow .15s}
.lpc .btn.primary{background:var(--grad);color:#fff;box-shadow:0 12px 30px rgba(10,141,237,.3)}
.lpc .btn.primary:hover{transform:translateY(-2px)}
.lpc .btn.ghost{background:#fff;color:var(--navy);border:1px solid var(--line)}
.lpc .btn.ghost:hover{border-color:var(--brand)}
.lpc .btn.big{padding:17px 36px;font-size:16px}
/* sheet motif */
.lpc .sheetwrap{position:relative;max-width:520px;margin:54px auto 0}
.lpc .sheet{position:relative;aspect-ratio:1.414/1;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 30px 70px rgba(12,42,71,.14);overflow:hidden}
.lpc .sheet .frame{position:absolute;inset:14px;border:1px solid #DCE7F2}
.lpc .sheet .hl{position:absolute;left:16%;top:34%;width:30%;height:16%;border:2px solid var(--amber);background:rgba(245,158,11,.13);border-radius:3px;animation:pulse 2s infinite}
.lpc .sheet .hltag{position:absolute;left:16%;top:27%;background:var(--amber);color:#3a2a00;font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px}
.lpc .sheet .tb{position:absolute;right:14px;bottom:14px;width:38%;border-left:1px solid #DCE7F2;border-top:1px solid #DCE7F2;padding:8px 10px;background:#fff;font-size:9px;color:var(--slate)}
.lpc .sheet .tb b{font-size:11px;color:var(--navy);display:block}
.lpc .sheet .tb .mut{color:var(--mut)}
.lpc .sheet .scan{position:absolute;left:0;right:0;height:80px;top:-80px;background:linear-gradient(180deg,transparent,rgba(65,195,255,.22),transparent);animation:scan 4s ease-in-out infinite}
.lpc .chip{position:absolute;right:-10px;bottom:-22px;width:250px;background:#fff;border:1px solid var(--line);border-radius:14px;padding:13px 15px;box-shadow:0 16px 40px rgba(12,42,71,.16);animation:float 5s ease-in-out infinite}
.lpc .chip .src{font-size:10px;font-weight:700;letter-spacing:.04em;color:var(--brand);margin-bottom:6px}
.lpc .chip p{font-size:13px;line-height:1.45}.lpc .chip p b{color:var(--navy)}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 0 0 10px rgba(245,158,11,0)}}
@keyframes scan{0%{top:-80px}55%,100%{top:110%}}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}
/* ask */
.lpc .ask{max-width:760px;margin:0 auto;padding:80px 8vw 50px;text-align:center}
.lpc .ask-h{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin-bottom:24px}
.lpc .qs{display:flex;flex-direction:column;gap:11px;max-width:560px;margin:0 auto}
.lpc .q{background:#fff;border:1px solid var(--line);border-radius:30px;padding:14px 22px;font-size:15px;color:var(--navy);box-shadow:0 2px 12px rgba(12,42,71,.04);text-align:left}
/* trust */
.lpc .trust{max-width:720px;margin:0 auto;padding:40px 8vw 60px;text-align:center}
.lpc h2{font-size:clamp(28px,3.6vw,42px);font-weight:300;letter-spacing:-.02em;margin-bottom:16px}
.lpc .trust p{font-size:17px;line-height:1.75;color:var(--slate)}
.lpc .feats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1000px;margin:0 auto;padding:20px 8vw 70px}
.lpc .card{background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 22px;box-shadow:0 6px 24px rgba(12,42,71,.05)}
.lpc .card b{font-size:17px;display:block;margin-bottom:8px}
.lpc .card p{font-size:14px;line-height:1.6;color:var(--slate)}
.lpc .final{text-align:center;padding:50px 8vw 90px}
.lpc .foot{display:flex;align-items:center;justify-content:space-between;padding:28px 8vw;border-top:1px solid var(--line);font-size:13px;color:var(--mut)}
.lpc .foot .grad{font-weight:700;font-size:16px}
@media(max-width:860px){.lpc .feats{grid-template-columns:1fr}.lpc .chip{right:0;width:210px}}
`;
