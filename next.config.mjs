/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    // Matches the CORS header from the original static vercel.json
    return [
      {
        source: "/(.*)",
        headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
      },
    ];
  },
};

export default nextConfig;
