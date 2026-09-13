import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@gold-revenue-os/config", "@gold-revenue-os/contracts"],
  poweredByHeader: false,
};

export default nextConfig;
