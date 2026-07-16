import type { CSSProperties } from "react";

// Layer 3 "model" visuals, round 3 (2026-07-16).
// Fix vs round 2: proportions. The old one read as stacked trays because the
// footprint was wide and the floor gaps short. These are taller than they are
// wide, with real mass, a core, and a crown.

const S: Record<string, CSSProperties> = {
  wrap: { minHeight: "100vh", background: "#F6FAFF", color: "#0C2A47", fontFamily: "'DM Sans', Arial, sans-serif", padding: "40px 6vw 80px" },
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 6 },
  sub: { color: "#52698A", fontSize: 15, marginBottom: 34, maxWidth: 760, lineHeight: 1.55 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 24, maxWidth: 1180, margin: "0 auto" },
  card: { background: "#fff", border: "1px solid #E7EFF9", borderRadius: 18, padding: 20, boxShadow: "0 12px 40px rgba(12,42,71,.06)" },
  tag: { display: "inline-block", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff", background: "linear-gradient(135deg,#41C3FF,#0A8DED)", padding: "5px 11px", borderRadius: 20, marginBottom: 6 },
  name: { fontSize: 18, fontWeight: 700, margin: "8px 0 2px" },
  desc: { fontSize: 13.5, color: "#52698A", marginBottom: 14, lineHeight: 1.5 },
  frame: { borderRadius: 14, overflow: "hidden", background: "#F6FAFF", border: "1px solid #EEF4FB" },
};

// ─── shared isometric geometry — footprint is deliberately NARROW so the tower
//     reads taller than it is wide (the round-2 mistake) ───
const CX = 230, HW = 84, HD = 42;
const L = CX - HW, R = CX + HW;          // 146 .. 314
const TOP = 104, GAP = 38, N = 6;        // 6 floors, 104 → 294
const BASE = TOP + GAP * (N - 1);        // 294
const cyOf = (k: number) => TOP + GAP * k;
const rhombus = (cy: number) => `${CX},${cy - HD} ${R},${cy} ${CX},${cy + HD} ${L},${cy}`;

/** Concrete floor plate: two edge-beam fascias + slab top. */
function Plate({ cy, t = 9 }: { cy: number; t?: number }) {
  return (
    <g>
      <path d={`M${L} ${cy} L${CX} ${cy + HD} L${CX} ${cy + HD + t} L${L} ${cy + t} Z`} fill="#9DAEC2" />
      <path d={`M${CX} ${cy + HD} L${R} ${cy} L${R} ${cy + t} L${CX} ${cy + HD + t} Z`} fill="#BAC8D9" />
      <polygon points={rhombus(cy)} fill="url(#slabG)" stroke="#fff" strokeWidth="1" />
    </g>
  );
}

/** Isometric tube: thick body + highlight reads as a 3D duct/pipe. */
function Run({ d, w, body, hi }: { d: string; w: number; body: string; hi: string }) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} stroke={body} strokeWidth={w} />
      <path d={d} stroke={hi} strokeWidth={Math.max(1.5, w * 0.3)} opacity="0.9" />
    </g>
  );
}

const COLS: [number, number][] = [
  [L, TOP], [R, TOP], [CX, TOP + HD],
  [(L + CX) / 2, TOP + HD / 2], [(CX + R) / 2, TOP + HD / 2],
];

