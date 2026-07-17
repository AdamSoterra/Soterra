"use client";
import { useEffect, useRef } from "react";

// Soterra landing — Direction "Editorial".
// Minimal, premium, type-led (Stripe / Arc energy). Acres of white, one huge
// line, a single beautifully-built answer card with real depth + subtle tilt.
export default function PreviewEditorial() {
  const tiltRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.16 }
    );
    document.querySelectorAll(".ed .rv").forEach((el) => io.observe(el));

    const card = tiltRef.current;
    const onMove = (e: MouseEvent) => {
      if (!card || window.innerWidth < 880) return;
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `rotateY(${px * 9}deg) rotateX(${-py * 9}deg)`;
    };
    const onLeave = () => { if (card) card.style.transform = "rotateY(0) rotateX(0)"; };
    window.addEventListener("mousemove", onMove);
    card?.addEventListener("mouseleave", onLeave);
    return () => {
      io.disconnect();
      window.removeEventListener("mousemove", onMove);
      card?.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div className="ed">
      <style>{CSS}</style>

      <header className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" />
          <span>Soterra</span>
        </div>
        <div className="navcta">
          <a className="lnk" href="/">Log in</a>
          <a className="solid" href="/">Get set up</a>
        </div>
      </header>

      <section className="hero">
        <div className="hcopy rv in">
          <div className="eyebrow">An intelligent partner for your site</div>
          <h1>Ask your project&apos;s plans <span className="g">anything.</span></h1>
          <p>
            Soterra knows your whole drawing set inside out and keeps your site schedule — so the right call gets made
            faster, and nothing slips.
          </p>
          <div className="cta">
            <a className="solid big" href="/">Get set up</a>
            <a className="lnk arr" href="/">Log in →</a>
          </div>
        </div>

        <div className="cardstage">
          <div className="floatwrap">
            <div className="card3d" ref={tiltRef}>
              <div className="ec-top"><span className="ec-mark" />Soterra · 43 Kauri Road</div>
              <div className="ec-q">What&apos;s the fire rating on the exterior doors?</div>
              <div className="ec-src">From your plans</div>
              <div className="ec-a"><b>FRR 60</b> — fire-rated 60 minutes. Leaf 910 × 2240 × 48&nbsp;mm.</div>
              <div className="ec-cite">
                <div className="ec-ci">▦</div>
                <div className="ec-ct"><b>ED003 · Door Schedule</b><small>95% Detail Design · p60 of 85</small></div>
                <div className="ec-ca">›</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="split">
        <div className="block rv">
          <span className="bn">01</span>
          <h2>It knows your plans.</h2>
          <p>
            A fire rating, the GIB in a wet area, a beam size, a setout. Ask in plain words and the answer comes back in
            seconds — pointed at the exact sheet. Decisions get made on site, immediately, and they&apos;re right.
          </p>
        </div>
        <div className="rule rv" />
        <div className="block rv">
          <span className="bn">02</span>
          <h2>It runs the schedule.</h2>
          <p>
            Inspections, deliveries, pours, sign-offs. Book them by just saying so, and Soterra keeps the whole crew in
            sync and reminds everyone. Nothing gets forgotten.
          </p>
        </div>
      </section>

      <section className="manifesto rv">
        <p>
          If it&apos;s not in your plans, <em>it tells you.</em><br />No guessing. No bluffing.
        </p>
        <div className="msub">Every answer is cited to the exact sheet — which is what makes it safe to use on site.</div>
      </section>

      <section className="how">
        <div className="steps">
          {[
            { n: "01", t: "Upload your set", d: "The whole drawing and spec set — read and indexed, every page." },
            { n: "02", t: "Ask anything", d: "Materials, ratings, dimensions, finishes — cited to the sheet." },
            { n: "03", t: "Run the site", d: "Book inspections, deliveries and pours from the same chat." },
          ].map((s, i) => (
            <div className="hstep rv" style={{ transitionDelay: `${i * 100}ms` }} key={s.n}>
              <span className="hn">{s.n}</span>
              <div><b>{s.t}</b><p>{s.d}</p></div>
            </div>
          ))}
        </div>
      </section>

      <section className="final rv">
        <h2>The answer&apos;s in the plans.</h2>
        <p>Fewer mistakes. Faster decisions. Nothing slips.</p>
        <a className="solid big" href="/">Get set up →</a>
      </section>

      <footer className="foot">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" /><span>Soterra</span>
        </div>
        <span className="ft-tag">Just ask.</span>
      </footer>
    </div>
  );
}

