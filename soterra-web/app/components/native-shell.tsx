"use client";

import { useEffect } from "react";

// Native-only shell setup. Marks the <html> with `is-capacitor` (so safe-area
// CSS scopes to the app and never touches the website), makes the status bar
// overlay the WebView, and sets dark icons for our light header. Without the
// overlay call, env(safe-area-inset-top) reports 0 on Android and the header
// clashes with the clock/wifi/battery. No-op on web.
//
// ⚠️ Style.Light is correct here and Style.Dark is not, despite how it reads.
// The enum names the CONTENT BEHIND the bar, not the icons: Style.Light means
// "light background, so draw dark icons". .topnav is white, so we want Light.
// Style.Dark was the old value and gave WHITE icons on a WHITE header on BOTH
// platforms — Android maps it to setAppearanceLightStatusBars(false), iOS to
// .lightContent. Don't "correct" this back.
export function NativeShell() {
  useEffect(() => {
    // iPhone home-screen web app (Safari → Add to Home Screen). There is no
    // Capacitor bridge here, so `is-capacitor` never lands and every safe-area
    // rule scoped to it does nothing — yet the same home indicator still sits
    // over the composer. Mark it separately, BEFORE the native check below.
    // Its own class rather than reusing is-capacitor, so the live Android app's
    // rules stay exactly as they are.
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (standalone) document.documentElement.classList.add("is-standalone");
    } catch {
      /* ignore */
    }

    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cap = (window as any).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        document.documentElement.classList.add("is-capacitor");
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Light }); // dark icons on our light header
      } catch {
        /* web / plugin unavailable */
      }
    })();
  }, []);

  return null;
}
