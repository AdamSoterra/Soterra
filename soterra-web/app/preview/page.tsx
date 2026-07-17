import Link from "next/link";

// Chooser — compare the landing directions. The four premium directions are the
// real contenders; the original A/B/C drafts are kept reachable below.
export default function PreviewIndex() {
  const opts = [
    { href: "/preview/command", tag: "Command Centre", name: "Dark · engineered", desc: "Serious site-software feel (Linear / Palantir). Deep navy, a technical grid, and a live console answering a plan question beside the site's week." },
    { href: "/preview/blueprint", tag: "Blueprint", name: "Light · architectural", desc: "The whole page speaks construction drawing — dimension lines, a building that draws itself, and the citation shown as a real title-block." },
    { href: "/preview/editorial", tag: "Editorial", name: "Minimal · premium", desc: "Acres of white, one huge confident line, and a single beautifully-built answer card floating with real depth (Stripe / Arc)." },
    { href: "/preview/structure", tag: "Structure", name: "Isometric · digital-twin", desc: "An isometric building you can interrogate, with answers pinned to it. BIM / digital-twin energy." },
  ];
  return (
    <main style={{ maxWidth: 780, margin: "0 auto", padding: "64px 24px", fontFamily: "var(--font)", color: "var(--navy)" }}>
      <div className="grad" style={{ fontSize: 26, fontWeight: 700 }}>Soterra</div>
      <h1 style={{ fontSize: 30, fontWeight: 300, letterSpacing: "-.02em", margin: "10px 0 6px" }}>
        Landing directions
      </h1>
      <p style={{ color: "var(--slate)", marginBottom: 28 }}>
        Four premium directions, same agreed story. Open each on your phone, then tell me which to make the real site (and what to tweak).
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {opts.map((o) => (
          <Link key={o.href} href={o.href} style={{ display: "flex", gap: 16, alignItems: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "20px 22px", textDecoration: "none", color: "inherit", boxShadow: "0 4px 18px rgba(12,42,71,.05)" }}>
            <div style={{ minWidth: 132, fontWeight: 700, fontSize: 16, background: "var(--grad)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{o.tag}</div>
            <div style={{ flex: 1 }}>
              <b style={{ fontSize: 14, color: "var(--brand-d)", display: "block", marginBottom: 3 }}>{o.name}</b>
              <p style={{ fontSize: 14, color: "var(--slate)", lineHeight: 1.5 }}>{o.desc}</p>
            </div>
            <div style={{ color: "var(--brand)", fontSize: 22 }}>›</div>
          </Link>
        ))}
      </div>
      <p style={{ color: "var(--mut)", marginTop: 26, fontSize: 13 }}>
        Earlier drafts: <Link href="/preview/a" style={{ color: "var(--slate)" }}>A</Link> · <Link href="/preview/b" style={{ color: "var(--slate)" }}>B</Link> · <Link href="/preview/c" style={{ color: "var(--slate)" }}>C</Link>
      </p>
    </main>
  );
}
