import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team · Soterra",
  description: "The people behind Soterra.",
};

// Standalone team page. Photo, name, LinkedIn — no titles (Adam's brief).
// Avatars are initials until real headshots are dropped into /public/team.
const TEAM = [
  { name: "Adam Domok", initials: "AD", photo: "adam.jpg", url: "https://www.linkedin.com/in/domok-adam/" },
  { name: "Maree Lamositele", initials: "ML", photo: "maree.jpg", url: "https://www.linkedin.com/in/lamositele/" },
  { name: "Farhaan Mirza", initials: "FM", photo: "farhaan.jpg", url: "https://www.linkedin.com/in/farhaanmirza/" },
  { name: "Felix Philip Kadavil", initials: "FK", photo: "felix.jpg", url: "https://www.linkedin.com/in/felixphilipkadavil/" },
  { name: "Kirushnaa Moni", initials: "KM", photo: "moni.jpg", url: "https://www.linkedin.com/in/kirushnaamoni/" },
];

export default function TeamPage() {
  return (
    <div className="tp">
      <style>{CSS}</style>

      <header className="tp-nav">
        <a className="tp-brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="Soterra" /><span>Soterra</span>
        </a>
        <a className="tp-back" href="/">← Back to site</a>
      </header>

      <main className="tp-main">
        <div className="tp-head">
          <div className="tp-kick">The team</div>
          <h1>The people behind Soterra.</h1>
          <p>Built in Aotearoa, in partnership with AUT.</p>
        </div>

        <div className="tp-grid">
          {TEAM.map((m) => (
            <div className="tp-member" key={m.name}>
              <div className="tp-ava">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/team/${m.photo}`} alt={m.name} />
              </div>
              <div className="tp-name">{m.name}</div>
              <a className="tp-link" href={m.url} target="_blank" rel="noopener noreferrer">
                <span className="tp-in">in</span>LinkedIn
              </a>
            </div>
          ))}
        </div>
      </main>

      <footer className="tp-foot">
        <a className="tp-brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-mark.png" alt="" /><span>Soterra</span>
        </a>
        <span className="tp-copy">Turning construction data into company intelligence.</span>
      </footer>
    </div>
  );
}

const CSS = `
.tp{--brand:#0E8FE6;--brand-d:#0A78C8;--navy:#0C2A47;--slate:#52698A;--mut:#94A6BE;--bg:#F6FAFF;--line:#E7EFF9;--line2:#EEF4FB;--grad:linear-gradient(135deg,#41C3FF 0%,#0A8DED 100%);
  font-family:var(--font,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif);color:var(--navy);min-height:100vh;display:flex;flex-direction:column;overflow-x:hidden;
  background:radial-gradient(760px 420px at 82% -6%,rgba(65,195,255,.12),transparent 62%),radial-gradient(680px 420px at 0% 0%,rgba(10,141,237,.05),transparent 55%),var(--bg)}
.tp *{box-sizing:border-box;margin:0;padding:0}
.tp a{text-decoration:none;color:inherit}
.tp-nav{display:flex;align-items:center;justify-content:space-between;padding:14px 7vw;border-bottom:1px solid var(--line2)}
.tp-brand{display:flex;align-items:center;gap:10px;font-size:20px;font-weight:700;color:var(--navy)}
.tp-brand img{height:28px;width:auto;display:block}
.tp-back{font-size:14px;font-weight:600;color:var(--slate)}
.tp-back:hover{color:var(--navy)}
.tp-main{flex:1;max-width:1000px;width:100%;margin:0 auto;padding:60px 7vw 40px}
.tp-head{text-align:center;max-width:620px;margin:0 auto}
.tp-kick{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--brand-d)}
.tp-head h1{font-size:clamp(28px,4vw,44px);font-weight:600;letter-spacing:-.028em;margin:12px 0 10px}
.tp-head p{font-size:16px;color:var(--slate)}
.tp-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:22px;margin:44px auto 0}
.tp-member{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px}
.tp-ava{width:112px;height:112px;border-radius:50%;background:var(--grad);display:flex;align-items:center;justify-content:center;color:#fff;font-size:34px;font-weight:700;box-shadow:0 16px 34px rgba(10,141,237,.28);border:3px solid #fff;overflow:hidden}
.tp-ava img{width:100%;height:100%;object-fit:cover;display:block}
.tp-name{font-size:15.5px;font-weight:700;color:var(--navy)}
.tp-link{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--brand-d);border:1px solid var(--line);border-radius:10px;padding:7px 12px;background:#fff}
.tp-link:hover{border-color:var(--brand)}
.tp-in{width:17px;height:17px;border-radius:3px;background:#0A66C2;color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center}
.tp-foot{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;max-width:1240px;width:100%;margin:0 auto;padding:26px 7vw;border-top:1px solid var(--line)}
.tp-foot .tp-brand{font-size:16px}.tp-foot .tp-brand img{height:22px}
.tp-copy{font-size:12.5px;color:var(--mut)}
@media(max-width:820px){.tp-grid{grid-template-columns:repeat(2,1fr);gap:26px}}
@media(max-width:420px){.tp-grid{grid-template-columns:1fr}}
`;
