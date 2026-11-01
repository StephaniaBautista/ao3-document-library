import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [{ source: '/offline', destination: '/offline.html' }];
  },
};

export default nextConfig;
