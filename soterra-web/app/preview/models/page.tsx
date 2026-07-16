import type { CSSProperties } from "react";

// Layer 3 "model" visuals, round 2 (2026-07-16) — built from Adam's reference:
// real structural / BIM building models, not abstract diagrams.

const S: Record<string, CSSProperties> = {
  wrap: { minHeight: "100vh", background: "#F6FAFF", color: "#0C2A47", fontFamily: "'DM Sans', Arial, sans-serif", padding: "40px 6vw 80px" },
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 6 },
  sub: { color: "#52698A", fontSize: 15, marginBottom: 34, maxWidth: 720, lineHeight: 1.55 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(360px,1fr))", gap: 24, maxWidth: 1180, margin: "0 auto" },
  card: { background: "#fff", border: "1px solid #E7EFF9", borderRadius: 18, padding: 20, boxShadow: "0 12px 40px rgba(12,42,71,.06)" },
  tag: { display: "inline-block", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff", background: "linear-gradient(135deg,#41C3FF,#0A8DED)", padding: "5px 11px", borderRadius: 20, marginBottom: 6 },
  name: { fontSize: 18, fontWeight: 700, margin: "8px 0 2px" },
  desc: { fontSize: 13.5, color: "#52698A", marginBottom: 14, lineHeight: 1.5 },
  frame: { borderRadius: 14, overflow: "hidden", background: "#F6FAFF", border: "1px solid #EEF4FB" },
};

// ─── geometry helpers (2:1 isometric) ───
const HW = 105;   // half width  (x span 125..335, centre 230)
const HD = 52;    // half depth  (y span cy-52..cy+52)
const L = 230 - HW, R = 230 + HW;

const slabTop = (cy: number) => `230,${cy - HD} ${R},${cy} 230,${cy + HD} ${L},${cy}`;

/** One concrete floor plate: perimeter beam fascia + slab top. */
function Plate({ cy, t = 11 }: { cy: number; t?: number }) {
  return (
    <g>
      {/* front-left beam fascia */}
      <path d={`M${L} ${cy} L230 ${cy + HD} L230 ${cy + HD + t} L${L} ${cy + t} Z`} fill="#9FB0C4" />
      {/* front-right beam fascia (lit side) */}
      <path d={`M230 ${cy + HD} L${R} ${cy} L${R} ${cy + t} L230 ${cy + HD + t} Z`} fill="#B9C7D8" />
      {/* slab top */}
      <polygon points={slabTop(cy)} fill="url(#slabG)" stroke="#fff" strokeWidth="1" />
    </g>
  );
}

/** An isometric duct/pipe run: thick body + highlight = reads as a 3D tube. */
function Run({ d, w, body, hi }: { d: string; w: number; body: string; hi: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={body} strokeWidth={w} />
      <path d={d} stroke={hi} strokeWidth={Math.max(1.5, w * 0.32)} opacity="0.9" />
    </g>
  );
}

export default function ModelSamples() {
  const FLOORS = [271, 237, 203, 169, 135]; // bottom → top

  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Layer 3 model — round 2</h1>
      <p style={S.sub}>
        Built from your reference this time: an actual structural model and a BIM services model, not abstract diagrams.
        Tell Claude the number (or &ldquo;1&apos;s building with 2&apos;s services&rdquo; — mixing is fine).
      </p>
      <div style={S.grid}>

        {/* ── 1 — Concrete structural frame ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 1</span>
          <div style={S.name}>Structural frame</div>
          <div style={S.desc}>A real concrete frame: floor slabs with perimeter beams, perimeter + internal columns, and a lift/stair core running up through it. Closest to your grey 3D-model reference.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 380" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="slabG" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#F2F6FA" /><stop offset="1" stopColor="#DCE5EF" /></linearGradient>
                <linearGradient id="coreL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7C90A6" /><stop offset="1" stopColor="#63788F" /></linearGradient>
                <linearGradient id="coreR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#96A9BE" /><stop offset="1" stopColor="#7E93A9" /></linearGradient>
              </defs>
              <ellipse cx="230" cy="340" rx="126" ry="18" fill="rgba(12,42,71,.12)" />

              {/* columns (perimeter + internal), drawn behind the slabs */}
              <g stroke="#778CA2" strokeLinecap="round" fill="none">
                <line x1={L} y1="135" x2={L} y2="271" strokeWidth="7" />
                <line x1={R} y1="135" x2={R} y2="271" strokeWidth="7" />
                <line x1="230" y1="187" x2="230" y2="323" strokeWidth="7" />
                <line x1="177" y1="161" x2="177" y2="297" strokeWidth="5" />
                <line x1="283" y1="161" x2="283" y2="297" strokeWidth="5" />
                <line x1="204" y1="122" x2="204" y2="258" strokeWidth="3.4" opacity=".75" />
                <line x1="256" y1="122" x2="256" y2="258" strokeWidth="3.4" opacity=".75" />
              </g>

              {/* lift / stair core */}
              <g>
                <path d="M192 135 L230 154 L230 290 L192 271 Z" fill="url(#coreL)" />
                <path d="M230 154 L268 135 L268 271 L230 290 Z" fill="url(#coreR)" />
                <path d="M230 116 L268 135 L230 154 L192 135 Z" fill="#AEBFD2" stroke="#fff" strokeWidth="0.8" />
              </g>

              {/* floor plates, bottom → top so upper ones overlap correctly */}
              {FLOORS.map((cy) => <Plate key={cy} cy={cy} />)}

              {/* roof plant room */}
              <g>
                <path d="M206 108 L230 120 L230 140 L206 128 Z" fill="#9FB0C4" />
                <path d="M230 120 L254 108 L254 128 L230 140 Z" fill="#B9C7D8" />
                <polygon points="230,96 254,108 230,120 206,108" fill="#E8EFF6" stroke="#fff" strokeWidth="1" />
              </g>
            </svg>
          </div>
        </div>

        {/* ── 2 — BIM services cutaway ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 2</span>
          <div style={S.name}>BIM services cutaway</div>
          <div style={S.desc}>A floor cut open to show the coordinated services above the slab: yellow ductwork, hot/cold pipework, cable tray and drops. This is the &ldquo;BIM Modeling&rdquo; half of your reference.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 340" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="slabG2" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#F2F6FA" /><stop offset="1" stopColor="#DCE5EF" /></linearGradient>
              </defs>
              <ellipse cx="230" cy="300" rx="122" ry="17" fill="rgba(12,42,71,.10)" />

              {/* soffit / ceiling plane above (cutaway hint) */}
              <polygon points="230,68 335,120 230,172 125,120" fill="rgba(14,143,230,.07)" stroke="rgba(14,143,230,.28)" strokeWidth="1" strokeDasharray="4 3" />

              {/* services zone: duct + pipes + tray, routed on the iso axes */}
              {/* main duct, L-shaped run */}
              <Run d="M150 150 L235 192 L320 150" w="15" body="#E2A63C" hi="#F6D48A" />
              {/* branch duct */}
              <Run d="M235 192 L235 214 L292 186" w="9" body="#E2A63C" hi="#F6D48A" />
              {/* cold + hot pipework */}
              <Run d="M142 168 L232 213 L318 170" w="6.5" body="#2E8FDD" hi="#8FD0FF" />
              <Run d="M142 178 L232 223 L318 180" w="6.5" body="#D8503F" hi="#FF9C8E" />
              {/* cable tray */}
              <Run d="M160 136 L238 175 L312 138" w="5" body="#7B8C9E" hi="#C3CFDB" />
              {/* vertical drops into the floor */}
              <g stroke="#9AA9BA" strokeWidth="3" strokeLinecap="round">
                <line x1="188" y1="171" x2="188" y2="205" />
                <line x1="282" y1="171" x2="282" y2="205" />
              </g>
              <g fill="#E2A63C"><circle cx="188" cy="205" r="4" /><circle cx="282" cy="205" r="4" /></g>

              {/* the floor slab, cut */}
              <g>
                <path d={`M125 220 L230 272 L230 285 L125 233 Z`} fill="#9FB0C4" />
                <path d={`M230 272 L335 220 L335 233 L230 285 Z`} fill="#B9C7D8" />
                <polygon points="230,168 335,220 230,272 125,220" fill="url(#slabG2)" stroke="#fff" strokeWidth="1" />
              </g>
              {/* cut face hatch on the slab edge */}
              <g stroke="rgba(12,42,71,.25)" strokeWidth="1">
                <line x1="140" y1="226" x2="140" y2="239" /><line x1="160" y1="236" x2="160" y2="249" /><line x1="180" y1="246" x2="180" y2="259" />
                <line x1="300" y1="236" x2="300" y2="249" /><line x1="320" y1="226" x2="320" y2="239" />
              </g>
            </svg>
          </div>
        </div>

        {/* ── 3 — Frame + services combined ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 3</span>
          <div style={S.name}>Frame + services</div>
          <div style={S.desc}>The structural frame with coordinated services threaded through one floor — structure and BIM in a single image. Says &ldquo;everything about the building, in one model&rdquo; most directly.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 380" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="slabG3" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#F2F6FA" /><stop offset="1" stopColor="#DCE5EF" /></linearGradient>
              </defs>
              <ellipse cx="230" cy="340" rx="126" ry="18" fill="rgba(12,42,71,.12)" />

              <g stroke="#778CA2" strokeLinecap="round" fill="none">
                <line x1={L} y1="135" x2={L} y2="271" strokeWidth="7" />
                <line x1={R} y1="135" x2={R} y2="271" strokeWidth="7" />
                <line x1="230" y1="187" x2="230" y2="323" strokeWidth="7" />
                <line x1="177" y1="161" x2="177" y2="297" strokeWidth="5" />
                <line x1="283" y1="161" x2="283" y2="297" strokeWidth="5" />
              </g>

              {/* bottom two plates */}
              <g>
                <path d={`M${L} 271 L230 323 L230 334 L${L} 282 Z`} fill="#9FB0C4" />
                <path d={`M230 323 L${R} 271 L${R} 282 L230 334 Z`} fill="#B9C7D8" />
                <polygon points={slabTop(271)} fill="url(#slabG3)" stroke="#fff" strokeWidth="1" />
              </g>

              {/* exposed services on the middle floor */}
              <Run d="M158 216 L232 253 L306 216" w="12" body="#E2A63C" hi="#F6D48A" />
              <Run d="M152 230 L230 269 L310 229" w="5.5" body="#2E8FDD" hi="#8FD0FF" />
              <Run d="M152 238 L230 277 L310 237" w="5.5" body="#D8503F" hi="#FF9C8E" />

              <g>
                <path d={`M${L} 237 L230 289 L230 300 L${L} 248 Z`} fill="#9FB0C4" />
                <path d={`M230 289 L${R} 237 L${R} 248 L230 300 Z`} fill="#B9C7D8" />
                <polygon points={slabTop(237)} fill="url(#slabG3)" stroke="#fff" strokeWidth="1" />
              </g>

              {/* upper plates */}
              {[203, 169, 135].map((cy) => (
                <g key={cy}>
                  <path d={`M${L} ${cy} L230 ${cy + HD} L230 ${cy + HD + 11} L${L} ${cy + 11} Z`} fill="#9FB0C4" />
                  <path d={`M230 ${cy + HD} L${R} ${cy} L${R} ${cy + 11} L230 ${cy + HD + 11} Z`} fill="#B9C7D8" />
                  <polygon points={slabTop(cy)} fill="url(#slabG3)" stroke="#fff" strokeWidth="1" />
                </g>
              ))}
            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
