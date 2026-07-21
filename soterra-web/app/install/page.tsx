"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

// soterra.co.nz/install — the ONE link you give a builder.
//
// It works out what they're holding and shows only that. B2B sales here is
// legwork: you're standing on a site or in an office, so "go to
// soterra.co.nz/install" has to be the whole instruction, with no follow-up
// about which browser or which menu.
//
// Deliberately NOT behind Clerk — a builder must be able to install before he
// has an account, and a login wall at the install step kills the demo.

type Device = "ios-safari" | "ios-other" | "android" | "desktop" | "installed";

function detect(): Device {
  if (typeof window === "undefined") return "desktop";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari's own flag — it predates display-mode and is still the reliable one there.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";

  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch check separates it from a real Mac.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (isIOS) {
    // On iOS every browser is WebKit underneath, but ONLY Safari can add to the
    // home screen. Chrome/Firefox/Edge on iOS put their own token in the UA.
    const notSafari = /CriOS|FxiOS|EdgiOS|OPiOS|Brave/.test(ua);
    return notSafari ? "ios-other" : "ios-safari";
  }
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export default function InstallPage() {
  const [device, setDevice] = useState<Device | null>(null);
  const [prompt, setPrompt] = useState<(Event & { prompt: () => Promise<void> }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setDevice(detect());
    // Chrome fires this when the app meets the install criteria. Capturing it
    // lets us show a real button instead of telling people to hunt in a menu.
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as Event & { prompt: () => Promise<void> });
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText("https://soterra.co.nz/install");
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked — the URL is shown on screen anyway */
    }
  };

  return (
    <div className="inst">
      <div className="inst-card">
        <Image src="/logo.png" alt="Soterra" width={150} height={40} className="inst-logo" priority />
        <div className="lg-pill">Install on your phone</div>
        <h1 className="inst-h">Put Soterra <b>on your home screen</b></h1>
        <p className="inst-sub">
          Ask your plans, check the code, and run the site schedule — straight from your phone,
          on site. No app store, no waiting.
        </p>

        {device === null && <div className="inst-load">Checking your device…</div>}

        {device === "installed" && (
          <div className="inst-done">
            <div className="inst-tick">✓</div>
            <b>You&apos;re already in the app</b>
            <p>Soterra is installed on this device. <a href="/">Open it</a>.</p>
          </div>
        )}

        {installed && device !== "installed" && (
          <div className="inst-done">
            <div className="inst-tick">✓</div>
            <b>Installed</b>
            <p>Look for the Soterra icon on your home screen.</p>
          </div>
        )}

        {/* ── iPhone / iPad in Safari ── */}
        {device === "ios-safari" && !installed && (
          <>
            <div className="inst-badge">iPhone &amp; iPad</div>
            <ol className="inst-steps">
              <li><span className="n">1</span><div>Tap the <b>Share</b> button at the bottom of Safari<span className="ic-share" aria-hidden /></div></li>
              <li><span className="n">2</span><div>Scroll down and tap <b>Add to Home Screen</b></div></li>
              <li><span className="n">3</span><div>Tap <b>Add</b> — Soterra appears with your other apps</div></li>
            </ol>
            <p className="inst-note">
              Apple only allows this from Safari, which is why there&apos;s no button to press here.
              It takes about ten seconds.
            </p>
          </>
        )}

        {/* ── iPhone / iPad, but not Safari ── */}
        {device === "ios-other" && !installed && (
          <>
            <div className="inst-badge warn">Open in Safari</div>
            <p className="inst-sub" style={{ marginBottom: 18 }}>
              On iPhone, only <b>Safari</b> can add an app to the home screen. Copy this link,
              paste it into Safari, and you&apos;ll get the steps.
            </p>
            <button className="lg-btn primary" onClick={copyLink}>
              {copied ? "✓ Link copied" : "Copy the link"}
            </button>
            <div className="inst-url">soterra.co.nz/install</div>
          </>
        )}

        {/* ── Android ── */}
        {device === "android" && !installed && (
          <>
            <div className="inst-badge">Android</div>
            {prompt ? (
              <button
                className="lg-btn primary"
                onClick={async () => { try { await prompt.prompt(); } catch { /* user dismissed */ } }}
              >
                Install Soterra
              </button>
            ) : (
              <ol className="inst-steps">
                <li><span className="n">1</span><div>Tap the <b>⋮</b> menu, top-right in Chrome</div></li>
                <li><span className="n">2</span><div>Tap <b>Add to Home screen</b> or <b>Install app</b></div></li>
                <li><span className="n">3</span><div>Confirm — Soterra appears with your other apps</div></li>
              </ol>
            )}
            <p className="inst-note">
              Works on any Android phone. Nothing to download and it updates itself.
            </p>
          </>
        )}

        {/* ── Desktop: scan it onto the phone in your hand ── */}
        {device === "desktop" && !installed && (
          <>
            <div className="inst-badge">Scan with your phone</div>
            <div className="inst-qr">
              <Image src="/install-qr.svg" alt="QR code linking to soterra.co.nz/install" width={190} height={190} />
            </div>
            <p className="inst-sub" style={{ marginBottom: 10 }}>
              Point your phone camera at the code, or type the address below.
            </p>
            <div className="inst-url">soterra.co.nz/install</div>
            <p className="inst-note">
              Soterra runs in your browser on a computer too — <a href="/">just open it here</a>.
            </p>
          </>
        )}

        <div className="inst-foot">
          <a href="/">← Back to Soterra</a>
        </div>
      </div>
    </div>
  );
}
