"use client";

import { useEffect } from "react";

// Registers the no-op service worker so Chrome/Edge will offer the one-tap
// "Install app" prompt. Silent by design: if registration fails the site works
// exactly as before, the user just installs via the browser menu instead.
export default function SwRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    // Register after load so it never competes with the first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* installability is a nice-to-have; never surface this to the user */
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}
