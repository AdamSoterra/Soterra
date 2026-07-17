"use client";

import { useEffect } from "react";

// Native-only shell setup. Marks the <html> with `is-capacitor` (so safe-area
// CSS scopes to the app and never touches the website), makes the status bar
// overlay the WebView, and sets dark icons for our light header. Without the
// overlay call, env(safe-area-inset-top) reports 0 on Android and the header
// clashes with the clock/wifi/battery. No-op on web.
export function NativeShell() {
  useEffect(() => {
    void (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cap = (window as any).Capacitor;
        if (!cap?.isNativePlatform?.()) return;
        document.documentElement.classList.add("is-capacitor");
        const { StatusBar, Style } = await import("@capacitor/status-bar");
        await StatusBar.setOverlaysWebView({ overlay: true });
        await StatusBar.setStyle({ style: Style.Dark }); // dark icons on our light header
      } catch {
        /* web / plugin unavailable */
      }
    })();
  }, []);

  return null;
}
