"use client";

import { useEffect, useState } from "react";

// A2HS install hint: a slim banner under the top nav of the signed-in app,
// nudging iPhone/iPad Safari users to Add to Home Screen. Safari never fires
// beforeinstallprompt, so a nudge is the only install prompt iOS gets. Shows
// ONLY where the nudge can be acted on: iOS Safari in a plain browser tab.
// Never once installed (standalone), never in the Capacitor app, and never in
// the iOS Chrome/Firefox/Edge/Opera/Brave shells, which can't add to home
// screen. The X remembers itself for 14 days via localStorage. Detection runs
// in useEffect so SSR renders nothing and there is no flash.

const DISMISS_KEY = "soterra:a2hs-hint-dismissed";
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;

export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      // Same UA detection as /install's detect(): iPadOS 13+ reports as a Mac,
      // so the touch check separates it from a real Mac.
      const ua = navigator.userAgent;
      const isIOS = /iPad|iPhone|iPod/.test(ua) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      if (!isIOS) return;
      // Only Safari can add to the home screen; the others carry their own UA token.
      if (/CriOS|FxiOS|EdgiOS|OPiOS|Brave/.test(ua)) return;
      const standalone =
        window.matchMedia?.("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (standalone) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Capacitor?.isNativePlatform?.()) return;
      const dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (dismissed && Date.now() - dismissed < DISMISS_MS) return;
      setShow(true);
    } catch {
      /* stay hidden */
    }
  }, []);

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* storage blocked; it just reappears next visit */
    }
  };

  if (!show) return null;
  return (
    <div className="a2hs-hint">
      <div className="a2hs-txt">
        <b>Use Soterra as an app</b>
        <span>Tap Share, then Add to Home Screen. Ten seconds.</span>
      </div>
      <a className="a2hs-go" href="/install">Show me how</a>
      <button className="a2hs-x" onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}
