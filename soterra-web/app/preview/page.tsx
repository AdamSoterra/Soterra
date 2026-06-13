import Link from "next/link";

// One link to compare all three landing directions.
export default function PreviewIndex() {
  const opts = [
    { href: "/preview/a", tag: "A", name: "Clean / product-first", desc: "Crisp SaaS look with a self-playing chat demo — a question types in, the cited sheet answer slides up." },
    { href: "/preview/b", tag: "B", name: "Bold / site energy", desc: "Dark, confident hero over a blueprint grid that draws itself in. Big and dramatic." },
    { href: "/preview/c", tag: "C", name: "Calm / trust-first", desc: "Editorial and airy, with a drawing-sheet scan + 'never guessed' trust angle." },
  ];
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "64px 24px", fontFamily: "var(--font)", color: "var(--navy)" }}>
      <div className="grad" style={{ fontSize: 26, fontWeight: 700 }}>Soterra</div>
      <h1 style={{ fontSize: 30, fontWeight: 300, letterSpacing: "-.02em", margin: "10px 0 6px" }}>
        Front-page samples
      </h1>
      <p style={{ color: "var(--slate)", marginBottom: 28 }}>Three directions to choose from — open each, then tell me which to make the real site (and what to tweak).</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {opts.map((o) => (
          <Link key={o.href} href={o.href} style={{ display: "flex", gap: 16, alignItems: "center", background: "#fff", border: "1px solid var(--line)", borderRadius: 16, padding: "20px 22px", textDecoration: "none", color: "inherit", boxShadow: "0 4px 18px rgba(12,42,71,.05)" }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, background: "var(--grad)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 20, flexShrink: 0 }}>{o.tag}</div>
            <div>
              <b style={{ fontSize: 17 }}>{o.name}</b>
              <p style={{ fontSize: 14, color: "var(--slate)", marginTop: 4, lineHeight: 1.5 }}>{o.desc}</p>
            </div>
            <div style={{ marginLeft: "auto", color: "var(--brand)", fontSize: 22 }}>›</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
