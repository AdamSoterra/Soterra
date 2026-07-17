"use client";
import { useEffect } from "react";

// Soterra landing — Direction "Structure".
// Isometric building (digital-twin / BIM energy) with answers pinned to it.
export default function PreviewStructure() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.14 }
    );
    document.querySelectorAll(".st .rv").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="st">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" />
          <span>Soterra</span>
        </div>
        <div className="navcta">
          <a className="ghost" href="/">Log in</a>
          <a className="solid" href="/">Get set up</a>
        </div>
      </header>

      <section className="hero">
        <div className="hcopy rv in">
          <div className="pill">An intelligent partner for your site</div>
          <h1>Your whole project,<br /><span className="g">one question away.</span></h1>
          <p>
            Soterra knows every drawing and spec in your set, and keeps the whole site schedule — so the right call gets
            made on the spot, and nothing slips.
          </p>
          <div className="cta">
            <a className="solid big" href="/">Get set up</a>
            <a className="ghost big" href="/">Log in</a>
          </div>
        </div>

        <div className="ststage">
          <div className="floor-shadow" aria-hidden="true" />
          <svg className="iso" viewBox="0 0 460 360" aria-hidden="true">
            <g className="bld">
              {/* right face (light) */}
              <path className="face fr" d="M230 170 L350 110 L350 266 L230 326 Z" />
              {/* left face (dark) */}
              <path className="face fl" d="M110 110 L230 170 L230 326 L110 266 Z" />
              {/* roof */}
              <path className="face ft" d="M110 110 L230 50 L350 110 L230 170 Z" />
              {/* floor lines left */}
              <line className="fln l1" x1="110" y1="149" x2="230" y2="209" />
              <line className="fln l2" x1="110" y1="188" x2="230" y2="248" />
              <line className="fln l3" x1="110" y1="227" x2="230" y2="287" />
              {/* floor lines right */}
              <line className="fln l1" x1="230" y1="209" x2="350" y2="149" />
              <line className="fln l2" x1="230" y1="248" x2="350" y2="188" />
              <line className="fln l3" x1="230" y1="287" x2="350" y2="227" />
              {/* mullions */}
              <line className="mul" x1="150" y1="130" x2="150" y2="286" />
              <line className="mul" x1="190" y1="150" x2="190" y2="306" />
              <line className="mul" x1="270" y1="150" x2="270" y2="306" />
              <line className="mul" x1="310" y1="130" x2="310" y2="286" />
            </g>

            {/* pins */}
            <g className="pin p1">
              <circle className="halo" cx="300" cy="150" r="13" />
              <circle className="dot" cx="300" cy="150" r="5" />
            </g>
            <g className="pin p2">
              <circle className="halo" cx="168" cy="206" r="12" />
              <circle className="dot" cx="168" cy="206" r="4.5" />
            </g>
            <g className="pin p3">
              <circle className="halo" cx="250" cy="262" r="12" />
              <circle className="dot" cx="250" cy="262" r="4.5" />
            </g>
          </svg>

          <div className="tip">
            <div className="tip-src">From your plans</div>
            <p>Exterior doors: <b>FRR 60</b></p>
            <small>ED003 · Door Schedule</small>
          </div>
          <div className="tag-ask t1">Beam over the garage?</div>
          <div className="tag-ask t2">R-value, ext. walls?</div>
        </div>
      </section>

      <section className="pillars">
        {[
          { t: "It knows your plans", d: "Ask any drawing or spec in plain words — answered in seconds, cited to the exact sheet, never guessed." },
          { t: "It runs the schedule", d: "Inspections, deliveries, pours and sign-offs — booked from chat, the whole crew in sync, nothing forgotten." },
          { t: "Your whole crew", d: "One invite code. Everyone on site asks the same brain and sees the same schedule." },
        ].map((p, i) => (
          <div className="pcard rv" style={{ transitionDelay: `${i * 90}ms` }} key={p.t}>
            <b>{p.t}</b>
            <p>{p.d}</p>
          </div>
        ))}
      </section>

      <section className="band">
        <div className="krow rv">
          <div className="ktext">
            <h2>Every part of the job, one place to ask.</h2>
            <p>
              A fire rating, the GIB in a wet area, a beam size, a setout — instead of digging through hundreds of pages
              or ringing the designer, just ask. The answer comes back in seconds, pointed at the exact sheet. And it
              never guesses: if it&apos;s not in your plans, it tells you.
            </p>
            <div className="kchk"><span>✓ Cited to the sheet</span><span>✓ Never guessed</span><span>✓ Whole crew in sync</span></div>
          </div>
          <div className="kvis">
            <div className="timeline">
              <div className="tl-h">This week on site</div>
              <div className="tl-row"><span className="tl-d">Tue</span><span className="tl-bar a" /><span className="tl-t">Council inspection · 9:00</span></div>
              <div className="tl-row"><span className="tl-d">Wed</span><span className="tl-bar b" /><span className="tl-t">GIB delivery · 1:00</span></div>
              <div className="tl-row"><span className="tl-d">Fri</span><span className="tl-bar p" /><span className="tl-t">Slab pour — 6 crew · 7:00</span></div>
            </div>
          </div>
        </div>
      </section>

      <section className="how">
        <h2 className="rv">Live on your project in minutes.</h2>
        <div className="steps">
          {[
            { n: "1", t: "Upload your set", d: "Drop the whole drawing and spec set — read and indexed, every page." },
            { n: "2", t: "Ask anything", d: "Materials, ratings, dimensions, finishes — cited to the sheet." },
            { n: "3", t: "Run the site", d: "Book inspections, deliveries and pours from the same chat." },
          ].map((s, i) => (
            <div className="step rv" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
              <div className="snum">{s.n}</div><b>{s.t}</b><p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="final rv">
        <h2>Fewer mistakes. Faster decisions. Nothing slips.</h2>
        <p>Set up your project and get your whole crew asking in minutes.</p>
        <a className="solid big" href="/">Get set up →</a>
      </section>

      <footer className="foot">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" /><span>Soterra</span>
        </div>
        <span>The answer&apos;s in the plans. Just ask.</span>
      </footer>
    </div>
  );
}

const CSS = `
.st{--g:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);--brand:#0E8FE6;--brand-d:#0A78C8;--ink:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F4F9FF;--line:#E2ECF8;color:var(--ink);font-family:var(--font);min-height:100vh;overflow-x:hidden;
  background:radial-gradient(900px 600px at 78% 8%,rgba(65,195,255,.16),transparent 60%),var(--bg)}
.st *{box-sizing:border-box}
.st .g{background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.st .rv{opacity:0;transform:translateY(20px);transition:opacity .7s ease,transform .7s ease}
.st .rv.in{opacity:1;transform:none}
.st a{text-decoration:none}
.st .nav{display:flex;align-items:center;justify-content:space-between;padding:18px 7vw;position:sticky;top:0;z-index:30;background:rgba(244,249,255,.78);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.st .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;letter-spacing:-.01em}
.st .brand img{height:28px}
.st .navcta{display:flex;gap:10px}
.st .ghost{font-size:14px;font-weight:600;color:var(--ink);padding:9px 17px;border:1px solid var(--line);border-radius:11px;background:#fff}
.st .ghost:hover{border-color:var(--brand)}
.st .solid{font-size:14px;font-weight:600;color:#fff;background:var(--g);padding:10px 18px;border-radius:11px;box-shadow:0 10px 26px rgba(10,141,237,.3)}
.st .solid:hover{filter:brightness(1.05)}
.st .big{padding:15px 28px;font-size:15px;border-radius:13px}
/* hero */
.st .hero{display:grid;grid-template-columns:1.02fr .98fr;gap:40px;align-items:center;max-width:1240px;margin:0 auto;padding:54px 7vw 70px}
.st .pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--brand-d);background:rgba(14,143,230,.07);border:1px solid rgba(14,143,230,.16);padding:8px 15px;border-radius:30px;margin-bottom:22px}
.st h1{font-size:clamp(38px,5vw,62px);line-height:1.04;letter-spacing:-.035em;font-weight:300;margin-bottom:20px}
.st h1 .g{font-weight:700}
.st .hcopy>p{font-size:17.5px;line-height:1.62;color:var(--slate);max-width:480px;margin-bottom:30px}
.st .cta{display:flex;gap:12px;flex-wrap:wrap}
/* iso stage */
.st .ststage{position:relative}
.st .iso{display:block;width:100%;height:auto;overflow:visible}
.st .floor-shadow{position:absolute;left:50%;bottom:6%;width:62%;height:42px;transform:translateX(-50%);background:radial-gradient(ellipse,rgba(12,42,71,.16),transparent 70%);filter:blur(3px)}
.st .bld{opacity:0;animation:strise 1s ease .15s forwards}
@keyframes strise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
.st .face{stroke:#fff;stroke-width:1;stroke-linejoin:round}
.st .ft{fill:#BFE2FF}
.st .fl{fill:#1683DC}
.st .fr{fill:#3FA7F0}
.st .fln{stroke:rgba(255,255,255,.5);stroke-width:1}
.st .mul{stroke:rgba(255,255,255,.28);stroke-width:1}
.st .fln{opacity:0;animation:stshow .5s ease forwards}
.st .fln.l1{animation-delay:.7s}.st .fln.l2{animation-delay:.85s}.st .fln.l3{animation-delay:1s}
@keyframes stshow{to{opacity:1}}
.st .pin .halo{fill:rgba(10,141,237,.22);animation:sthalo 2.2s ease-out infinite}
.st .pin .dot{fill:#0A8DED;stroke:#fff;stroke-width:2}
.st .pin{opacity:0;animation:stshow .4s ease forwards}
.st .pin.p1{animation-delay:1.2s}.st .pin.p2{animation-delay:1.45s}.st .pin.p3{animation-delay:1.7s}
.st .pin.p2 .halo,.st .pin.p3 .halo{animation-delay:.6s}
@keyframes sthalo{0%{transform-origin:center;opacity:.5}70%{opacity:0}100%{opacity:0}}
.st .pin .halo{transform-box:fill-box;transform-origin:center;animation:sthalo2 2.2s ease-out infinite}
@keyframes sthalo2{0%{transform:scale(.5);opacity:.6}80%{transform:scale(1.7);opacity:0}100%{opacity:0}}
.st .tip{position:absolute;right:2%;top:20%;width:190px;background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px 14px;box-shadow:0 18px 44px rgba(12,42,71,.18);opacity:0;animation:sttip .6s ease 1.5s forwards,stfloat 5s ease-in-out 2s infinite}
.st .tip-src{font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-d);margin-bottom:6px}
.st .tip p{font-size:14px;color:var(--slate)}.st .tip p b{color:var(--ink);font-weight:700}
.st .tip small{font-size:11.5px;color:var(--mut);font-family:ui-monospace,'SF Mono',Menlo,monospace}
@keyframes sttip{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes stfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.st .tag-ask{position:absolute;background:rgba(255,255,255,.9);border:1px solid var(--line);border-radius:30px;padding:7px 14px;font-size:12.5px;color:var(--slate);font-weight:500;box-shadow:0 8px 22px rgba(12,42,71,.1);opacity:0;animation:sttip .5s ease forwards}
.st .tag-ask.t1{left:0;top:14%;animation-delay:1.9s}
.st .tag-ask.t2{left:6%;bottom:16%;animation-delay:2.15s}
/* pillars */
.st .pillars{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1100px;margin:0 auto;padding:24px 7vw 40px}
.st .pcard{background:#fff;border:1px solid var(--line);border-radius:18px;padding:26px 24px;box-shadow:0 6px 26px rgba(12,42,71,.05)}
.st .pcard b{font-size:18px;display:block;margin-bottom:9px}
.st .pcard p{font-size:14.5px;line-height:1.6;color:var(--slate)}
/* band */
.st .band{max-width:1080px;margin:0 auto;padding:40px 7vw}
.st .krow{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.st .ktext h2{font-size:clamp(24px,3vw,34px);font-weight:300;letter-spacing:-.025em;line-height:1.14;margin-bottom:15px}
.st .ktext h2{font-weight:600}
.st .ktext>p{font-size:16px;line-height:1.68;color:var(--slate)}
.st .kchk{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:18px}
.st .kchk span{font-size:13px;color:var(--brand-d);font-weight:600}
.st .kvis{background:#fff;border:1px solid var(--line);border-radius:18px;padding:22px;box-shadow:0 16px 44px rgba(12,42,71,.08)}
.st .timeline .tl-h{font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin-bottom:14px}
.st .tl-row{display:flex;align-items:center;gap:13px;padding:9px 0}
.st .tl-d{font-size:11px;font-weight:700;color:var(--slate);width:30px;text-transform:uppercase}
.st .tl-bar{width:4px;height:30px;border-radius:3px}
.st .tl-bar.a{background:#F59E0B}.st .tl-bar.b{background:var(--brand)}.st .tl-bar.p{background:#8B5CF6}
.st .tl-t{font-size:13.5px;color:var(--ink)}
/* how */
.st .how{max-width:1040px;margin:0 auto;padding:40px 7vw 70px;text-align:center}
.st .how h2{font-size:clamp(24px,3vw,36px);font-weight:600;letter-spacing:-.02em;margin-bottom:38px}
.st .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.st .step{text-align:left;background:#fff;border:1px solid var(--line);border-radius:16px;padding:24px;box-shadow:0 6px 24px rgba(12,42,71,.05)}
.st .snum{width:40px;height:40px;border-radius:11px;background:var(--g);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;margin-bottom:15px;box-shadow:0 10px 24px rgba(10,141,237,.3)}
.st .step b{font-size:17px;display:block;margin-bottom:7px}
.st .step p{font-size:14px;line-height:1.6;color:var(--slate)}
/* final */
.st .final{text-align:center;max-width:760px;margin:0 auto;padding:40px 7vw 90px}
.st .final h2{font-size:clamp(26px,3.6vw,42px);font-weight:600;letter-spacing:-.025em;margin-bottom:14px;line-height:1.12}
.st .final p{font-size:17px;color:var(--slate);margin-bottom:30px}
.st .foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:26px 7vw;border-top:1px solid var(--line)}
.st .foot .brand{font-size:16px}.st .foot .brand img{height:22px}
.st .foot>span{font-size:13px;color:var(--mut)}
@media(max-width:880px){.st .hero{grid-template-columns:1fr;gap:30px}.st .ststage{max-width:460px;margin:0 auto}.st .pillars,.st .krow,.st .steps{grid-template-columns:1fr;gap:18px}.st .band .krow{gap:28px}}
`;
