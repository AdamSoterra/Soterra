/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep unpdf (pdf.js under the hood) out of the bundle so it loads correctly
  // in the serverless function at runtime — avoids "works locally, fails on
  // Vercel" PDF-parsing breakage.
  experimental: {
    // unpdf (pdf.js) and the canvas it renders pages with are native/worker
    // packages that must load at runtime, not be bundled — same reason as unpdf.
    serverComponentsExternalPackages: ["unpdf", "@napi-rs/canvas"],
  },
};
export default nextConfig;
