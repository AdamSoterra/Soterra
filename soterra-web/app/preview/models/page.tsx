import type { CSSProperties } from "react";

// Layer 3 "model" visual options for Adam to pick from (2026-07-16).
// Standalone preview at /preview/models. Winner gets wired into landing.tsx.

const S: Record<string, CSSProperties> = {
  wrap: { minHeight: "100vh", background: "#F6FAFF", color: "#0C2A47", fontFamily: "'DM Sans', Arial, sans-serif", padding: "40px 6vw 80px" },
  h1: { fontSize: 30, fontWeight: 700, letterSpacing: "-.02em", marginBottom: 6 },
  sub: { color: "#52698A", fontSize: 15, marginBottom: 34 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 24, maxWidth: 1100, margin: "0 auto" },
  card: { background: "#fff", border: "1px solid #E7EFF9", borderRadius: 18, padding: 20, boxShadow: "0 12px 40px rgba(12,42,71,.06)" },
  tag: { display: "inline-block", fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "#fff", background: "linear-gradient(135deg,#41C3FF,#0A8DED)", padding: "5px 11px", borderRadius: 20, marginBottom: 6 },
  name: { fontSize: 18, fontWeight: 700, margin: "8px 0 2px" },
  desc: { fontSize: 13.5, color: "#52698A", marginBottom: 14, lineHeight: 1.5 },
  frame: { borderRadius: 14, overflow: "hidden", background: "#F6FAFF", border: "1px solid #EEF4FB" },
};

