/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // PatternTalk's audio service runs on a different port (8001); in dev we
  // proxy /api/audio/* there to avoid CORS. See feat/audio-service PR.
  async rewrites() {
    return [
      {
        source: "/api/audio/:path*",
        destination: "http://localhost:8001/:path*",
      },
    ];
  },
};

export default nextConfig;