const CSS = `
.ed{--g:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);--brand:#0E8FE6;--brand-d:#0A78C8;--ink:#0B1B30;--slate:#5A6E89;--mut:#9AAAC0;--bg:#FFFFFF;--line:#ECF1F7;color:var(--ink);font-family:var(--font);min-height:100vh;overflow-x:hidden;background:var(--bg)}
.ed *{box-sizing:border-box}
.ed .g{background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.ed .rv{opacity:0;transform:translateY(22px);transition:opacity .8s cubic-bezier(.2,.7,.2,1),transform .8s cubic-bezier(.2,.7,.2,1)}
.ed .rv.in{opacity:1;transform:none}
.ed a{text-decoration:none}
/* nav */
.ed .nav{display:flex;align-items:center;justify-content:space-between;padding:24px 8vw;max-width:1280px;margin:0 auto}
.ed .brand{display:flex;align-items:center;gap:10px;font-size:19px;font-weight:600;letter-spacing:-.01em}
.ed .brand img{height:27px}
.ed .navcta{display:flex;align-items:center;gap:22px}
.ed .lnk{font-size:14.5px;font-weight:600;color:var(--ink)}
.ed .lnk:hover{color:var(--brand-d)}
.ed .solid{font-size:14px;font-weight:600;color:#fff;background:var(--ink);padding:11px 20px;border-radius:30px}
.ed .solid:hover{background:var(--brand-d)}
.ed .big{padding:15px 30px;font-size:15px}
/* hero */
.ed .hero{display:grid;grid-template-columns:1.05fr .95fr;gap:40px;align-items:center;max-width:1240px;margin:0 auto;padding:70px 8vw 96px}
.ed .eyebrow{font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--brand-d);margin-bottom:24px}
.ed h1{font-size:clamp(44px,6.2vw,82px);line-height:1.02;letter-spacing:-.045em;font-weight:300;margin-bottom:28px}
.ed .hcopy>p{font-size:19px;line-height:1.6;color:var(--slate);max-width:460px;margin-bottom:36px;font-weight:300}
.ed .cta{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.ed .arr{font-weight:600}
/* hero card */
.ed .cardstage{perspective:1200px;display:flex;justify-content:center}
.ed .floatwrap{animation:edfloat 6s ease-in-out infinite}
.ed .card3d{width:100%;max-width:420px;background:#fff;border:1px solid var(--line);border-radius:22px;padding:26px 26px 22px;transition:transform .25s ease;transform-style:preserve-3d;
  box-shadow:0 2px 6px rgba(11,27,48,.04),0 18px 40px rgba(11,27,48,.08),0 50px 90px rgba(11,27,48,.12)}
.ed .ec-top{display:flex;align-items:center;gap:9px;font-size:12.5px;color:var(--mut);font-weight:500;margin-bottom:20px}
.ed .ec-mark{width:10px;height:10px;border-radius:3px;background:var(--g)}
.ed .ec-q{font-size:16px;font-weight:600;color:var(--ink);line-height:1.4;margin-bottom:22px;letter-spacing:-.01em}
.ed .ec-src{font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-d);margin-bottom:9px}
.ed .ec-a{font-size:15px;line-height:1.55;color:var(--slate)}.ed .ec-a b{color:var(--ink)}
.ed .ec-cite{margin-top:18px;display:flex;align-items:center;gap:13px;border-top:1px solid var(--line);padding-top:16px}
.ed .ec-ci{width:40px;height:40px;border-radius:11px;background:var(--bg);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--brand);font-size:17px;flex-shrink:0}
.ed .ec-ct{flex:1;min-width:0}.ed .ec-ct b{display:block;font-size:14px;color:var(--ink);font-weight:600}.ed .ec-ct small{font-size:12px;color:var(--mut)}
.ed .ec-ca{color:var(--brand);font-size:22px}
@keyframes edfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
/* split */
.ed .split{max-width:1080px;margin:0 auto;padding:30px 8vw 60px;display:grid;grid-template-columns:1fr auto 1fr;gap:48px;align-items:start}
.ed .block .bn{font-size:13px;font-weight:600;color:var(--mut);letter-spacing:.05em}
.ed .block h2{font-size:clamp(26px,3.2vw,38px);font-weight:300;letter-spacing:-.03em;margin:14px 0 16px;line-height:1.1}
.ed .block p{font-size:16.5px;line-height:1.7;color:var(--slate);font-weight:300}
.ed .rule{width:1px;align-self:stretch;background:linear-gradient(180deg,transparent,var(--line),transparent)}
/* manifesto */
.ed .manifesto{max-width:880px;margin:0 auto;padding:90px 8vw;text-align:center}
.ed .manifesto p{font-size:clamp(30px,4.6vw,54px);line-height:1.16;letter-spacing:-.035em;font-weight:300;color:var(--ink)}
.ed .manifesto em{font-style:italic;background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.ed .msub{font-size:17px;line-height:1.6;color:var(--slate);max-width:520px;margin:30px auto 0;font-weight:300}
/* how */
.ed .how{max-width:1000px;margin:0 auto;padding:30px 8vw 80px}
.ed .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:36px}
.ed .hstep{display:flex;flex-direction:column;gap:14px}
.ed .hn{font-size:14px;font-weight:600;color:var(--brand-d);letter-spacing:.05em;padding-bottom:14px;border-bottom:1px solid var(--line)}
.ed .hstep b{font-size:18px;font-weight:600;display:block;margin-bottom:7px;letter-spacing:-.01em}
.ed .hstep p{font-size:14.5px;line-height:1.65;color:var(--slate);font-weight:300}
/* final */
.ed .final{text-align:center;max-width:760px;margin:0 auto;padding:60px 8vw 100px}
.ed .final h2{font-size:clamp(34px,5vw,60px);font-weight:300;letter-spacing:-.04em;margin-bottom:18px;line-height:1.05}
.ed .final p{font-size:18px;color:var(--slate);margin-bottom:34px;font-weight:300}
.ed .foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;max-width:1240px;margin:0 auto;padding:30px 8vw;border-top:1px solid var(--line)}
.ed .foot .brand{font-size:16px}.ed .foot .brand img{height:22px}
.ed .ft-tag{font-size:14px;color:var(--mut)}
@media(max-width:880px){.ed .hero{grid-template-columns:1fr;gap:50px;padding-top:48px}.ed .split{grid-template-columns:1fr;gap:40px}.ed .rule{display:none}.ed .steps{grid-template-columns:1fr;gap:30px}.ed .cardstage{perspective:none}.ed .card3d{transform:none!important}}
`;