export default function ModelSamples() {
  return (
    <div style={S.wrap}>
      <h1 style={S.h1}>Layer 3 model, options</h1>
      <p style={S.sub}>Four takes on the &ldquo;one connected model&rdquo; visual. Tell Claude the number you like (or mix ideas).</p>
      <div style={S.grid}>

        {/* ── Option 1 — Convergence ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 1</span>
          <div style={S.name}>Convergence</div>
          <div style={S.desc}>The three sources flow into one Soterra core. Most on-message: literally shows them coming together.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 300" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="o1core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#41C3FF" /><stop offset="1" stopColor="#0A8DED" /></linearGradient>
              </defs>
              <g fill="none" stroke="#CFE0F2" strokeWidth="2">
                <path d="M186 66 C255 66 275 150 314 150" /><path d="M186 150 H314" /><path d="M186 234 C255 234 275 150 314 150" />
              </g>
              <g>
                <rect x="24" y="42" width="162" height="48" rx="12" fill="#fff" stroke="#E7EFF9" /><circle cx="46" cy="66" r="6" fill="#0E8FE6" /><text x="62" y="71" fontSize="15" fontWeight="600" fill="#0C2A47">Live plans</text>
                <rect x="24" y="126" width="162" height="48" rx="12" fill="#fff" stroke="#E7EFF9" /><circle cx="46" cy="150" r="6" fill="#10B981" /><text x="62" y="155" fontSize="15" fontWeight="600" fill="#0C2A47">Building Code</text>
                <rect x="24" y="210" width="162" height="48" rx="12" fill="#fff" stroke="#E7EFF9" /><circle cx="46" cy="234" r="6" fill="#8B5CF6" /><text x="62" y="239" fontSize="15" fontWeight="600" fill="#0C2A47">Project history</text>
              </g>
              <circle cx="360" cy="150" r="54" fill="none" stroke="#41C3FF" strokeWidth="1.5" opacity=".38" />
              <circle cx="360" cy="150" r="44" fill="url(#o1core)" />
              <g fill="#fff" opacity=".95">
                <rect x="343" y="142" width="11" height="20" rx="1.5" /><rect x="357" y="134" width="13" height="28" rx="1.5" /><rect x="373" y="147" width="10" height="15" rx="1.5" />
              </g>
              <text x="360" y="224" textAnchor="middle" fontSize="12" fontWeight="700" fill="#0A78C8" letterSpacing=".04em">ONE MODEL</text>
            </svg>
          </div>
        </div>

        {/* ── Option 2 — Glass tower ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 2</span>
          <div style={S.name}>Glass tower</div>
          <div style={S.desc}>A cleaner isometric building with a glass facade and the three sources pinned to it. Closest to the current one, done properly.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 340" style={{ width: "100%", display: "block" }}>
              <defs>
                <linearGradient id="o2roof" x1="0" y1="0" x2="0.3" y2="1"><stop offset="0" stopColor="#EAF5FF" /><stop offset="1" stopColor="#CDE8FF" /></linearGradient>
                <linearGradient id="o2left" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2E90DB" /><stop offset="1" stopColor="#1E75BE" /></linearGradient>
                <linearGradient id="o2right" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#54B4F6" /><stop offset="1" stopColor="#3BA0EA" /></linearGradient>
              </defs>
              <ellipse cx="230" cy="306" rx="126" ry="19" fill="rgba(12,42,71,.10)" />
              <path fill="url(#o2left)" stroke="#fff" strokeWidth="1" d="M130 140 L230 190 L230 300 L130 250 Z" />
              <path fill="url(#o2right)" stroke="#fff" strokeWidth="1" d="M230 190 L330 140 L330 250 L230 300 Z" />
              <path fill="url(#o2roof)" stroke="#fff" strokeWidth="1" d="M230 90 L330 140 L230 190 L130 140 Z" />
              <g stroke="rgba(255,255,255,.5)" strokeWidth="1" fill="none">
                <line x1="130" y1="162" x2="230" y2="212" /><line x1="130" y1="184" x2="230" y2="234" /><line x1="130" y1="206" x2="230" y2="256" /><line x1="130" y1="228" x2="230" y2="278" />
                <line x1="230" y1="212" x2="330" y2="162" /><line x1="230" y1="234" x2="330" y2="184" /><line x1="230" y1="256" x2="330" y2="206" /><line x1="230" y1="278" x2="330" y2="228" />
              </g>
              <g stroke="rgba(255,255,255,.3)" strokeWidth="1" fill="none">
                <line x1="163" y1="157" x2="163" y2="267" /><line x1="197" y1="174" x2="197" y2="284" /><line x1="263" y1="174" x2="263" y2="284" /><line x1="297" y1="157" x2="297" y2="267" />
              </g>
              <g><circle cx="300" cy="158" r="11" fill="rgba(14,143,230,.16)" /><circle cx="300" cy="158" r="4.5" fill="#0A8DED" stroke="#fff" strokeWidth="1.5" /></g>
              <g><circle cx="168" cy="205" r="11" fill="rgba(16,185,129,.16)" /><circle cx="168" cy="205" r="4.5" fill="#10B981" stroke="#fff" strokeWidth="1.5" /></g>
              <g><circle cx="234" cy="262" r="11" fill="rgba(139,92,246,.16)" /><circle cx="234" cy="262" r="4.5" fill="#8B5CF6" stroke="#fff" strokeWidth="1.5" /></g>
            </svg>
          </div>
        </div>

        {/* ── Option 3 — Stacked layers ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 3</span>
          <div style={S.name}>Stacked layers</div>
          <div style={S.desc}>Three drawing planes stacking into one. Reads as &ldquo;layers combining&rdquo;, ties straight to the Layer 1/2/3 story.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 300" style={{ width: "100%", display: "block" }}>
              <g stroke="#B9CCE0" strokeWidth="1.5"><line x1="230" y1="120" x2="230" y2="235" /></g>
              <path d="M230 190 L360 235 L230 280 L100 235 Z" fill="rgba(139,92,246,.22)" stroke="#8B5CF6" strokeWidth="1.2" />
              <path d="M230 130 L360 175 L230 220 L100 175 Z" fill="rgba(16,185,129,.24)" stroke="#10B981" strokeWidth="1.2" />
              <path d="M230 70 L360 115 L230 160 L100 115 Z" fill="#DCEEFF" stroke="#0A8DED" strokeWidth="1.4" />
              <g fill="#0A8DED"><circle cx="205" cy="112" r="4" /><circle cx="255" cy="120" r="4" /><circle cx="230" cy="132" r="4" /></g>
              <g fontSize="13" fontWeight="600" fill="#52698A">
                <text x="372" y="119">Live plans</text><text x="372" y="179">Building Code</text><text x="372" y="239">Project history</text>
              </g>
            </svg>
          </div>
        </div>

        {/* ── Option 4 — Blueprint ── */}
        <div style={S.card}>
          <span style={S.tag}>Option 4</span>
          <div style={S.name}>Blueprint</div>
          <div style={S.desc}>A glowing wireframe building with dimension lines. Techy, BIM/digital-twin feel. Bolder and more distinctive.</div>
          <div style={S.frame}>
            <svg viewBox="0 0 460 300" style={{ width: "100%", display: "block" }}>
              <rect width="460" height="300" fill="#0C2540" />
              <g stroke="rgba(95,208,255,.12)" strokeWidth="1">
                <line x1="0" y1="60" x2="460" y2="60" /><line x1="0" y1="120" x2="460" y2="120" /><line x1="0" y1="180" x2="460" y2="180" /><line x1="0" y1="240" x2="460" y2="240" />
                <line x1="80" y1="0" x2="80" y2="300" /><line x1="160" y1="0" x2="160" y2="300" /><line x1="240" y1="0" x2="240" y2="300" /><line x1="320" y1="0" x2="320" y2="300" /><line x1="400" y1="0" x2="400" y2="300" />
              </g>
              <g stroke="#5FD0FF" strokeWidth="1.6" fill="none">
                <path d="M230 70 L330 120 L230 170 L130 120 Z" />
                <path d="M130 120 L230 170 L230 260 L130 210 Z" />
                <path d="M330 120 L230 170 L230 260 L330 210 Z" />
                <line x1="130" y1="120" x2="130" y2="210" /><line x1="330" y1="120" x2="330" y2="210" /><line x1="230" y1="170" x2="230" y2="260" />
              </g>
              <g stroke="rgba(95,208,255,.5)" strokeWidth="1" fill="none">
                <line x1="130" y1="145" x2="230" y2="195" /><line x1="230" y1="195" x2="330" y2="145" /><line x1="130" y1="170" x2="230" y2="220" /><line x1="230" y1="220" x2="330" y2="170" />
              </g>
              <g stroke="#8FDBFF" strokeWidth="1" strokeDasharray="4 3">
                <line x1="96" y1="120" x2="96" y2="210" /><line x1="92" y1="120" x2="100" y2="120" /><line x1="92" y1="210" x2="100" y2="210" />
              </g>
              <text x="70" y="169" fontSize="11" fill="#8FDBFF" fontFamily="ui-monospace,monospace" transform="rotate(-90 70 169)" textAnchor="middle">18.4 m</text>
              <circle cx="300" cy="140" r="4" fill="#5FD0FF" /><circle cx="300" cy="140" r="9" fill="none" stroke="#5FD0FF" strokeWidth="1" opacity=".5" />
            </svg>
          </div>
        </div>

      </div>
    </div>
  );
}
