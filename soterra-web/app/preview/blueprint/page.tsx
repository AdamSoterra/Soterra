"use client";
import { useEffect } from "react";

// Soterra landing — Direction "Blueprint".
// Light, architectural: the whole page speaks construction drawing — dimension
// lines, section bubbles, a building that draws itself, a real title-block.
export default function PreviewBlueprint() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")),
      { threshold: 0.14 }
    );
    document.querySelectorAll(".bl .rv").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="bl">
      <style>{CSS}</style>
      <div className="paper" aria-hidden="true" />

      <header className="nav">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" />
          <span>Soter<b>ra</b></span>
        </div>
        <div className="navcta">
          <a className="ghost" href="/">Log in</a>
          <a className="solid" href="/">Get set up</a>
        </div>
      </header>

      <section className="hero">
        <div className="hcopy">
          <div className="pill">Backed by your plans — never guessed</div>
          <h1>Ask your project&apos;s<br />plans <span className="g">anything.</span></h1>
          <p>
            Soterra reads your whole drawing set, so your crew gets instant answers cited to the exact sheet — and runs
            the site calendar — without digging through hundreds of pages.
          </p>
          <div className="cta">
            <a className="solid big" href="/">Get set up</a>
            <a className="ghost big" href="/">Log in</a>
          </div>
          <div className="note">An intelligent partner that knows your project inside out.</div>
        </div>

        <div className="sheet rv in">
          <div className="sheet-frame" />
          <svg className="dwg" viewBox="0 0 460 320" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {/* grid reference */}
            <line className="grid" x1="120" y1="46" x2="120" y2="262" />
            <circle className="gbub" cx="120" cy="40" r="13" />
            <text className="gtx" x="120" y="44">A</text>
            {/* ground line */}
            <line className="d1 dim" x1="58" y1="262" x2="410" y2="262" />
            {/* building outline */}
            <path className="d1 wall" d="M120 262 V150 L235 86 L350 150 V262" />
            <line className="d2 wall" x1="120" y1="200" x2="350" y2="200" />
            {/* door (highlighted) */}
            <rect className="door" x="206" y="200" width="58" height="62" />
            <rect className="d3 line" x="206" y="200" width="58" height="62" />
            {/* windows */}
            <rect className="d3 line" x="146" y="216" width="40" height="34" />
            <rect className="d3 line" x="288" y="216" width="40" height="34" />
            <rect className="d3 line" x="150" y="158" width="38" height="30" />
            <rect className="d3 line" x="286" y="158" width="38" height="30" />
            {/* width dimension */}
            <line className="d4 ext" x1="120" y1="262" x2="120" y2="292" />
            <line className="d4 ext" x1="350" y1="262" x2="350" y2="292" />
            <line className="d4 dim" x1="120" y1="286" x2="350" y2="286" />
            <line className="d4 tick" x1="120" y1="281" x2="120" y2="291" />
            <line className="d4 tick" x1="350" y1="281" x2="350" y2="291" />
            <text className="dimtx" x="235" y="283">9.2 m</text>
            {/* height dimension */}
            <line className="d4 ext" x1="120" y1="86" x2="86" y2="86" />
            <line className="d4 dim" x1="92" y1="86" x2="92" y2="262" />
            <line className="d4 tick" x1="87" y1="86" x2="97" y2="86" />
            <line className="d4 tick" x1="87" y1="262" x2="97" y2="262" />
            <text className="dimtx vt" x="80" y="178" transform="rotate(-90 80 178)">6.4 m</text>
            {/* leader to title block */}
            <line className="lead" x1="235" y1="231" x2="360" y2="300" />
            <circle className="leaddot" cx="235" cy="231" r="3.5" />
          </svg>

          <div className="answer rv in">
            <div className="asrc">From your plans</div>
            <p>Exterior doors: <b>FRR 60</b>, 910 × 2240 × 48&nbsp;mm leaf.</p>
          </div>

          <div className="titleblock">
            <div className="tb-c"><small>Project</small><b>43 Kauri Road</b></div>
            <div className="tb-c"><small>Sheet</small><b>ED003 · Door Schedule</b></div>
            <div className="tb-c"><small>Page</small><b>60 / 85</b></div>
            <div className="tb-c rev"><small>Rev</small><b>A</b></div>
          </div>
        </div>
      </section>

      <section className="does">
        <div className="detail rv">
          <div className="bub">1</div>
          <div className="dtext">
            <h2>It knows your plans — so decisions happen on the spot.</h2>
            <p>
              A fire rating, the GIB in a wet area, a beam size, a setout — instead of digging through hundreds of pages
              or ringing the designer, just ask. The answer comes back in seconds, pointed at the exact sheet. And it
              never guesses: if it&apos;s not in your plans, it tells you.
            </p>
          </div>
          <div className="dvis">
            <div className="qrow">What R-value for the external walls?</div>
            <div className="arow">
              <div className="asrc">From your plans</div>
              <p><b>R 2.8</b> batts to all external timber-framed walls.</p>
              <div className="minitb"><span className="mtc">SP-04</span><span>Thermal &amp; Moisture</span><span className="mtp">p2/14</span></div>
            </div>
          </div>
        </div>

        <div className="detail rev rv">
          <div className="bub">2</div>
          <div className="dtext">
            <h2>It runs the schedule — so nothing gets forgotten.</h2>
            <p>
              Inspections, deliveries, pours, sign-offs — miss one and the whole job stalls. Soterra keeps the site
              calendar for the whole crew. Book it by just saying it — &ldquo;pre-line inspection Tuesday 9am&rdquo; — and
              it reminds everyone.
            </p>
          </div>
          <div className="dvis">
            <div className="setout">
              <div className="so-h"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span></div>
              <div className="so-g">
                <span /><span className="ev a">Inspection</span><span /><span /><span className="ev p">Pour</span>
                <span className="ev b">Delivery</span><span /><span /><span className="ev g">Blocklayers</span><span />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="trust rv">
        <div className="trtag">— general note —</div>
        <h2>It never invents a code, a rating, or a number.</h2>
        <p>
          Soterra only answers from the drawings and specs you upload, and shows you the exact sheet every time. That&apos;s
          the difference between a tool you can trust on site and one you can&apos;t.
        </p>
      </section>

      <section className="how">
        <h2 className="rv">Live on your project in minutes.</h2>
        <div className="steps">
          {[
            { n: "01", t: "Upload your set", d: "Drop the whole drawing and spec set — every page read and indexed." },
            { n: "02", t: "Ask anything", d: "Materials, ratings, dimensions, finishes — cited to the sheet." },
            { n: "03", t: "Run the site", d: "Book inspections, deliveries and pours from the same chat." },
          ].map((s, i) => (
            <div className="step rv" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
              <span className="sn">{s.n}</span>
              <b>{s.t}</b>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="final rv">
        <h2>The answer&apos;s in the plans.</h2>
        <p>Fewer mistakes, faster decisions, nothing slips. Get your project set up today.</p>
        <a className="solid big" href="/">Get your project set up →</a>
      </section>

      <footer className="foot">
        <div className="ftb">
          <div className="ftc"><small>Drawn by</small><b>Soterra</b></div>
          <div className="ftc"><small>Title</small><b>Ask anything · run the site</b></div>
          <div className="ftc"><small>Scale</small><b>1 : 1</b></div>
          <div className="ftc"><small>Rev</small><b>A</b></div>
        </div>
      </footer>
    </div>
  );
}

const CSS = `
.bl{--g:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);--brand:#0E8FE6;--brand-d:#0A78C8;--blue:#0A8DED;--ink:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#FBFDFF;--line:#E6EFF9;--line2:#DCE7F2;--amber:#F0A020;color:var(--ink);font-family:var(--font);min-height:100vh;overflow-x:hidden;position:relative;background:var(--bg)}
.bl *{box-sizing:border-box}
.bl .g{background:var(--g);-webkit-background-clip:text;background-clip:text;color:transparent}
.bl .rv{opacity:0;transform:translateY(20px);transition:opacity .7s ease,transform .7s ease}
.bl .rv.in{opacity:1;transform:none}
.bl a{text-decoration:none}
.bl .paper{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(rgba(10,141,237,.04) 1px,transparent 1px),linear-gradient(90deg,rgba(10,141,237,.04) 1px,transparent 1px);background-size:30px 30px}
.bl>*:not(.paper){position:relative;z-index:1}
/* nav */
.bl .nav{display:flex;align-items:center;justify-content:space-between;padding:18px 7vw;position:sticky;top:0;z-index:30;background:rgba(251,253,255,.8);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.bl .brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:500;letter-spacing:-.01em;color:var(--ink)}
.bl .brand b{font-weight:700}
.bl .brand img{height:28px}
.bl .navcta{display:flex;gap:10px}
.bl .ghost{font-size:14px;font-weight:600;color:var(--ink);padding:9px 17px;border:1px solid var(--line2);border-radius:11px;background:#fff}
.bl .ghost:hover{border-color:var(--brand)}
.bl .solid{font-size:14px;font-weight:600;color:#fff;background:var(--g);padding:10px 18px;border-radius:11px;box-shadow:0 10px 26px rgba(10,141,237,.28)}
.bl .solid:hover{filter:brightness(1.05)}
.bl .big{padding:15px 28px;font-size:15px;border-radius:13px}
/* hero */
.bl .hero{display:grid;grid-template-columns:1.02fr .98fr;gap:54px;align-items:center;max-width:1220px;margin:0 auto;padding:60px 7vw 80px}
.bl .pill{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:var(--brand-d);background:rgba(14,143,230,.07);border:1px solid rgba(14,143,230,.16);padding:8px 15px;border-radius:30px;margin-bottom:22px}
.bl h1{font-size:clamp(38px,5vw,62px);line-height:1.04;letter-spacing:-.035em;font-weight:300;margin-bottom:20px}
.bl h1 .g{font-weight:700}
.bl .hcopy>p{font-size:17.5px;line-height:1.62;color:var(--slate);max-width:500px;margin-bottom:28px}
.bl .cta{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px}
.bl .note{font-size:13.5px;color:var(--mut);font-weight:500;border-left:2px solid var(--line2);padding-left:13px}
/* sheet */
.bl .sheet{position:relative;background:#fff;border:1px solid var(--line2);border-radius:6px;box-shadow:0 40px 90px rgba(12,42,71,.14);padding:18px 18px 0;justify-self:end;width:100%;max-width:500px}
.bl .sheet-frame{position:absolute;inset:9px;border:1px solid var(--line);border-radius:3px;pointer-events:none}
.bl .dwg{display:block;width:100%;height:auto}
.bl .dwg .wall{fill:none;stroke:var(--blue);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.bl .dwg .line{fill:none;stroke:var(--brand);stroke-width:1.4}
.bl .dwg .dim{stroke:var(--mut);stroke-width:1}
.bl .dwg .ext{stroke:var(--mut);stroke-width:.8}
.bl .dwg .tick{stroke:var(--mut);stroke-width:1.4}
.bl .dwg .grid{stroke:var(--line2);stroke-width:1;stroke-dasharray:4 4}
.bl .dwg .gbub{fill:#fff;stroke:var(--mut);stroke-width:1}
.bl .dwg .gtx{fill:var(--slate);font-size:13px;font-weight:600;text-anchor:middle;font-family:var(--font)}
.bl .dwg .dimtx{fill:var(--slate);font-size:11px;text-anchor:middle;font-family:ui-monospace,'SF Mono',Menlo,monospace}
.bl .dwg .door{fill:rgba(240,160,32,.14)}
.bl .dwg .lead{stroke:var(--amber);stroke-width:1;stroke-dasharray:3 3}
.bl .dwg .leaddot{fill:var(--amber)}
.bl .dwg .wall,.bl .dwg .line,.bl .dwg .dim,.bl .dwg .ext,.bl .dwg .tick{stroke-dasharray:1200;stroke-dashoffset:1200;animation:bldraw 2.6s ease forwards}
.bl .dwg .d2{animation-delay:.9s}.bl .dwg .d3{animation-delay:1.2s}.bl .dwg .d4{animation-delay:1.7s}
.bl .dwg .lead{stroke-dasharray:160;stroke-dashoffset:160;animation:bldraw 1s ease 2.4s forwards}
@keyframes bldraw{to{stroke-dashoffset:0}}
.bl .answer{position:absolute;right:14px;top:30px;width:215px;background:#fff;border:1px solid var(--line2);border-radius:12px;padding:12px 14px;box-shadow:0 16px 40px rgba(12,42,71,.16);animation:blfloat 5s ease-in-out infinite}
.bl .asrc{font-size:10px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-d);margin-bottom:6px}
.bl .answer p{font-size:13px;line-height:1.5;color:var(--slate)}.bl .answer p b{color:var(--ink)}
@keyframes blfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.bl .titleblock{display:grid;grid-template-columns:1.3fr 1.6fr .8fr .5fr;border-top:1px solid var(--line2);margin:8px -18px 0}
.bl .tb-c{padding:11px 14px;border-right:1px solid var(--line)}
.bl .tb-c:last-child{border-right:none}
.bl .tb-c small{display:block;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin-bottom:3px}
.bl .tb-c b{font-size:12.5px;color:var(--ink);font-weight:600}
.bl .tb-c.rev b{color:var(--brand-d)}
/* does */
.bl .does{max-width:1080px;margin:0 auto;padding:50px 7vw 20px;display:flex;flex-direction:column;gap:60px}
.bl .detail{display:grid;grid-template-columns:auto 1fr 1fr;gap:28px;align-items:center}
.bl .detail.rev .dtext{order:2}.bl .detail.rev .bub{order:1}.bl .detail.rev .dvis{order:0}
.bl .bub{width:46px;height:46px;border-radius:50%;border:1.5px solid var(--brand);color:var(--brand-d);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:19px;flex-shrink:0;background:#fff;align-self:start;margin-top:6px}
.bl .dtext h2{font-size:clamp(22px,2.7vw,30px);font-weight:600;letter-spacing:-.02em;line-height:1.18;margin-bottom:13px}
.bl .dtext p{font-size:15.5px;line-height:1.66;color:var(--slate)}
.bl .dvis{background:#fff;border:1px solid var(--line2);border-radius:16px;padding:20px;box-shadow:0 10px 30px rgba(12,42,71,.06)}
.bl .qrow{margin-left:auto;width:fit-content;max-width:90%;background:var(--g);color:#fff;font-size:13.5px;font-weight:500;padding:11px 15px;border-radius:15px 15px 4px 15px}
.bl .arow{margin-top:12px;background:var(--bg);border:1px solid var(--line);border-radius:15px 15px 15px 4px;padding:13px 15px}
.bl .arow p{font-size:13.5px;color:var(--slate)}.bl .arow p b{color:var(--ink)}
.bl .minitb{margin-top:11px;display:flex;align-items:center;gap:10px;border:1px solid var(--line2);border-radius:9px;padding:8px 11px;font-size:11.5px;color:var(--slate)}
.bl .minitb .mtc{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-weight:600;color:var(--ink)}
.bl .minitb .mtp{margin-left:auto;font-family:ui-monospace,'SF Mono',Menlo,monospace;color:var(--mut)}
.bl .setout .so-h{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:6px}
.bl .setout .so-h span{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);text-align:center}
.bl .setout .so-g{display:grid;grid-template-columns:repeat(5,1fr);grid-auto-rows:38px;gap:6px}
.bl .setout .so-g>span{border:1px dashed var(--line2);border-radius:7px}
.bl .setout .ev{border:none;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;color:#fff;border-radius:7px}
.bl .setout .ev.a{background:#F0A020}.bl .setout .ev.b{background:var(--brand)}.bl .setout .ev.g{background:#10B981}.bl .setout .ev.p{background:#8B5CF6}
/* trust */
.bl .trust{max-width:760px;margin:0 auto;padding:80px 7vw;text-align:center}
.bl .trtag{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);margin-bottom:16px}
.bl .trust h2{font-size:clamp(25px,3.3vw,38px);font-weight:300;letter-spacing:-.02em;margin-bottom:16px;line-height:1.15}
.bl .trust h2{font-weight:600}
.bl .trust p{font-size:17px;line-height:1.7;color:var(--slate);max-width:600px;margin:0 auto}
/* how */
.bl .how{max-width:1040px;margin:0 auto;padding:20px 7vw 70px;text-align:center}
.bl .how h2{font-size:clamp(24px,3vw,36px);font-weight:600;letter-spacing:-.02em;margin-bottom:38px}
.bl .steps{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.bl .step{text-align:left;background:#fff;border:1px solid var(--line2);border-radius:16px;padding:24px;box-shadow:0 6px 24px rgba(12,42,71,.05)}
.bl .sn{font-family:ui-monospace,'SF Mono',Menlo,monospace;font-size:13px;font-weight:600;color:var(--brand-d);letter-spacing:.05em}
.bl .step b{font-size:17px;display:block;margin:12px 0 7px}
.bl .step p{font-size:14px;line-height:1.6;color:var(--slate)}
/* final */
.bl .final{text-align:center;max-width:720px;margin:0 auto;padding:40px 7vw 80px}
.bl .final h2{font-size:clamp(28px,3.8vw,44px);font-weight:300;letter-spacing:-.025em;margin-bottom:14px}
.bl .final p{font-size:17px;color:var(--slate);margin-bottom:28px}
/* footer title block */
.bl .foot{border-top:1px solid var(--line2);background:#fff}
.bl .ftb{display:grid;grid-template-columns:1fr 2fr .8fr .5fr;max-width:1220px;margin:0 auto}
.bl .ftc{padding:16px 7vw;border-right:1px solid var(--line)}
.bl .ftc:first-child{padding-left:7vw}.bl .ftc{padding-left:20px;padding-right:20px}
.bl .ftc:last-child{border-right:none}
.bl .ftc small{display:block;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--mut);margin-bottom:4px}
.bl .ftc b{font-size:13px;color:var(--ink);font-weight:600}
@media(max-width:880px){.bl .hero{grid-template-columns:1fr;gap:40px}.bl .sheet{justify-self:stretch;max-width:none;order:-1}.bl .detail{grid-template-columns:auto 1fr;gap:18px}.bl .dvis{grid-column:1/-1}.bl .detail.rev .dvis{order:3}.bl .detail.rev .dtext{order:2}.bl .steps{grid-template-columns:1fr}.bl .ftb{grid-template-columns:1fr 1fr}}
`;
