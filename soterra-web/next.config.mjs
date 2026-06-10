/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep unpdf (pdf.js under the hood) out of the bundle so it loads correctly
  // in the serverless function at runtime — avoids "works locally, fails on
  // Vercel" PDF-parsing breakage.
  experimental: {
    serverComponentsExternalPackages: ["unpdf"],
  },
};
export default nextConfig;
