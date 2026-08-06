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
  ios: {
    webContentsDebuggingEnabled: false,
    // Deliberately NOT setting limitsNavigationsToAppBoundDomains. Turning it
    // on caps WKAppBoundDomains at 10 entries, and allowNavigation above
    // already lists 9 — one more Clerk or Google host and sign-in would start
    // failing on iOS only, in a way that looks nothing like its cause.
  },
};

// ⚠️ iOS uses CocoaPods, NOT Capacitor 8's default Swift Package Manager.
// @capacitor-community/speech-recognition ships no root Package.swift, and the
// SPM path drops such a plugin with a single warning — producing a build where
// the mic button never appears. The platform was added with
// `npx cap add ios --packagemanager cocoapods`; keep it that way, and build
// ios/App/App.xcworkspace rather than the .xcodeproj.

export default config;