export default function ModelSamples() {
  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Layer 3 model — round 3</h1>
      <p style={S.sub}>
        The last one read as stacked trays. These are re-proportioned: narrow footprint, taller mass, real volume.
        Pick a number (mixing is fine).
      </p>
      <div style={S.grid}>

        {/* ── 1 — Under-construction concrete frame ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 1</span>
          <div style={S.name}>Concrete frame, under construction</div>
          <div style={S.desc}>Structure going up: slabs with edge beams, perimeter columns, lift core overrunning the roof, and edge-protection railings on the top deck. Closest to your grey reference.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 420" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="slabG" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#F3F7FB" /><stop offset="1" stopColor="#DBE4EE" /></linearGradient>
                <linearGradient id="coreL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7A8EA4" /><stop offset="1" stopColor="#5F7488" /></linearGradient>
                <linearGradient id="coreR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#95A8BD" /><stop offset="1" stopColor="#7B90A6" /></linearGradient>
              </defs>
              <ellipse cx={CX} cy={BASE + HD + 20} rx="108" ry="16" fill="rgba(12,42,71,.13)" />

              {/* columns run full height, behind the slabs → frame reads open */}
              <g stroke="#71879D" strokeLinecap="round" fill="none">
                {COLS.map(([x, y], i) => (
                  <line key={i} x1={x} y1={y} x2={x} y2={y + (BASE - TOP)} strokeWidth={i < 3 ? 7 : 4.5} />
                ))}
              </g>

              {/* lift / stair core, overrunning the roof */}
              <g>
                <path d={`M200 ${TOP - 18} L${CX} ${TOP - 3} L${CX} ${BASE + 12} L200 ${BASE - 3} Z`} fill="url(#coreL)" />
                <path d={`M${CX} ${TOP - 3} L260 ${TOP - 18} L260 ${BASE - 3} L${CX} ${BASE + 12} Z`} fill="url(#coreR)" />
                <polygon points={`${CX},${TOP - 33} 260,${TOP - 18} ${CX},${TOP - 3} 200,${TOP - 18}`} fill="#AFC0D3" stroke="#fff" strokeWidth="0.8" />
              </g>

              {[5, 4, 3, 2, 1, 0].map((k) => <Plate key={k} cy={cyOf(k)} />)}

              {/* edge-protection railing on the top deck */}
              <g stroke="#E0A63C" strokeWidth="2" strokeLinecap="round" fill="none">
                <path d={`M${L} ${TOP - 16} L${CX} ${TOP + HD - 16} L${R} ${TOP - 16}`} />
                <path d={`M${L} ${TOP - 9} L${CX} ${TOP + HD - 9} L${R} ${TOP - 9}`} />
                <line x1={L} y1={TOP - 16} x2={L} y2={TOP} />
                <line x1={CX} y1={TOP + HD - 16} x2={CX} y2={TOP + HD} />
                <line x1={R} y1={TOP - 16} x2={R} y2={TOP} />
                <line x1={(L + CX) / 2} y1={TOP + HD / 2 - 16} x2={(L + CX) / 2} y2={TOP + HD / 2} />
                <line x1={(CX + R) / 2} y1={TOP + HD / 2 - 16} x2={(CX + R) / 2} y2={TOP + HD / 2} />
              </g>
            </svg>
          </div>
        </div>

        {/* ── 2 — Finished tower ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 2</span>
          <div style={S.name}>Finished tower</div>
          <div style={S.desc}>A solid, completed building: full envelope, glazing grid, floor banding and a setback crown. Reads as a building instantly because it has real mass rather than floating plates.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 420" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="roofG" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#EDF4FB" /><stop offset="1" stopColor="#D3E3F2" /></linearGradient>
                <linearGradient id="faceL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2C82C9" /><stop offset="1" stopColor="#1B5F9B" /></linearGradient>
                <linearGradient id="faceR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#54ACEE" /><stop offset="1" stopColor="#3388CE" /></linearGradient>
              </defs>
              <ellipse cx={CX} cy={BASE + HD + 20} rx="106" ry="16" fill="rgba(12,42,71,.13)" />

              {/* main mass */}
              <path d={`M${L} ${TOP} L${CX} ${TOP + HD} L${CX} ${BASE + HD} L${L} ${BASE} Z`} fill="url(#faceL)" />
              <path d={`M${CX} ${TOP + HD} L${R} ${TOP} L${R} ${BASE} L${CX} ${BASE + HD} Z`} fill="url(#faceR)" />
              <polygon points={rhombus(TOP)} fill="url(#roofG)" stroke="#fff" strokeWidth="1" />

              {/* floor banding */}
              <g stroke="rgba(255,255,255,.45)" strokeWidth="1" fill="none">
                {[1, 2, 3, 4, 5].map((k) => (
                  <g key={k}>
                    <line x1={L} y1={cyOf(k)} x2={CX} y2={cyOf(k) + HD} />
                    <line x1={CX} y1={cyOf(k) + HD} x2={R} y2={cyOf(k)} />
                  </g>
                ))}
              </g>
              {/* glazing mullions */}
              <g stroke="rgba(255,255,255,.24)" strokeWidth="1" fill="none">
                {[0.25, 0.5, 0.75].map((f) => (
                  <g key={f}>
                    <line x1={L + (CX - L) * f} y1={TOP + HD * f} x2={L + (CX - L) * f} y2={TOP + HD * f + (BASE - TOP)} />
                    <line x1={CX + (R - CX) * f} y1={TOP + HD - HD * f} x2={CX + (R - CX) * f} y2={TOP + HD - HD * f + (BASE - TOP)} />
                  </g>
                ))}
              </g>

              {/* setback crown + plant */}
              <g>
                <path d={`M196 ${TOP - 20} L${CX} ${TOP - 3} L${CX} ${TOP + 13} L196 ${TOP - 4} Z`} fill="#2C82C9" />
                <path d={`M${CX} ${TOP - 3} L264 ${TOP - 20} L264 ${TOP - 4} L${CX} ${TOP + 13} Z`} fill="#54ACEE" />
                <polygon points={`${CX},${TOP - 37} 264,${TOP - 20} ${CX},${TOP - 3} 196,${TOP - 20}`} fill="url(#roofG)" stroke="#fff" strokeWidth="1" />
              </g>
            </svg>
          </div>
        </div>

        {/* ── 3 — Cutaway: structure + services ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 3</span>
          <div style={S.name}>Cutaway, structure + services</div>
          <div style={S.desc}>Solid envelope on one side, cut open on the other to reveal the floor plates and coordinated services inside — ductwork, hot/cold pipework, cable tray. Structure and BIM in one image.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 420" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="cutRoof" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#EDF4FB" /><stop offset="1" stopColor="#D3E3F2" /></linearGradient>
                <linearGradient id="cutFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2C82C9" /><stop offset="1" stopColor="#1B5F9B" /></linearGradient>
                <linearGradient id="cutSlab" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stopColor="#F3F7FB" /><stop offset="1" stopColor="#DBE4EE" /></linearGradient>
              </defs>
              <ellipse cx={CX} cy={BASE + HD + 20} rx="106" ry="16" fill="rgba(12,42,71,.13)" />

              {/* solid left half (envelope intact) */}
              <path d={`M${L} ${TOP} L${CX} ${TOP + HD} L${CX} ${BASE + HD} L${L} ${BASE} Z`} fill="url(#cutFace)" />
              <g stroke="rgba(255,255,255,.4)" strokeWidth="1" fill="none">
                {[1, 2, 3, 4, 5].map((k) => <line key={k} x1={L} y1={cyOf(k)} x2={CX} y2={cyOf(k) + HD} />)}
              </g>

              {/* cut-open right half: exposed slabs + services between them */}
              {[5, 4, 3, 2, 1].map((k) => {
                const cy = cyOf(k);
                return (
                  <g key={k}>
                    <path d={`M${CX} ${cy + HD} L${R} ${cy} L${R} ${cy + 8} L${CX} ${cy + HD + 8} Z`} fill="#9DAEC2" />
                    <polygon points={`${CX},${cy - HD} ${R},${cy} ${CX},${cy + HD} ${CX},${cy - HD}`} fill="none" />
                    <polygon points={`${CX},${cy} ${R},${cy - HD + HD} ${R},${cy} ${CX},${cy + HD}`} fill="url(#cutSlab)" opacity="0.95" />
                  </g>
                );
              })}
              {/* services threaded through two exposed floors */}
              <Run d={`M${CX + 6} ${cyOf(3) + 30} L${R - 8} ${cyOf(3) - 10}`} w={9} body="#E2A63C" hi="#F6D48A" />
              <Run d={`M${CX + 6} ${cyOf(3) + 38} L${R - 8} ${cyOf(3) - 2}`} w={4.5} body="#2E8FDD" hi="#8FD0FF" />
              <Run d={`M${CX + 6} ${cyOf(2) + 32} L${R - 8} ${cyOf(2) - 8}`} w={9} body="#E2A63C" hi="#F6D48A" />
              <Run d={`M${CX + 6} ${cyOf(2) + 40} L${R - 8} ${cyOf(2)}`} w={4.5} body="#D8503F" hi="#FF9C8E" />

              {/* roof */}
              <polygon points={rhombus(TOP)} fill="url(#cutRoof)" stroke="#fff" strokeWidth="1" />
              {/* cut line down the middle */}
              <line x1={CX} y1={TOP + HD} x2={CX} y2={BASE + HD} stroke="#fff" strokeWidth="1.5" />
            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
