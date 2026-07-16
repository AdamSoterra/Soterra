import type { CapacitorConfig } from '@capacitor/cli';

// Soterra native shell. Same pattern as Montázs: the native app is a WebView
// pointing at the live site, so web fixes ship without a new binary.
// ⚠️ appId is PERMANENT once published to Google Play — confirmed with Adam.
const config: CapacitorConfig = {
  appId: 'nz.co.soterra.app',
  appName: 'Soterra',
  webDir: 'public',
  server: {
    url: 'https://soterra.co.nz',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'soterra.co.nz',
      '*.soterra.co.nz',
      '*.clerk.services',
      '*.clerk.com',
      '*.clerk.dev',
      '*.clerk.accounts.dev',
      'accounts.google.com',
      '*.googleapis.com',
      '*.gstatic.com',
    ],
  },
  android: {
    // Production: false. For local USB debugging, flip to true temporarily,
    // run `npx cap sync android`, build a debug variant, then flip back
    // before the next release build. (Montázs lesson.)
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
};

export default config;
